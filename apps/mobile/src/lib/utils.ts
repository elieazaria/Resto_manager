import { randomUUID } from 'expo-crypto';
import { ApiError, NetworkError } from './api';

export const uuid = () => randomUUID();

export function errorMessage(e: unknown): string {
  if (e instanceof NetworkError) return 'Pas de connexion au serveur';
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Une erreur est survenue';
}
