import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BASE } from './api';
import { outbox } from './outbox';

export type LinkState = 'live' | 'connecting' | 'offline';

const POLL_MS = 8000;

/**
 * Actualisation périodique (sans WebSocket) : toutes les 8 s, tant que l'onglet est visible, on teste le serveur,
 * on rejoue la file d'attente hors-ligne et on invalide les requêtes (tables, commandes, tableau de bord, stock).
 * Les données réelles viennent toujours de l'API, qui applique les droits.
 */
export function useRealtime(enabled: boolean): LinkState {
  const qc = useQueryClient();
  const [state, setState] = useState<LinkState>('connecting');

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let busy = false;

    const tick = async (force = false) => {
      if (stopped || busy || (!force && document.visibilityState !== 'visible')) return;
      busy = true;
      try {
        const ctrl = new AbortController();
        const timer = window.setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(`${BASE}/healthz`, { cache: 'no-store', signal: ctrl.signal }).finally(() => window.clearTimeout(timer));
        if (stopped) return;
        if (!res.ok) throw new Error('down');
        setState('live');
        const { sent } = await outbox.flush();
        for (const key of ['pos-tables', 'orders', 'dashboard', 'stock']) void qc.invalidateQueries({ queryKey: [key] });
        if (sent) void qc.invalidateQueries({ queryKey: ['pos-tables'] });
      } catch {
        if (!stopped) setState('offline');
      } finally {
        busy = false;
      }
    };

    const onWake = () => void tick(true);
    window.addEventListener('online', onWake);
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    void tick(true);
    const t = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(t);
      window.removeEventListener('online', onWake);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [enabled, qc]);

  return state;
}
