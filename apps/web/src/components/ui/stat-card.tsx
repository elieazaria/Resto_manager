import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type Tone = 'green' | 'violet' | 'blue' | 'red';
const VAR: Record<Tone, string> = { green: 'var(--tone-green)', violet: 'var(--tone-violet)', blue: 'var(--tone-blue)', red: 'var(--tone-red)' };

/** Carte chiffre clé : fond teinté, pastille d'icône, valeur en gras. */
export function StatCard({ label, value, hint, tone = 'green', icon: Icon, negative }: { label: string; value: string; hint?: string; tone?: Tone; icon?: LucideIcon; negative?: boolean }) {
  const c = VAR[tone];
  return (
    <div className="rounded-xl border px-4 py-3.5" style={{ background: `color-mix(in srgb, ${c} 9%, var(--card))`, borderColor: `color-mix(in srgb, ${c} 22%, var(--border))` }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        {Icon && <span className="grid size-8 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c }}><Icon className="size-4" /></span>}
      </div>
      <p className={cn('num mt-1.5 font-display text-2xl font-semibold sm:text-[1.7rem]', negative && 'text-destructive')}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
