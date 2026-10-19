import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const badge = cva('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-muted text-muted-foreground',
      ok: 'bg-primary/12 text-primary',
      warn: 'bg-accent/35 text-[#5c3d00]',
      danger: 'bg-destructive/12 text-destructive',
      ink: 'bg-ink text-ink-foreground',
    },
  },
  defaultVariants: { tone: 'neutral' },
});
export const Badge = ({ className, tone, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) => (
  <span className={cn(badge({ tone }), className)} {...p} />
);
