/** Formats indépendants d'Intl (support variable selon les appareils Android). */
const TZ_OFFSET_MIN = 3 * 60; // Indian/Antananarivo = UTC+3, sans heure d'été

export const group = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const money = (n: number | null | undefined) => `${group(Number(n ?? 0))} Ar`;

const p2 = (n: number) => String(n).padStart(2, '0');
function local(iso: string | Date) {
  const d = new Date(new Date(iso).getTime() + TZ_OFFSET_MIN * 60_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}
export function fmtDateTime(iso: string | Date) {
  const t = local(iso);
  return `${p2(t.d)}/${p2(t.m)}/${t.y} ${p2(t.h)}:${p2(t.mi)}`;
}
export function fmtTime(iso: string | Date) {
  const t = local(iso);
  return `${p2(t.h)}:${p2(t.mi)}`;
}
export function since(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${p2(min % 60)}`;
}
