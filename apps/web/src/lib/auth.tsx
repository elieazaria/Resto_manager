import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthResponse, UserDto } from '@resto/shared';
import { api, NetworkError, setUnauthorizedHandler, TOKEN_KEY, getToken } from './api';

const USER_KEY = 'resto.user';

interface AuthContextValue {
  user: UserDto | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  pinLogin: (username: string, pin: string) => Promise<void>;
  logout: () => void;
}
const AuthContext = createContext<AuthContextValue | null>(null);

function readUser(): UserDto | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw && getToken() ? (JSON.parse(raw) as UserDto) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<UserDto | null>(readUser);
  const [ready, setReady] = useState(!getToken());

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      /* ignore */
    }
    setUser(null);
    qc.clear();
    // le cache hors-ligne de l'API reste propre à la session
    if ('caches' in window) void caches.delete('resto-api-pos');
  }, [qc]);

  const store = useCallback((res: AuthResponse) => {
    try {
      localStorage.setItem(TOKEN_KEY, res.token);
      localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    } catch {
      /* ignore */
    }
    setUser(res.user);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(clear);
    return () => setUnauthorizedHandler(null);
  }, [clear]);

  // Valide la session au démarrage ; hors-ligne on garde l'utilisateur mémorisé.
  useEffect(() => {
    if (!getToken()) return;
    api<UserDto>('/auth/me')
      .then((u) => {
        setUser(u);
        try {
          localStorage.setItem(USER_KEY, JSON.stringify(u));
        } catch {
          /* ignore */
        }
      })
      .catch((e) => {
        if (!(e instanceof NetworkError)) clear();
      })
      .finally(() => setReady(true));
  }, [clear]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      ready,
      login: async (username, password) =>
        store(await api<AuthResponse>('/auth/login', { method: 'POST', body: { username, password }, auth: false })),
      pinLogin: async (username, pin) =>
        store(await api<AuthResponse>('/auth/pin-login', { method: 'POST', body: { username, pin }, auth: false })),
      logout: clear,
    }),
    [user, ready, store, clear],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth hors AuthProvider');
  return ctx;
}
