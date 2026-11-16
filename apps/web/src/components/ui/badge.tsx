import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const badge = cva('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-[#e5e7eb] text-[#374151] ring-1 ring-inset ring-black/10',
      ok: 'bg-[#d3f0dd] text-[#0a6a2f] ring-1 ring-inset ring-[#0a6a2f]/25',
      warn: 'bg-[#ffe3a8] text-[#7a3f00] ring-1 ring-inset ring-[#b45309]/30',
      danger: 'bg-[#9d0208] text-white',
      info: 'bg-[#1f6fa3] text-white',
      ink: 'bg-[#0d3b5c] text-white',
      light: 'bg-white text-[#0d3b5c]',
    },
  },
  defaultVariants: { tone: 'neutral' },
});
export const Badge = ({ className, tone, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) => (
  <span className={cn(badge({ tone }), className)} {...p} />
);
