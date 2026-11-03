import { shiftDate } from './format';

export type PeriodKind = 'day' | 'week' | 'month' | 'year';
export type CompareKind = 'previous' | 'lastyear' | 'none';
export interface Period { from: string; to: string }

export const PERIOD_LABELS: Record<PeriodKind, string> = { day: 'Jour', week: 'Semaine', month: 'Mois', year: 'Année' };
const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Bornes (incluses) de la période qui contient `ref` (semaine = lundi → dimanche). */
export function periodOf(kind: PeriodKind, ref: string): Period {
  const y = Number(ref.slice(0, 4));
  const m = Number(ref.slice(5, 7));
  switch (kind) {
    case 'day': return { from: ref, to: ref };
    case 'week': {
      const dow = (new Date(`${ref}T12:00:00Z`).getUTCDay() + 6) % 7;
      const from = shiftDate(ref, -dow);
      return { from, to: shiftDate(from, 6) };
    }
    case 'month': return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}` };
    case 'year': return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
}

/** Période de comparaison : la précédente (même durée / mois / année) ou la même période un an plus tôt. */
export function comparePeriod(kind: PeriodKind, p: Period, how: Exclude<CompareKind, 'none'>): Period {
  const shiftYear = (d: string, n: number) => {
    const y = Number(d.slice(0, 4)) + n;
    const m = Number(d.slice(5, 7));
    return `${y}-${pad(m)}-${pad(Math.min(Number(d.slice(8, 10)), lastDayOfMonth(y, m)))}`;
  };
  if (how === 'lastyear') {
    if (kind === 'week') return { from: shiftDate(p.from, -364), to: shiftDate(p.to, -364) }; // même jour de semaine
    return { from: shiftYear(p.from, -1), to: shiftYear(p.to, -1) };
  }
  switch (kind) {
    case 'day': return { from: shiftDate(p.from, -1), to: shiftDate(p.to, -1) };
    case 'week': return { from: shiftDate(p.from, -7), to: shiftDate(p.to, -7) };
    case 'month': return periodOf('month', shiftDate(p.from, -1));
    case 'year': return periodOf('year', shiftYear(p.from, -1));
  }
}

export const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 1000) / 10 : a ? null : 0);
