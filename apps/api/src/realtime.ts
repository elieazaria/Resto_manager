import type { WebSocket } from 'ws';
import type { RealtimeEvent, Role } from '@resto/shared';
import type { AuthUser } from './auth.js';

/**
 * Hub WebSocket : les clients s'authentifient par un premier message {type:'auth', token}
 * (le jeton ne transite donc jamais dans l'URL / les logs). Les évènements ne contiennent
 * aucune donnée sensible : le client rafraîchit ensuite via l'API (qui applique le RBAC).
 */
export class Hub {
  private clients = new Map<WebSocket, { user: AuthUser; alive: boolean }>();
  private timer?: NodeJS.Timeout;

  start() {
    this.timer = setInterval(() => {
      for (const [ws, st] of this.clients) {
        if (!st.alive) {
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }
        st.alive = false;
        try {
          ws.ping();
        } catch {
          /* socket fermé */
        }
      }
    }, 30_000);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    for (const ws of this.clients.keys()) ws.close(1001, 'server shutdown');
    this.clients.clear();
  }

  add(ws: WebSocket, user: AuthUser) {
    this.clients.set(ws, { user, alive: true });
    ws.on('pong', () => {
      const st = this.clients.get(ws);
      if (st) st.alive = true;
    });
  }

  remove(ws: WebSocket) {
    this.clients.delete(ws);
  }

  get size() {
    return this.clients.size;
  }

  broadcast(event: RealtimeEvent, roles?: Role[]) {
    const payload = JSON.stringify(event);
    for (const [ws, st] of this.clients) {
      if (roles && !roles.includes(st.user.role)) continue;
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }
}
