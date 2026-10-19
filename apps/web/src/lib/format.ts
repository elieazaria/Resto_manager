import { formatAr } from '@resto/shared';

export const APP_TZ = (import.meta.env.VITE_APP_TZ as string | undefined) ?? 'Indian/Antananarivo';
export const money = formatAr;

const dtf = new Intl.DateTimeFormat('fr-FR', {
  timeZone: APP_TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const tf = new Intl.DateTimeFormat('fr-FR', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit' });

export const fmtDateTime = (iso: string | Date) => dtf.format(new Date(iso)).replace(',', '');
export const fmtTime = (iso: string | Date) => tf.format(new Date(iso));
/** AAAA-MM-JJ -> JJ/MM/AAAA */
export const fmtDate = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
export const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ }).format(new Date());
export function shiftDate(d: string, days: number) {
  const dt = new Date(`${d}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
export function compactAr(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')} M`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)} k`;
  return String(n);
}
export function since(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "à l'instant";
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}
export const fmtQty = (n: number) => (Math.round(n * 100) / 100).toLocaleString('fr-FR');
