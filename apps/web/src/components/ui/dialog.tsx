import * as React from 'react';
import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

/** Fenêtre centrée sur ordinateur ; feuille qui monte du bas sur téléphone. */
export const DialogContent = React.forwardRef<
  React.ElementRef<typeof D.Content>,
  React.ComponentPropsWithoutRef<typeof D.Content> & { size?: 'sm' | 'md' | 'lg' | 'xl'; side?: 'center' | 'left' }
>(({ className, children, size = 'md', side = 'center', ...p }, ref) => (
  <D.Portal>
    <D.Overlay className="fixed inset-0 z-50 bg-ink/55 data-[state=open]:animate-in data-[state=open]:fade-in" />
    <D.Content
      ref={ref}
      className={cn(
        'fixed z-50 flex max-h-[92dvh] flex-col overflow-hidden bg-card shadow-xl outline-none',
        side === 'left'
          ? 'inset-y-0 left-0 w-[85vw] max-w-xs'
          : cn(
              'inset-x-0 bottom-0 rounded-t-xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl',
              { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size],
            ),
        className,
      )}
      {...p}
    >
      {children}
      <D.Close className="absolute right-3 top-3 rounded-md p-2 text-muted-foreground hover:bg-muted" aria-label="Fermer">
        <X className="size-4" />
      </D.Close>
    </D.Content>
  </D.Portal>
));
DialogContent.displayName = 'DialogContent';

export const DialogHeader = ({ title, description }: { title: string; description?: string }) => (
  <div className="border-b border-border px-5 pb-3 pt-4 pr-12">
    <D.Title className="font-display text-lg font-semibold">{title}</D.Title>
    {description ? (
      <D.Description className="mt-0.5 text-sm text-muted-foreground">{description}</D.Description>
    ) : (
      <D.Description className="sr-only">{title}</D.Description>
    )}
  </div>
);
export const DialogBody = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex-1 overflow-y-auto px-5 py-4', className)} {...p} />
);
export const DialogFooter = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-wrap justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]', className)} {...p} />
);
