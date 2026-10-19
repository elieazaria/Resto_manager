import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthResponse, UserDto } from '@resto/shared';
import { api, loadToken, NetworkError, saveToken, setUnauthorizedHandler } from './api';
import { loadServerUrl } from './config';
import { getJson, removeKey, setJson } from './storage';
import { loadPrefs } from './print';
import { outbox } from './outbox';

const USER_KEY = 'resto.user';

interface AuthValue {
  user: UserDto | null;
  ready: boolean;
  login: (username: string, secret: string, mode: 'password' | 'pin') => Promise<void>;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<UserDto | null>(null);
  const [ready, setReady] = useState(false);

  const clear = useCallback(async () => {
    await saveToken(null);
    await removeKey(USER_KEY);
    setUser(null);
    qc.clear();
  }, [qc]);

  useEffect(() => {
    setUnauthorizedHandler(() => void clear());
    return () => setUnauthorizedHandler(null);
  }, [clear]);

  // Démarrage : réglages locaux, session mémorisée, file d'attente ; hors-ligne on garde l'utilisateur connu.
  useEffect(() => {
    (async () => {
      await Promise.all([loadServerUrl(), loadPrefs(), outbox.load()]);
      const token = await loadToken();
      if (token) {
        const saved = await getJson<UserDto | null>(USER_KEY, null);
        if (saved) setUser(saved);
        try {
          const fresh = await api<UserDto>('/auth/me');
          setUser(fresh);
          void setJson(USER_KEY, fresh);
        } catch (e) {
          if (!(e instanceof NetworkError)) await clear();
        }
      }
      setReady(true);
    })();
  }, [clear]);

  const login = useCallback(async (username: string, secret: string, mode: 'password' | 'pin') => {
    const res =
      mode === 'pin'
        ? await api<AuthResponse>('/auth/pin-login', { method: 'POST', auth: false, body: { username, pin: secret } })
        : await api<AuthResponse>('/auth/login', { method: 'POST', auth: false, body: { username, password: secret } });
    await saveToken(res.token);
    await setJson(USER_KEY, res.user);
    setUser(res.user);
  }, []);

  const value = useMemo(() => ({ user, ready, login, logout: clear }), [user, ready, login, clear]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth hors AuthProvider');
  return v;
}
