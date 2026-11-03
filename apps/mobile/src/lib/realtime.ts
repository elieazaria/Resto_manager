import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import { getServerUrl } from './config';
import { outbox } from './outbox';

export type LinkState = 'live' | 'connecting' | 'offline';

/** Actualisation périodique (sans WebSocket) : toutes les 8 s l'appli est active, on teste le serveur, on rejoue la file hors-ligne et on rafraîchit. */
export function useRealtime(enabled: boolean): LinkState {
  const qc = useQueryClient();
  const [state, setState] = useState<LinkState>('connecting');

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let busy = false;

    const tick = async (force = false) => {
      if (stopped || busy || (!force && AppState.currentState !== 'active')) return;
      busy = true;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(`${getServerUrl()}/healthz`, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
        if (stopped) return;
        if (!res.ok) throw new Error('down');
        setState('live');
        await outbox.flush();
        for (const key of ['pos-tables', 'orders', 'dashboard']) void qc.invalidateQueries({ queryKey: [key] });
      } catch {
        if (!stopped) setState('offline');
      } finally {
        busy = false;
      }
    };

    const unsubNet = NetInfo.addEventListener((s) => s.isConnected && void tick(true));
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void tick(true));
    void tick(true);
    const t = setInterval(() => void tick(), 8000);
    return () => {
      stopped = true;
      clearInterval(t);
      unsubNet();
      sub.remove();
    };
  }, [enabled, qc]);

  return state;
}
