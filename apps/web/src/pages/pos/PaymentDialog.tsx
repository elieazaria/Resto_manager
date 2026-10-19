import { useState } from 'react';
import { PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from '@resto/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';

export function PaymentDialog({ total, busy, onClose, onConfirm }: {
  total: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: (method: PaymentMethod, received: number) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [received, setReceived] = useState<number>(total);
  const change = received - total;
  const quick = [10_000, 20_000, 50_000, 100_000].filter((q) => q >= total);
  const ok = method !== 'cash' || (Number.isFinite(received) && received >= total);

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="md">
        <DialogHeader title="Encaisser" description="Choisissez le mode de paiement." />
        <DialogBody className="space-y-5">
          <p className="rounded-lg bg-ink px-4 py-3 text-ink-foreground">
            <span className="text-sm opacity-70">Total à payer</span>
            <span className="num block font-display text-4xl font-semibold text-white">{money(total)}</span>
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Mode de paiement">
            {PAYMENT_METHODS.map((m) => (
              <button key={m} role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                className={cn('h-14 rounded-lg border text-sm font-medium', method === m ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card hover:bg-muted')}>
                {PAYMENT_LABELS[m]}
              </button>
            ))}
          </div>
          {method === 'cash' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="received">Montant reçu (Ar)</Label>
                <Input id="received" type="number" inputMode="numeric" step="1" min={0} value={Number.isNaN(received) ? '' : received}
                  onChange={(e) => setReceived(e.target.valueAsNumber)} className="h-14 text-xl num" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setReceived(total)}>Exact</Button>
                {quick.map((q) => <Button key={q} size="sm" variant="outline" onClick={() => setReceived(q)}>{money(q)}</Button>)}
              </div>
              <p className={cn('num text-lg font-semibold', change < 0 ? 'text-destructive' : 'text-primary')}>
                {change < 0 ? `Il manque ${money(-change)}` : `Rendu : ${money(change)}`}
              </p>
            </div>
          )}
          {method !== 'cash' && <p className="text-sm text-muted-foreground">Confirmez seulement une fois le paiement reçu sur le compte du restaurant.</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Retour</Button>
          <Button size="lg" disabled={!ok || busy} onClick={() => onConfirm(method, method === 'cash' ? received : total)}>
            {busy ? 'Encaissement…' : 'Confirmer et imprimer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
