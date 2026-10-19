import { useSyncExternalStore } from 'react';
import { ApiError, NetworkError, api } from './api';

/**
 * File d'attente hors-ligne : les commandes/encaissements saisis sans réseau sont rejoués dans l'ordre.
 * Sûr à rejouer : PUT /orders/:id est idempotent (id choisi côté client) et /pay est sans effet s'il est déjà appliqué.
 */
export interface OutboxItem {
  id: string;
  method: 'PUT' | 'POST';
  path: string;
  body?: unknown;
  label: string;
  createdAt: number;
  /** Rejet définitif par le serveur (ex. table déjà occupée) : à traiter à la main. */
  error?: string;
}

const KEY = 'resto.outbox';
let items: OutboxItem[] = load();
const listeners = new Set<() => void>();
let flushing = false;

function load(): OutboxItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}
function commit(next: OutboxItem[]) {
  items = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* quota / navigation privée */
  }
  listeners.forEach((l) => l());
}

export const outbox = {
  all: () => items,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Un PUT en attente sur le même chemin est remplacé (la dernière version de la commande l'emporte). */
  enqueue(item: Omit<OutboxItem, 'id' | 'createdAt' | 'error'>) {
    const base = item.method === 'PUT' ? items.filter((i) => !(i.method === 'PUT' && i.path === item.path && !i.error)) : items;
    commit([...base, { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now() }]);
  },
  dismiss(id: string) {
    commit(items.filter((i) => i.id !== id));
  },
  /** Commande en attente d'envoi pour une table (pour la rouvrir sans créer de doublon). */
  pendingOrderForTable(tableId: string) {
    for (const i of [...items].reverse()) {
      const b = i.body as { table_id?: string } | undefined;
      if (i.method === 'PUT' && !i.error && b?.table_id === tableId) {
        return { id: i.path.replace('/orders/', ''), body: i.body as { table_id: string; lines: { menu_item_id: string; quantity: number; note?: string | null }[] } };
      }
    }
    return null;
  },
  async flush(): Promise<{ sent: number; failed: number }> {
    if (flushing) return { sent: 0, failed: 0 };
    flushing = true;
    let sent = 0;
    let failed = 0;
    try {
      for (const it of [...items]) {
        if (it.error) continue;
        try {
          await api(it.path, { method: it.method, body: it.body });
          commit(items.filter((i) => i.id !== it.id));
          sent++;
        } catch (e) {
          if (e instanceof NetworkError) break; // toujours hors-ligne : on réessaiera
          if (e instanceof ApiError && (e.status === 401 || e.status >= 500)) break; // reconnexion / panne serveur : réessai plus tard
          const msg = e instanceof ApiError ? e.message : 'Erreur inconnue';
          commit(items.map((i) => (i.id === it.id ? { ...i, error: msg } : i)));
          failed++;
        }
      }
    } finally {
      flushing = false;
    }
    return { sent, failed };
  },
};

export const useOutbox = () => useSyncExternalStore(outbox.subscribe, outbox.all, outbox.all);
