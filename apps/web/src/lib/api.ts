export const TOKEN_KEY = 'resto.token';
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public data?: Record<string, any>,
  ) {
    super(message);
  }
}
/** Le serveur est injoignable (hors-ligne, coupure) — distinct d'une réponse d'erreur. */
export class NetworkError extends Error {
  constructor() {
    super('Pas de connexion au serveur');
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const wsUrl = () => {
  const base = BASE || window.location.origin;
  return `${base.replace(/^http/, 'ws')}/ws`;
};

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const token = opts.auth === false ? null : getToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new NetworkError();
  }
  if (res.status === 204) return undefined as T;
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* corps vide ou non JSON (ex. page d'erreur d'un proxy) */
  }
  if (!res.ok) {
    if (res.status >= 502 && res.status <= 504 && !data) throw new NetworkError();
    if (res.status === 401 && token && opts.auth !== false) onUnauthorized?.();
    throw new ApiError(res.status, data?.error ?? 'ERROR', data?.message ?? `Erreur ${res.status}`, data ?? undefined);
  }
  return data as T;
}
