import { useQueryClient } from '@tanstack/react-query';
import type { OrderDto, PaymentMethod, PosMenuDto, PosTableDto } from '@resto/shared';
import { api, ApiError, NetworkError } from './api';
import { useAuth } from './auth';
import { outbox } from './outbox';
import { printTicket } from './print';
import { useMenu, useSettings, useTables } from './hooks';

export interface CheckoutLine { menu_item_id: string; quantity: number; note?: string | null }
export interface CheckoutInput {
  orderId: string;
  tableId: string;
  lines: CheckoutLine[];
  pay?: { method: PaymentMethod; received: number | null };
  print: boolean;
}
export interface CheckoutResult { order: OrderDto; queued: boolean; printError: string | null }

/** Fusionne les doublons d'un même plat (quantités additionnées, max 99). */
export function mergeLines(lines: CheckoutLine[]): CheckoutLine[] {
  const m = new Map<string, CheckoutLine>();
  for (const l of lines) {
    const cur = m.get(l.menu_item_id);
    m.set(l.menu_item_id, { menu_item_id: l.menu_item_id, quantity: Math.min(99, (cur?.quantity ?? 0) + l.quantity), note: cur?.note ?? l.note ?? null });
  }
  return [...m.values()];
}

/**
 * Enregistrement d'une commande : PUT idempotent, puis (option) encaissement, puis impression.
 * Sans réseau, les appels vont dans la file d'attente et un ticket local est imprimé quand même.
 */
export function useCheckout() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const menu = useMenu();
  const tables = useTables();
  const settings = useSettings();

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['pos-tables'] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
  };

  const localOrder = (inp: CheckoutInput, lines: CheckoutLine[], status: 'open' | 'paid'): OrderDto => {
    const byId = new Map((menu.data as PosMenuDto | undefined)?.items.map((i) => [i.id, i]) ?? []);
    const dto = lines.map((l) => ({
      id: l.menu_item_id, menu_item_id: l.menu_item_id, name: byId.get(l.menu_item_id)?.name ?? '?',
      unit_price: byId.get(l.menu_item_id)?.price ?? 0, quantity: l.quantity, note: l.note ?? null,
    }));
    const total = dto.reduce((a, l) => a + l.unit_price * l.quantity, 0);
    const now = new Date().toISOString();
    return {
      id: inp.orderId, ticket_no: 0, table_id: inp.tableId,
      table_name: (tables.data as PosTableDto[] | undefined)?.find((t) => t.id === inp.tableId)?.name ?? '',
      status, note: null, total,
      payment_method: status === 'paid' ? inp.pay!.method : null,
      amount_received: status === 'paid' ? (inp.pay!.method === 'cash' ? (inp.pay!.received ?? total) : total) : null,
      business_date: null, created_at: now, paid_at: status === 'paid' ? now : null,
      opened_by_name: user?.full_name ?? null, paid_by_name: status === 'paid' ? (user?.full_name ?? null) : null, void_reason: null,
      lines: dto,
    };
  };

  async function submit(inp: CheckoutInput): Promise<CheckoutResult> {
    const lines = mergeLines(inp.lines);
    const path = `/orders/${inp.orderId}`;
    const body = { table_id: inp.tableId, lines };
    const label = (tables.data as PosTableDto[] | undefined)?.find((t) => t.id === inp.tableId)?.name ?? '';
    let order: OrderDto | null = null;
    let queued = false;
    try {
      try {
        order = await api<OrderDto>(path, { method: 'PUT', body });
      } catch (e) {
        if (!(e instanceof NetworkError)) throw e;
        outbox.enqueue({ method: 'PUT', path, body, label: `Commande ${label}` });
        queued = true;
      }
      if (inp.pay) {
        const payBody = { method: inp.pay.method, amount_received: inp.pay.method === 'cash' ? (inp.pay.received ?? null) : null };
        const queuePay = () => {
          outbox.enqueue({ method: 'POST', path: `${path}/pay`, body: payBody, label: `Encaissement ${label}` });
          order = localOrder(inp, lines, 'paid');
          queued = true;
        };
        if (queued) queuePay();
        else {
          try {
            order = await api<OrderDto>(`${path}/pay`, { method: 'POST', body: payBody });
          } catch (e) {
            if (!(e instanceof NetworkError)) throw e;
            queuePay();
          }
        }
      }
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'TABLE_BUSY' || e.code === 'ORDER_CLOSED')) refresh();
      throw e;
    }
    const final = order ?? localOrder(inp, lines, inp.pay ? 'paid' : 'open');
    const printError = inp.print ? await printTicket(final, settings) : null;
    refresh();
    return { order: final, queued, printError };
  }

  return { submit, ready: !!menu.data, settings, reprint: (o: OrderDto) => printTicket(o, settings) };
}
