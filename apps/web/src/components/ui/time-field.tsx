import { cn } from '@/lib/utils';

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const BASE_MIN = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
const sel = 'h-11 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-center text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';

/** Heure au format 24 h (« 13:00 »), identique sur tous les téléphones (pas de AM/PM). */
export function TimeField24({ value, onChange, className, 'aria-label': label }: { value: string; onChange: (v: string) => void; className?: string; 'aria-label'?: string }) {
  const m = /^(\d{2}):(\d{2})$/.exec(value) ?? ['', '14', '00'];
  const h = m[1]!;
  const mi = m[2]!;
  const mins = BASE_MIN.includes(mi) ? BASE_MIN : [...BASE_MIN, mi].sort();
  return (
    <div className={cn('flex items-center gap-1.5', className)} role="group" aria-label={label}>
      <select className={sel} value={h} onChange={(e) => onChange(`${e.target.value}:${mi}`)} aria-label={`${label ?? 'Heure'} : heures`}>
        {HOURS.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <span className="font-semibold">:</span>
      <select className={sel} value={mi} onChange={(e) => onChange(`${h}:${e.target.value}`)} aria-label={`${label ?? 'Heure'} : minutes`}>
        {mins.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <span className="text-xs text-muted-foreground">h</span>
    </div>
  );
}
