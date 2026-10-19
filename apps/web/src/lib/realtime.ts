import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeEvent } from '@resto/shared';
import { getToken, wsUrl } from './api';
import { outbox } from './outbox';

export type LinkState = 'live' | 'connecting' | 'offline';

/**
 * Connexion WebSocket (reconnexion automatique). Chaque évènement invalide simplement les requêtes
 * concernées : les données réelles viennent toujours de l'API, qui applique les droits.
 * À la reconnexion on rejoue aussi la file d'attente hors-ligne.
 */
export function useRealtime(enabled: boolean): LinkState {
  const qc = useQueryClient();
  const [state, setState] = useState<LinkState>('connecting');
  const retry = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let timer: number | undefined;
    let closed = false;

    const refreshAll = () => {
      void qc.invalidateQueries({ queryKey: ['pos-tables'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
    };

    const connect = () => {
      const token = getToken();
      if (!token || closed) return;
      setState('connecting');
      ws = new WebSocket(wsUrl());
      ws.onopen = () => ws?.send(JSON.stringify({ type: 'auth', token }));
      ws.onmessage = (m) => {
        let msg: RealtimeEvent | { type: 'ready' };
        try {
          msg = JSON.parse(m.data);
        } catch {
          return;
        }
        if (msg.type === 'ready') {
          retry.current = 0;
          setState('live');
          refreshAll();
          void outbox.flush().then(({ sent }) => sent && refreshAll());
        } else if (msg.type === 'order.changed') {
          refreshAll();
          void qc.invalidateQueries({ queryKey: ['order', msg.order_id] });
          void qc.invalidateQueries({ queryKey: ['dashboard'] });
        } else if (msg.type === 'stock.changed') {
          void qc.invalidateQueries({ queryKey: ['stock'] });
          void qc.invalidateQueries({ queryKey: ['dashboard'] });
        }
      };
      ws.onclose = (ev) => {
        setState('offline');
        if (closed || ev.code === 4401) return; // 4401 : jeton refusé, la session sera fermée par l'API
        const delay = Math.min(15000, 1000 * 2 ** retry.current++);
        timer = window.setTimeout(connect, delay);
      };
      ws.onerror = () => ws?.close();
    };

    const onOnline = () => {
      void outbox.flush().then(({ sent }) => sent && refreshAll());
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        window.clearTimeout(timer);
        retry.current = 0;
        connect();
      }
    };
    window.addEventListener('online', onOnline);
    connect();
    return () => {
      closed = true;
      window.removeEventListener('online', onOnline);
      window.clearTimeout(timer);
      ws?.close();
    };
  }, [enabled, qc]);

  return state;
}
