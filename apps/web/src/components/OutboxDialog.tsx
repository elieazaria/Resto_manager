import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { fmtTime } from '@/lib/format';
import { outbox, useOutbox } from '@/lib/outbox';

/** Opérations saisies hors-ligne : en attente d'envoi, ou refusées par le serveur (à traiter à la main). */
export function OutboxDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const items = useOutbox();
  const qc = useQueryClient();
  const retry = async () => {
    const r = await outbox.flush();
    void qc.invalidateQueries();
    toast[r.failed ? 'warning' : 'success'](r.sent ? `${r.sent} opération(s) envoyée(s)` : 'Rien n’a pu être envoyé pour le moment');
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title="Opérations hors-ligne" description="Elles partent automatiquement dès que la connexion revient." />
        <DialogBody className="space-y-2">
          {!items.length && <p className="text-sm text-muted-foreground">Tout est synchronisé.</p>}
          {items.map((i) => (
            <div key={i.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3 text-sm">
              <div>
                <p className="font-medium">{i.label}</p>
                <p className="text-xs text-muted-foreground">saisi à {fmtTime(new Date(i.createdAt))}</p>
                {i.error && <p className="mt-1 text-xs text-destructive">Refusé : {i.error}</p>}
              </div>
              {i.error && <Button size="sm" variant="outline" onClick={() => outbox.dismiss(i.id)}>Ignorer</Button>}
            </div>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={retry}>Réessayer maintenant</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
