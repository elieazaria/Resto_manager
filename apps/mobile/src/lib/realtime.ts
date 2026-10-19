import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeEvent } from '@resto/shared';
import { getToken, wsUrl } from './api';
import { outbox } from './outbox';

export type LinkState = 'live' | 'connecting' | 'offline';

/** WebSocket avec reconnexion ; chaque évènement invalide les requêtes concernées. Rejoue aussi la file hors-ligne. */
export function useRealtime(enabled: boolean): LinkState {
  const qc = useQueryClient();
  const [state, setState] = useState<LinkState>('connecting');

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let retry = 0;

    const refreshAll = () => {
      void qc.invalidateQueries({ queryKey: ['pos-tables'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
    };
    const flush = () => void outbox.flush().then(({ sent }) => sent && refreshAll());

    const connect = () => {
      const token = getToken();
      if (!token || closed) return;
      setState('connecting');
      try {
        ws = new WebSocket(wsUrl());
      } catch {
        timer = setTimeout(connect, 5000);
        return;
      }
      ws.onopen = () => ws?.send(JSON.stringify({ type: 'auth', token }));
      ws.onmessage = (m) => {
        let msg: RealtimeEvent | { type: 'ready' };
        try {
          msg = JSON.parse(String(m.data));
        } catch {
          return;
        }
        if (msg.type === 'ready') {
          retry = 0;
          setState('live');
          refreshAll();
          flush();
        } else if (msg.type === 'order.changed') {
          refreshAll();
          void qc.invalidateQueries({ queryKey: ['dashboard'] });
        } else if (msg.type === 'stock.changed') {
          void qc.invalidateQueries({ queryKey: ['dashboard'] });
        }
      };
      ws.onclose = (ev) => {
        setState('offline');
        if (closed || ev.code === 4401) return;
        timer = setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++));
      };
      ws.onerror = () => ws?.close();
    };

    const reconnectNow = () => {
      flush();
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        if (timer) clearTimeout(timer);
        retry = 0;
        connect();
      }
    };
    const unsubNet = NetInfo.addEventListener((s) => s.isConnected && reconnectNow());
    const sub = AppState.addEventListener('change', (s) => s === 'active' && reconnectNow());
    const poll = setInterval(flush, 20000); // filet de sécurité si le WebSocket est coupé
    connect();
    return () => {
      closed = true;
      unsubNet();
      sub.remove();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, [enabled, qc]);

  return state;
}
