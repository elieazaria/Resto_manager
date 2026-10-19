import { Linking } from 'react-native';
import * as Print from 'expo-print';
import type { OrderDto, Settings } from '@resto/shared';
import { buildTicketEscPos, toBase64 } from './escpos';
import { layoutTicket } from './ticket';
import { getJson, setJson } from './storage';

/**
 * rawbt  : envoie l'ESC/POS à l'application Android « RawBT » (imprimante thermique Bluetooth/USB, sans boîte de dialogue)
 * system : impression Android (service d'impression de l'appareil : Wi-Fi, PDF, plugin du fabricant de l'imprimante)
 */
export type PrintMode = 'rawbt' | 'system';
export interface DevicePrefs {
  mode: PrintMode;
  autoPrint: boolean;
}
const KEY = 'resto.device';
let prefs: DevicePrefs = { mode: 'rawbt', autoPrint: true };

export const getPrefs = () => prefs;
export async function loadPrefs() {
  prefs = { ...prefs, ...(await getJson<Partial<DevicePrefs>>(KEY, {})) };
  return prefs;
}
export async function setPrefs(p: Partial<DevicePrefs>) {
  prefs = { ...prefs, ...p };
  await setJson(KEY, prefs);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function ticketHtml(order: OrderDto, settings: Settings) {
  const w = settings.paper_width;
  const rows = layoutTicket(order, settings)
    .map((l) => {
      const style = [l.align ? `text-align:${l.align}` : '', l.bold ? 'font-weight:700' : '', l.big ? 'font-size:1.6em' : ''].filter(Boolean).join(';');
      return `<div style="${style};white-space:pre">${esc(l.text) || '&nbsp;'}</div>`;
    })
    .join('');
  const mm = w <= 32 ? 58 : 80;
  return `<html><head><meta name="viewport" content="width=device-width"/><style>
    @page{margin:0;size:${mm}mm auto}
    body{margin:0;padding:2mm;width:${mm - 4}mm;font-family:monospace;font-size:${w <= 32 ? 9 : 10}pt;color:#000}
  </style></head><body>${rows}</body></html>`;
}

/** Imprime un ticket (addition si non payé, ticket de caisse sinon). Renvoie une erreur lisible si l'impression échoue. */
export async function printTicket(order: OrderDto, settings: Settings): Promise<string | null> {
  try {
    if (prefs.mode === 'rawbt') {
      const bytes = buildTicketEscPos(order, settings);
      await Linking.openURL(`rawbt:base64,${toBase64(bytes)}`);
    } else {
      await Print.printAsync({ html: ticketHtml(order, settings) });
    }
    return null;
  } catch (e) {
    if (prefs.mode === 'rawbt') return "Application RawBT introuvable : installez-la depuis le Play Store, ou passez en « Impression Android » dans les réglages.";
    return e instanceof Error ? e.message : "Impossible d'imprimer";
  }
}
