import type { OrderDto, Settings } from '@resto/shared';
import { layoutTicket, type TicketLine } from './ticket';

const ESC = 0x1b;
const GS = 0x1d;

/** Les imprimantes thermiques ont des pages de codes variables : on retire les accents, tout reste en ASCII imprimable. */
export function toAscii(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/[^\x20-\x7e]/g, '?');
}

/** Encode un ticket en commandes ESC/POS (80 mm ou 58 mm). */
export function encodeEscPos(lines: TicketLine[], width: number, opts: { cut?: boolean } = {}): Uint8Array {
  const out: number[] = [ESC, 0x40]; // initialisation
  const push = (...b: number[]) => out.push(...b);
  for (const l of lines) {
    const cols = l.big ? Math.floor(width / 2) : width;
    let text = toAscii(l.text);
    if (l.align === 'center') text = text.length >= cols ? text : ' '.repeat(Math.floor((cols - text.length) / 2)) + text;
    else if (l.align === 'right') text = text.padStart(cols);
    push(ESC, 0x45, l.bold ? 1 : 0); // gras
    push(GS, 0x21, l.big ? 0x10 : 0x00); // double largeur
    for (const ch of text) out.push(ch.charCodeAt(0));
    push(0x0a);
  }
  push(GS, 0x21, 0x00, ESC, 0x45, 0x00);
  push(ESC, 0x64, 3); // 3 lignes d'avance
  if (opts.cut !== false) push(GS, 0x56, 0x42, 0x00); // coupe partielle
  return Uint8Array.from(out);
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Raccourci : ticket complet (mise en page + encodage) pour une commande. */
export function buildTicketEscPos(order: OrderDto, settings: Settings, opts: { cut?: boolean } = {}): Uint8Array {
  return encodeEscPos(layoutTicket(order, settings), settings.paper_width, opts);
}
