import * as SecureStore from 'expo-secure-store';
import { getServerUrl } from './config';

const TOKEN_KEY = 'resto.token';
let token: string | null = null;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data?: Record<string, any>) {
    super(message);
  }
}
/** Serveur injoignable (hors-ligne, coupure) — distinct d'une réponse d'erreur. */
export class NetworkError extends Error {
  constructor() {
    super('Pas de connexion au serveur');
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

export const getToken = () => token;
export async function loadToken() {
  try {
    token = await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    token = null;
  }
  return token;
}
export async function saveToken(t: string | null) {
  token = t;
  try {
    if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export const wsUrl = () => `${getServerUrl().replace(/^http/, 'ws')}/ws`;

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const base = getServerUrl();
  if (!base) throw new ApiError(0, 'NO_SERVER', "Adresse du serveur non configurée (Réglages)");
  const useToken = opts.auth === false ? null : token;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12000);
  let res: Response;
  try {
    res = await fetch(`${base}/api${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(useToken ? { Authorization: `Bearer ${useToken}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* corps vide ou page d'erreur d'un proxy */
  }
  if (!res.ok) {
    if (res.status >= 502 && res.status <= 504 && !data) throw new NetworkError();
    if (res.status === 401 && useToken) onUnauthorized?.();
    throw new ApiError(res.status, data?.error ?? 'ERROR', data?.message ?? `Erreur ${res.status}`, data ?? undefined);
  }
  return data as T;
}

/** Lecture avec cache disque : hors-ligne on renvoie la dernière réponse connue (menu, tables, réglages). */
import { getJson, setJson } from './storage';
export async function cachedGet<T>(path: string): Promise<T> {
  const key = `resto.cache.${path}`;
  try {
    const data = await api<T>(path);
    void setJson(key, data);
    return data;
  } catch (e) {
    if (e instanceof NetworkError) {
      const hit = await getJson<T | null>(key, null);
      if (hit) return hit;
    }
    throw e;
  }
}
