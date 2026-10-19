import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Banknote, Minus, Plus, Printer, ShoppingCart, StickyNote, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_SETTINGS, type OrderDto, type PaymentMethod, type PosMenuDto, type PosTableDto, type Settings } from '@resto/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, ApiError, NetworkError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/format';
import { outbox } from '@/lib/outbox';
import { getPrefs, printTicket } from '@/lib/print';
import { cn, errorMessage, uuid } from '@/lib/utils';
import { PaymentDialog } from './PaymentDialog';

type Lines = Record<string, { qty: number; note: string }>;
const fromOrder = (o: Pick<OrderDto, 'lines'>): Lines =>
  Object.fromEntries(o.lines.map((l) => [l.menu_item_id, { qty: l.quantity, note: l.note ?? '' }]));

export default function OrderPage() {
  const { tableId = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();

  const offline = { networkMode: 'offlineFirst' as const };
  const menu = useQuery({ queryKey: ['pos-menu'], queryFn: () => api<PosMenuDto>('/pos/menu'), staleTime: 60_000, ...offline });
  const tables = useQuery({ queryKey: ['pos-tables'], queryFn: () => api<PosTableDto[]>('/pos/tables'), ...offline });
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings'), staleTime: 300_000, ...offline });
  const settings = settingsQ.data ?? DEFAULT_SETTINGS;
  const table = tables.data?.find((t) => t.id === tableId);

  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [orderId, setOrderId] = useState('');
  const [serverKnows, setServerKnows] = useState(false);
  const [lines, setLines] = useState<Lines>({});
  const [cat, setCat] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Chargement de la commande existante (serveur, ou file hors-ligne) — une seule fois
  useEffect(() => {
    if (phase !== 'loading' || !tables.data) return;
    const pending = outbox.pendingOrderForTable(tableId);
    if (pending) {
      setOrderId(pending.id);
      setLines(Object.fromEntries(pending.body.lines.map((l) => [l.menu_item_id, { qty: l.quantity, note: l.note ?? '' }])));
      setServerKnows(table?.open_order_id === pending.id);
      setPhase('ready');
    } else if (table?.open_order_id) {
      api<OrderDto>(`/orders/${table.open_order_id}`)
        .then((o) => { setOrderId(o.id); setLines(fromOrder(o)); setServerKnows(true); setPhase('ready'); })
        .catch(() => setPhase('error'));
    } else {
      setOrderId(uuid());
      setPhase('ready');
    }
  }, [phase, tables.data, table, tableId]);

  const items = menu.data?.items ?? [];
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const visible = items.filter((i) => (cat === 'all' || i.category_id === cat) && i.name.toLowerCase().includes(search.trim().toLowerCase()));
  const cart = Object.entries(lines).filter(([id, l]) => l.qty > 0 && byId.has(id));
  const total = cart.reduce((s, [id, l]) => s + byId.get(id)!.price * l.qty, 0);
  const count = cart.reduce((s, [, l]) => s + l.qty, 0);

  const add = (id: string, d: number) =>
    setLines((cur) => {
      const qty = Math.max(0, Math.min(99, (cur[id]?.qty ?? 0) + d));
      const next = { ...cur };
      if (qty === 0) delete next[id];
      else next[id] = { qty, note: cur[id]?.note ?? '' };
      return next;
    });

  const body = () => ({
    table_id: tableId,
    lines: cart.map(([id, l]) => ({ menu_item_id: id, quantity: l.qty, note: l.note.trim() || null })),
  });

  /** Ordre local (impression hors-ligne, ou avant retour serveur). */
  const localOrder = (status: 'open' | 'paid', pay?: { method: PaymentMethod; received: number }): OrderDto => ({
    id: orderId, ticket_no: 0, table_id: tableId, table_name: table?.name ?? '', status, note: null, total,
    payment_method: pay?.method ?? null, amount_received: pay?.received ?? null, business_date: null,
    created_at: new Date().toISOString(), paid_at: status === 'paid' ? new Date().toISOString() : null,
    opened_by_name: user?.full_name ?? null, paid_by_name: status === 'paid' ? (user?.full_name ?? null) : null, void_reason: null,
    lines: cart.map(([id, l]) => ({ id, menu_item_id: id, name: byId.get(id)!.name, unit_price: byId.get(id)!.price, quantity: l.qty, note: l.note.trim() || null })),
  });

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['pos-tables'] }); void qc.invalidateQueries({ queryKey: ['orders'] }); };

  /** PUT idempotent ; sans réseau, la commande part dans la file d'attente. */
  async function saveOrder(): Promise<{ order: OrderDto | null; queued: boolean }> {
    const path = `/orders/${orderId}`;
    try {
      const order = await api<OrderDto>(path, { method: 'PUT', body: body() });
      setServerKnows(true);
      return { order, queued: false };
    } catch (e) {
      if (e instanceof NetworkError) {
        outbox.enqueue({ method: 'PUT', path, body: body(), label: `Commande ${table?.name ?? ''}` });
        return { order: null, queued: true };
      }
      throw e;
    }
  }

  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'TABLE_BUSY') toast.error('Cette table a déjà une commande ouverte sur un autre appareil. Retour aux tables.');
    else toast.error(errorMessage(e));
    if (e instanceof ApiError && (e.code === 'TABLE_BUSY' || e.code === 'ORDER_CLOSED')) { refresh(); nav('/pos'); }
  };

  const onSave = async (andPrint = false) => {
    if (!cart.length) {
      if (serverKnows) return toast.error('Commande vide : utilisez « Annuler la commande ».');
      return nav('/pos');
    }
    setSaving(true);
    try {
      const { order, queued } = await saveOrder();
      refresh();
      if (andPrint) {
        printTicket(order ?? localOrder('open'), settings);
        toast.success(queued ? 'Addition imprimée (envoi en attente)' : 'Addition imprimée');
        if (!queued) return;
      } else {
        toast[queued ? 'warning' : 'success'](queued ? 'Hors-ligne : commande gardée, envoi automatique au retour du réseau' : 'Commande enregistrée');
      }
      nav('/pos');
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const onPay = async (method: PaymentMethod, received: number) => {
    setPayBusy(true);
    try {
      const payBody = { method, amount_received: method === 'cash' ? received : null };
      const saved = await saveOrder();
      let paid: OrderDto;
      const queuePay = () => {
        outbox.enqueue({ method: 'POST', path: `/orders/${orderId}/pay`, body: payBody, label: `Encaissement ${table?.name ?? ''}` });
        return localOrder('paid', { method, received });
      };
      if (saved.queued) paid = queuePay();
      else {
        try {
          paid = await api<OrderDto>(`/orders/${orderId}/pay`, { method: 'POST', body: payBody });
        } catch (e) {
          if (!(e instanceof NetworkError)) throw e;
          paid = queuePay();
        }
      }
      if (getPrefs().autoPrint) printTicket(paid, settings);
      const change = method === 'cash' ? received - total : 0;
      toast.success(change > 0 ? `Encaissé. Rendu : ${money(change)}` : 'Encaissé');
      refresh();
      nav('/pos');
    } catch (e) {
      setPayBusy(false);
      setPaying(false);
      fail(e);
    }
  };

  const onCancel = async () => {
    setConfirmCancel(false);
    try {
      if (serverKnows || outbox.pendingOrderForTable(tableId)) {
        try {
          await api(`/orders/${orderId}/cancel`, { method: 'POST' });
        } catch (e) {
          if (!(e instanceof NetworkError)) throw e;
          outbox.enqueue({ method: 'POST', path: `/orders/${orderId}/cancel`, label: `Annulation ${table?.name ?? ''}` });
        }
      }
      toast.success('Commande annulée');
      refresh();
      nav('/pos');
    } catch (e) {
      fail(e);
    }
  };

  if (phase === 'error' || (tables.isError && !tables.data)) {
    return (
      <div className="mx-auto max-w-md space-y-4 rounded-xl border border-border bg-card p-6 text-center">
        <p className="font-medium">Impossible de charger la commande en cours de cette table.</p>
        <p className="text-sm text-muted-foreground">Elle n'est pas disponible hors-ligne. Réessayez quand la connexion revient.</p>
        <div className="flex justify-center gap-2"><Button variant="outline" onClick={() => nav('/pos')}>Retour</Button><Button onClick={() => { setPhase('loading'); void tables.refetch(); }}>Réessayer</Button></div>
      </div>
    );
  }
  if (tables.data && !table) return <p className="p-6 text-center text-muted-foreground">Table introuvable.</p>;

  const CartPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {!cart.length && <p className="rounded-lg bg-muted/60 p-6 text-center text-sm text-muted-foreground">Touchez un plat pour l'ajouter à la commande.</p>}
        {cart.map(([id, l]) => {
          const it = byId.get(id)!;
          return (
            <div key={id} className="rounded-lg border border-border bg-card p-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium leading-snug">{it.name}</p>
                <p className="num whitespace-nowrap text-sm font-semibold">{money(it.price * l.qty)}</p>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="outline" className="size-9" onClick={() => add(id, -1)} aria-label={`Retirer un ${it.name}`}><Minus /></Button>
                  <span className="num w-8 text-center text-base font-semibold">{l.qty}</span>
                  <Button size="icon" variant="outline" className="size-9" onClick={() => add(id, 1)} aria-label={`Ajouter un ${it.name}`}><Plus /></Button>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" className="size-9" onClick={() => setNoteFor(noteFor === id ? null : id)} aria-label="Note"><StickyNote className={cn(l.note && 'text-primary')} /></Button>
                  <Button size="icon" variant="ghost" className="size-9" onClick={() => setLines((c) => { const n = { ...c }; delete n[id]; return n; })} aria-label="Retirer la ligne"><Trash2 className="text-destructive" /></Button>
                </div>
              </div>
              {(noteFor === id || l.note) && (
                <Input className="mt-2 h-9 text-sm" placeholder="Note (sans piment, bien cuit…)" value={l.note} maxLength={120}
                  onChange={(e) => setLines((c) => ({ ...c, [id]: { ...c[id]!, note: e.target.value } }))} />
              )}
            </div>
          );
        })}
      </div>
      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">{count} article(s)</span>
          <span className="num font-display text-2xl font-semibold">{money(total)}</span>
        </div>
        <Button size="xl" variant="accent" className="w-full" disabled={!cart.length || saving} onClick={() => setPaying(true)}><Banknote /> Encaisser</Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={saving} onClick={() => onSave(false)}>Enregistrer</Button>
          <Button variant="outline" disabled={!cart.length || saving} onClick={() => onSave(true)}><Printer /> Addition</Button>
        </div>
        {(serverKnows || cart.length > 0) && <Button variant="ghost" className="w-full text-destructive" onClick={() => setConfirmCancel(true)}>Annuler la commande</Button>}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" onClick={() => nav('/pos')} aria-label="Retour aux tables"><ArrowLeft /></Button>
        <div>
          <h1 className="font-display text-2xl font-semibold leading-tight">{table?.name ?? '…'}</h1>
          <p className="text-sm text-muted-foreground">{serverKnows ? 'Commande en cours' : 'Nouvelle commande'}</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <section className="min-w-0 space-y-3">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un plat…" aria-label="Rechercher un plat" />
          <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0" role="tablist" aria-label="Catégories">
            {[{ id: 'all', name: 'Tout' }, ...(menu.data?.categories ?? [])].map((c) => (
              <button key={c.id} role="tab" aria-selected={cat === c.id} onClick={() => setCat(c.id)}
                className={cn('h-10 shrink-0 rounded-full px-4 text-sm font-medium', cat === c.id ? 'bg-ink text-ink-foreground' : 'bg-muted text-foreground hover:bg-muted/70')}>{c.name}</button>
            ))}
          </div>
          {menu.isLoading && <p className="py-10 text-center text-muted-foreground">Chargement du menu…</p>}
          {menu.isError && !items.length && <p className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">Menu indisponible : {errorMessage(menu.error)}</p>}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
            {visible.map((i) => {
              const q = lines[i.id]?.qty ?? 0;
              return (
                <button key={i.id} onClick={() => add(i.id, 1)} disabled={phase !== 'ready'}
                  className={cn('relative flex min-h-24 flex-col justify-between rounded-lg border p-3 text-left active:scale-[0.98]', q ? 'border-primary bg-primary/8' : 'border-border bg-card hover:bg-muted/50')}>
                  <span className="text-sm font-medium leading-snug">{i.name}</span>
                  <span className="num mt-2 text-sm text-muted-foreground">{money(i.price)}</span>
                  {q > 0 && <span className="num absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{q}</span>}
                </button>
              );
            })}
          </div>
          {!menu.isLoading && !visible.length && <p className="py-8 text-center text-muted-foreground">Aucun plat ne correspond.</p>}
          <div className="h-24 lg:hidden" />
        </section>

        <aside className="hidden lg:block"><div className="sticky top-20 h-[calc(100dvh-7rem)] rounded-xl border border-border bg-muted/40 p-3">{CartPanel}</div></aside>
      </div>

      {/* Barre de commande mobile */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <Button size="lg" className="w-full justify-between" onClick={() => setCartOpen(true)}>
          <span className="flex items-center gap-2"><ShoppingCart /> Commande ({count})</span>
          <span className="num">{money(total)}</span>
        </Button>
      </div>
      <Dialog open={cartOpen} onOpenChange={setCartOpen}>
        <DialogContent size="md" className="h-[88dvh] sm:h-[80dvh]">
          <DialogHeader title={`Commande : ${table?.name ?? ''}`} />
          <div className="min-h-0 flex-1 p-3">{CartPanel}</div>
        </DialogContent>
      </Dialog>

      {paying && <PaymentDialog total={total} busy={payBusy} onClose={() => setPaying(false)} onConfirm={onPay} />}

      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent size="sm">
          <DialogHeader title="Annuler la commande ?" description="Les articles saisis seront perdus. Aucune vente n'est enregistrée." />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCancel(false)}><X /> Non, garder</Button>
            <Button variant="destructive" onClick={onCancel}>Oui, annuler</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
