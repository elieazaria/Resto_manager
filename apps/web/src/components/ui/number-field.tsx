import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Input } from './input';

/**
 * Champ numérique adapté au téléphone : on peut effacer et retaper librement (le texte en cours est conservé,
 * la valeur n'est bornée qu'à la sortie du champ), pavé numérique, boutons − / + facultatifs.
 */
export function NumberField({ value, onChange, min = 0, max = 999_999, stepper = true, className, inputClassName, id, disabled, ...rest }: {
  value: number; onChange: (n: number) => void; min?: number; max?: number; stepper?: boolean;
  className?: string; inputClassName?: string; id?: string; disabled?: boolean; 'aria-label'?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(String(value)); }, [value, focused]);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const set = (n: number) => { const v = clamp(Math.round(Number.isFinite(n) ? n : min)); onChange(v); setDraft(String(v)); };
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {stepper && <Button type="button" size="icon" variant="outline" aria-label="Diminuer" disabled={disabled || value <= min} onClick={() => set(value - 1)}><Minus /></Button>}
      <Input
        id={id} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" disabled={disabled} aria-label={rest['aria-label']}
        className={cn('num min-w-0 text-center', inputClassName)} value={draft}
        onFocus={(e) => { setFocused(true); e.target.select(); }}
        onChange={(e) => {
          const t = e.target.value.replace(/\D/g, '');
          setDraft(t);
          if (t !== '') onChange(clamp(Number(t))); // la valeur suit la saisie ; l'affichage reste libre jusqu'à la sortie
        }}
        onBlur={() => { setFocused(false); set(draft === '' ? min : Number(draft)); }}
      />
      {stepper && <Button type="button" size="icon" variant="outline" aria-label="Augmenter" disabled={disabled || value >= max} onClick={() => set(value + 1)}><Plus /></Button>}
    </div>
  );
}
