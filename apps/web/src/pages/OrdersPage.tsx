import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Printer, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_SETTINGS, PAYMENT_LABELS, can, type OrderDto, type Settings } from '@resto/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { DataTable } from '@/components/DataTable';
import { PageHeader } from '@/components/PageHeader';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, fmtTime, money, todayStr } from '@/lib/format';
import { printTicket } from '@/lib/print';
import { errorMessage } from '@/lib/utils';

const STATUS = {
  open: <Badge tone="warn">En cours</Badge>,
  paid: <Badge tone="ok">Payée</Badge>,
  cancelled: <Badge tone="danger">Annulée</Badge>,
};

/**
 * mode « today » : commandes ouvertes + encaissées du jour (caissier, gérant)
 * mode « sales » : historique filtrable avec annulation (gérant)
 */
export default function OrdersPage({ mode }: { mode: 'today' | 'sales' }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<OrderDto | null>(null);
  const [voiding, setVoiding] = useState<OrderDto | null>(null);
  const [reason, setReason] = useState('');

  const params = mode === 'sales' ? new URLSearchParams({ from, to, limit: '500', ...(status ? { status } : {}) }).toString() : 'limit=200';
  const orders = useQuery({ queryKey: ['orders', params], queryFn: () => api<OrderDto[]>(`/orders?${params}`), networkMode: 'offlineFirst' });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings'), staleTime: 300_000 });
  const data = orders.data ?? [];
  const paid = data.filter((o) => o.status === 'paid');

  const void_ = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api(`/orders/${id}/void`, { method: 'POST', body: { reason } }),
    onSuccess: () => { toast.success('Vente annulée, stock restitué'); setVoiding(null); setSelected(null); setReason(''); void qc.invalidateQueries({ queryKey: ['orders'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); void qc.invalidateQueries({ queryKey: ['stock'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={mode === 'sales' ? 'Ventes' : 'Commandes du jour'}
        description={mode === 'sales' ? 'Historique des tickets. Seul le gérant peut annuler une vente encaissée.' : 'Commandes en cours et tickets encaissés aujourd’hui.'}
        actions={<div className="text-right"><p className="num font-display text-2xl font-semibold">{money(paid.reduce((s, o) => s + o.total, 0))}</p><p className="text-xs text-muted-foreground">{paid.length} vente(s) encaissée(s)</p></div>}
      />
      {mode === 'sales' && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5"><Label htmlFor="from">Du</Label><Input id="from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="to">Au</Label><Input id="to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="st">Statut</Label>
            <Select id="st" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tous</option><option value="paid">Payées</option><option value="open">En cours</option><option value="cancelled">Annulées</option></Select>
          </div>
        </div>
      )}
      <DataTable<OrderDto>
        data={data} loading={orders.isLoading} onRowClick={setSelected} searchPlaceholder="Rechercher (table, caissier…)"
        columns={[
          { id: 'no', header: 'Ticket', accessorFn: (o) => o.ticket_no, cell: ({ row: { original: o } }) => <span className="num font-medium">#{o.ticket_no}</span> },
          { accessorKey: 'table_name', header: 'Table' },
          { id: 'when', header: mode === 'sales' ? 'Date' : 'Heure', accessorFn: (o) => o.paid_at ?? o.created_at, cell: ({ getValue }) => <span className="num">{mode === 'sales' ? fmtDateTime(getValue<string>()) : fmtTime(getValue<string>())}</span> },
          { accessorKey: 'total', header: 'Total', cell: ({ getValue }) => <span className="num font-medium">{money(getValue<number>())}</span> },
          { accessorKey: 'status', header: 'Statut', cell: ({ getValue }) => STATUS[getValue<OrderDto['status']>()] },
          { accessorKey: 'payment_method', header: 'Paiement', cell: ({ getValue }) => (getValue() ? PAYMENT_LABELS[getValue<keyof typeof PAYMENT_LABELS>()] : '—') },
          { id: 'by', header: 'Caissier', accessorFn: (o) => o.paid_by_name ?? o.opened_by_name ?? '' },
        ]}
      />

      {selected && (
        <Dialog open onOpenChange={(o) => !o && setSelected(null)}>
          <DialogContent size="md">
            <DialogHeader title={`Ticket #${selected.ticket_no} · ${selected.table_name}`} description={fmtDateTime(selected.paid_at ?? selected.created_at)} />
            <DialogBody className="space-y-3">
              <ul className="divide-y divide-border rounded-md border border-border">
                {selected.lines.map((l) => (
                  <li key={l.id} className="flex justify-between gap-3 px-3 py-2 text-sm">
                    <span>{l.quantity} × {l.name}{l.note && <span className="block text-xs text-muted-foreground">{l.note}</span>}</span>
                    <span className="num whitespace-nowrap">{money(l.unit_price * l.quantity)}</span>
                  </li>
                ))}
              </ul>
              <p className="flex items-baseline justify-between"><span>Total</span><span className="num font-display text-2xl font-semibold">{money(selected.total)}</span></p>
              <p className="flex flex-wrap items-center gap-2 text-sm">{STATUS[selected.status]}{selected.payment_method && <span>{PAYMENT_LABELS[selected.payment_method]}</span>}{selected.void_reason && <span className="text-destructive">Motif : {selected.void_reason}</span>}</p>
            </DialogBody>
            <DialogFooter>
              {selected.status === 'open' && <Button variant="outline" onClick={() => nav(`/pos/table/${selected.table_id}`)}>Ouvrir la table</Button>}
              {selected.status === 'paid' && can(user?.role, 'orders:void') && <Button variant="outline" className="text-destructive" onClick={() => setVoiding(selected)}><Undo2 /> Annuler la vente</Button>}
              <Button onClick={() => printTicket(selected, settings.data ?? DEFAULT_SETTINGS)}><Printer /> {selected.status === 'paid' ? 'Réimprimer le ticket' : 'Imprimer l’addition'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {voiding && (
        <Dialog open onOpenChange={(o) => !o && setVoiding(null)}>
          <DialogContent size="sm">
            <DialogHeader title="Annuler cette vente ?" description="Le stock consommé est restitué et la vente sort du chiffre d'affaires." />
            <DialogBody className="space-y-1.5"><Label htmlFor="reason">Motif (obligatoire)</Label><Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Erreur de saisie, client parti…" /></DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => setVoiding(null)}>Retour</Button>
              <Button variant="destructive" disabled={!reason.trim() || void_.isPending} onClick={() => void_.mutate({ id: voiding.id, reason: reason.trim() })}>Annuler la vente</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
