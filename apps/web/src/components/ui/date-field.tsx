import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const sel = 'h-11 min-w-0 rounded-md border border-input bg-card px-2 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, '0');

/** Date au format jour / mois / année (même affichage sur tous les appareils). Valeur : « AAAA-MM-JJ ». */
export function DateField({ value, onChange, min, max, className, id, 'aria-label': label }: {
  value: string; onChange: (v: string) => void; min?: string; max?: string; className?: string; id?: string; 'aria-label'?: string;
}) {
  const parse = (v: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); return m ? { y: +m[1]!, m: +m[2]!, d: +m[3]! } : { y: 0, m: 0, d: 0 }; };
  const [p, setP] = useState(parse(value));
  useEffect(() => setP(parse(value)), [value]);

  const thisYear = new Date().getFullYear();
  const lo = min ? +min.slice(0, 4) : Math.min(thisYear - 6, p.y || thisYear);
  const hi = max ? +max.slice(0, 4) : Math.max(thisYear + 3, p.y || thisYear);
  const years = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

  const commit = (n: { y: number; m: number; d: number }) => {
    setP(n);
    if (!n.y || !n.m || !n.d) return;
    let v = `${n.y}-${pad(n.m)}-${pad(Math.min(n.d, daysIn(n.y, n.m)))}`;
    if (min && v < min) v = min;
    if (max && v > max) v = max;
    onChange(v);
  };
  const dim = p.y && p.m ? daysIn(p.y, p.m) : 31;

  return (
    <div className={cn('inline-flex items-center gap-1.5', className)} role="group" aria-label={label}>
      <select id={id} className={cn(sel, 'w-[4.25rem]')} value={p.d || ''} onChange={(e) => commit({ ...p, d: +e.target.value })} aria-label={`${label ?? 'Date'} : jour`}>
        <option value="" disabled>Jj</option>
        {Array.from({ length: dim }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{pad(d)}</option>)}
      </select>
      <select className={cn(sel, 'w-[5.25rem]')} value={p.m || ''} onChange={(e) => commit({ ...p, m: +e.target.value })} aria-label={`${label ?? 'Date'} : mois`}>
        <option value="" disabled>Mois</option>
        {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
      <select className={cn(sel, 'w-[5rem]')} value={p.y || ''} onChange={(e) => commit({ ...p, y: +e.target.value })} aria-label={`${label ?? 'Date'} : année`}>
        <option value="" disabled>Année</option>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}
