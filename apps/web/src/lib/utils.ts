import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ApiError, NetworkError } from './api';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/** Message affichable pour toute erreur (API, réseau, inattendue). */
export function errorMessage(e: unknown): string {
  if (e instanceof NetworkError) return 'Pas de connexion au serveur';
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Une erreur est survenue';
}

/** crypto.randomUUID n'existe qu'en contexte sécurisé (HTTPS) : repli pour un test en HTTP sur le réseau local. */
export function uuid(): string {
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
