import { useSyncExternalStore } from 'react';
import type { OrderDto, Settings } from '@resto/shared';
import { buildTicketEscPos, toBase64 } from './escpos';

export type PrintMode = 'browser' | 'rawbt';
interface DevicePrefs {
  mode: PrintMode;
  autoPrint: boolean;
}
const KEY = 'resto.device';

export function getPrefs(): DevicePrefs {
  try {
    return { mode: 'browser', autoPrint: true, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { mode: 'browser', autoPrint: true };
  }
}
export function setPrefs(p: Partial<DevicePrefs>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...getPrefs(), ...p }));
  } catch {
    /* ignore */
  }
}

/* Store minimal : le ticket à imprimer est rendu dans #print-root (voir PrintHost) */
let current: { order: OrderDto; settings: Settings } | null = null;
const subs = new Set<() => void>();
export const printStore = {
  get: () => current,
  subscribe: (fn: () => void) => (subs.add(fn), () => subs.delete(fn)),
  set(v: typeof current) {
    current = v;
    subs.forEach((f) => f());
  },
};
export const usePrintJob = () => useSyncExternalStore(printStore.subscribe, printStore.get, printStore.get);

/**
 * Imprime un ticket.
 * - rawbt   : envoie l'ESC/POS à l'appli Android « RawBT » (imprimante Bluetooth/USB, sans boîte de dialogue)
 * - browser : impression du navigateur (ticket mis en page 58/80 mm ; silencieuse avec Chrome --kiosk-printing)
 */
export function printTicket(order: OrderDto, settings: Settings) {
  if (getPrefs().mode === 'rawbt') {
    const bytes = buildTicketEscPos(order, settings);
    window.location.href = `rawbt:base64,${toBase64(bytes)}`;
    return;
  }
  printStore.set({ order, settings });
}
