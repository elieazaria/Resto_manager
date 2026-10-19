import { PAYMENT_LABELS, type OrderDto, type Settings } from '@resto/shared';
import { fmtDateTime, group, money } from './format';

/** Représentation neutre du ticket : sert à la fois à l'aperçu/impression navigateur et à l'ESC/POS. */
export interface TicketLine {
  text: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  big?: boolean;
}

const center = (s: string, w: number) => (s.length >= w ? s : ' '.repeat(Math.floor((w - s.length) / 2)) + s);
const sep = (w: number) => '-'.repeat(w);
function row(left: string, right: string, w: number) {
  const gap = w - left.length - right.length;
  return gap >= 1 ? left + ' '.repeat(gap) + right : `${left.slice(0, Math.max(0, w - right.length - 1))} ${right}`;
}
function wrap(text: string, w: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= w) cur += ` ${word}`;
    else {
      out.push(cur);
      cur = word;
    }
    while (cur.length > w) {
      out.push(cur.slice(0, w));
      cur = cur.slice(w);
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}
const num = (n: number) => group(n);

/** `width` = nombre de colonnes du papier (32 pour 58 mm, 42/48 pour 80 mm). */
export function layoutTicket(order: OrderDto, s: Pick<Settings, 'restaurant_name' | 'address' | 'phone' | 'ticket_footer' | 'paper_width'>): TicketLine[] {
  const w = s.paper_width;
  const L: TicketLine[] = [];
  const add = (text: string, o: Omit<TicketLine, 'text'> = {}) => L.push({ text, ...o });

  for (const part of wrap(s.restaurant_name.toUpperCase(), Math.floor(w / 2))) add(part, { align: 'center', bold: true, big: true });
  if (s.address) wrap(s.address, w).forEach((t) => add(t, { align: 'center' }));
  if (s.phone) add(`Tel : ${s.phone}`, { align: 'center' });
  add(sep(w));

  const paid = order.status === 'paid';
  add(paid ? `TICKET ${order.ticket_no ? '#' + order.ticket_no : ''}`.trim() : 'ADDITION', { align: 'center', bold: true });
  add(row(order.table_name, fmtDateTime(order.paid_at ?? order.created_at), w));
  const who = order.paid_by_name ?? order.opened_by_name;
  if (who) add(`Caissier : ${who}`);
  add(sep(w));

  for (const l of order.lines) {
    const amount = num(l.unit_price * l.quantity);
    const left = wrap(`${l.quantity} x ${l.name}`, w - amount.length - 1);
    add(row(left[0]!, amount, w));
    left.slice(1).forEach((t) => add(`  ${t}`));
    if (l.note) wrap(`> ${l.note}`, w - 2).forEach((t) => add(`  ${t}`));
  }
  add(sep(w));
  add(row('TOTAL', money(order.total), Math.floor(w / 2)), { bold: true, big: true, align: 'right' });

  if (paid && order.payment_method) {
    add(`Paiement : ${PAYMENT_LABELS[order.payment_method]}`);
    if (order.payment_method === 'cash' && order.amount_received != null) {
      add(row('Recu', money(order.amount_received), w));
      add(row('Rendu', money(Math.max(0, order.amount_received - order.total)), w));
    }
  } else {
    add("Addition - non payee", { align: 'center' });
  }
  add(sep(w));
  if (s.ticket_footer) wrap(s.ticket_footer, w).forEach((t) => add(t, { align: 'center' }));
  return L;
}

/** Texte brut aligné (aperçu / tests). */
export function renderPlain(lines: TicketLine[], w: number) {
  return lines.map((l) => (l.align === 'center' ? center(l.text, l.big ? Math.floor(w / 2) : w) : l.align === 'right' ? l.text.padStart(l.big ? Math.floor(w / 2) : w) : l.text));
}
