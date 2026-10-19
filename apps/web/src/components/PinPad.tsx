import { Delete } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Pavé numérique tactile pour le PIN du caissier (4 à 6 chiffres). */
export function PinPad({ value, onChange, onSubmit, max = 6, disabled }: { value: string; onChange: (v: string) => void; onSubmit: () => void; max?: number; disabled?: boolean }) {
  const press = (d: string) => value.length < max && onChange(value + d);
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const btn = 'h-16 rounded-lg border border-border bg-card text-2xl font-display font-medium active:bg-muted disabled:opacity-50';
  return (
    <div className="mx-auto w-full max-w-xs">
      <div className="mb-4 flex h-12 items-center justify-center gap-3" aria-live="polite" aria-label={`${value.length} chiffres saisis`}>
        {Array.from({ length: max }).map((_, i) => (
          <span key={i} className={cn('size-3.5 rounded-full border-2', i < value.length ? 'border-primary bg-primary' : 'border-input')} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {keys.map((k) => (
          <button key={k} type="button" className={btn} disabled={disabled} onClick={() => press(k)}>{k}</button>
        ))}
        <button type="button" className={cn(btn, 'text-base')} disabled={disabled} onClick={() => onChange('')} aria-label="Effacer tout">Effacer</button>
        <button type="button" className={btn} disabled={disabled} onClick={() => press('0')}>0</button>
        <button type="button" className={btn} disabled={disabled} onClick={() => onChange(value.slice(0, -1))} aria-label="Supprimer le dernier chiffre"><Delete className="mx-auto size-6" /></button>
      </div>
      <button type="button" disabled={disabled || value.length < 4} onClick={onSubmit} className="mt-3 h-14 w-full rounded-lg bg-primary text-lg font-medium text-primary-foreground disabled:opacity-40">
        Ouvrir la caisse
      </button>
    </div>
  );
}
