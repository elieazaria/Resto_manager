import { useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Minus, Plus, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  DEFAULT_SETTINGS, PAYMENT_LABELS, PAYMENT_METHODS, idSchema,
  type OrderDto, type PaymentMethod, type PosMenuDto, type PosTableDto, type Settings,
} from '@resto/shared';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { api, ApiError, NetworkError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/format';
import { outbox } from '@/lib/outbox';
import { printTicket } from '@/lib/print';
import { errorMessage, uuid } from '@/lib/utils';

/* ───────── Formulaire : une table, des lignes (plat + quantité), un mode de paiement ───────── */
const formSchema = z.object({
  table_id: idSchema.or(z.literal('')).refine((v) => v !== '', 'Choisissez une table'),
  lines: z
    .array(
      z.object({
        menu_item_id: idSchema.or(z.literal('')).refine((v) => v !== '', 'Choisissez un plat'),
        quantity: z.number({ message: 'Quantité requise' }).int('Nombre entier').min(1, 'Minimum 1').max(99, 'Maximum 99'),
      }),
    )
    .min(1, 'Ajoutez au moins un plat'),
  method: z.enum(PAYMENT_METHODS),
  received: z.number().min(0).nullable(),
});
type FormValues = z.infer<typeof formSchema>;

const emptyLine = { menu_item_id: '' as const, quantity: 1 };

export default function QuickSalePage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const offline = { networkMode: 'offlineFirst' as const };
  const menu = useQuery({ queryKey: ['pos-menu'], queryFn: () => api<PosMenuDto>('/pos/menu'), staleTime: 60_000, ...offline });
  const tables = useQuery({ queryKey: ['pos-tables'], queryFn: () => api<PosTableDto[]>('/pos/tables'), ...offline });
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings'), staleTime: 300_000, ...offline });
  const settings = settingsQ.data ?? DEFAULT_SETTINGS;

  const items = menu.data?.items ?? [];
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const grouped = useMemo(
    () => (menu.data?.categories ?? []).map((c) => ({ ...c, items: items.filter((i) => i.category_id === c.id) })),
    [menu.data, items],
  );

  const [orderId, setOrderId] = useState(uuid); // identifiant choisi côté appareil : le renvoi ne crée jamais de doublon
  const [existing, setExisting] = useState<OrderDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<OrderDto | null>(null);

  const { register, control, handleSubmit, reset, setValue, getValues, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(formSchema) as any,
    defaultValues: { table_id: '', lines: [{ ...emptyLine }], method: 'cash', received: null },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const lines = useWatch({ control, name: 'lines' });
  const tableId = useWatch({ control, name: 'table_id' });
  const method = useWatch({ control, name: 'method' });
  const received = useWatch({ control, name: 'received' });

  const total = (lines ?? []).reduce((s, l) => s + (byId.get(l.menu_item_id)?.price ?? 0) * (Number.isFinite(l.quantity) ? l.quantity : 0), 0);
  const change = method === 'cash' && received != null && Number.isFinite(received) ? received - total : null;
  const chosen = new Set((lines ?? []).map((l) => l.menu_item_id).filter(Boolean));

  // Table qui a déjà une commande ouverte : on la reprend (mêmes lignes, même identifiant) au lieu d'en créer une 2e.
  useEffect(() => {
    if (!tableId) { setExisting(null); return; }
    const pending = outbox.pendingOrderForTable(tableId);
    const t = tables.data?.find((x) => x.id === tableId);
    if (pending) {
      setOrderId(pending.id);
      setExisting(null);
      setValue('lines', pending.body.lines.map((l) => ({ menu_item_id: l.menu_item_id, quantity: l.quantity })));
    } else if (t?.open_order_id) {
      api<OrderDto>(`/orders/${t.open_order_id}`)
        .then((o) => {
          setOrderId(o.id);
          setExisting(o);
          setValue('lines', o.lines.map((l) => ({ menu_item_id: l.menu_item_id, quantity: l.quantity })));
        })
        .catch((e) => toast.error(errorMessage(e)));
    } else {
      setExisting(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, tables.data?.length]);

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['pos-tables'] }); void qc.invalidateQueries({ queryKey: ['orders'] }); };

  /** Le même plat choisi dans deux lignes est fusionné (quantités additionnées). */
  const merged = (v: FormValues) => {
    const m = new Map<string, number>();
    for (const l of v.lines) m.set(l.menu_item_id, Math.min(99, (m.get(l.menu_item_id) ?? 0) + l.quantity));
    return [...m].map(([menu_item_id, quantity]) => ({ menu_item_id, quantity }));
  };

  const localOrder = (v: FormValues, status: 'open' | 'paid'): OrderDto => ({
    id: orderId, ticket_no: 0, table_id: v.table_id, table_name: tables.data?.find((t) => t.id === v.table_id)?.name ?? '',
    status, note: null, total, payment_method: status === 'paid' ? v.method : null,
    amount_received: status === 'paid' ? (v.method === 'cash' ? (v.received ?? total) : total) : null, business_date: null,
    created_at: new Date().toISOString(), paid_at: status === 'paid' ? new Date().toISOString() : null,
    opened_by_name: user?.full_name ?? null, paid_by_name: status === 'paid' ? (user?.full_name ?? null) : null, void_reason: null,
    lines: merged(v).map((l) => ({ id: l.menu_item_id, menu_item_id: l.menu_item_id, name: byId.get(l.menu_item_id)!.name, unit_price: byId.get(l.menu_item_id)!.price, quantity: l.quantity, note: null })),
  });

  /**
   * 1) PUT idempotent de la commande  2) (si `pay`) POST /pay  3) impression.
   * Sans réseau, les deux appels partent dans la file d'attente et le ticket s'imprime quand même.
   */
  const submit = (pay: boolean) =>
    handleSubmit(async (v) => {
      if (pay && v.method === 'cash' && v.received != null && v.received < total) {
        return toast.error(`Montant reçu insuffisant : il manque ${money(total - v.received)}`);
      }
      setBusy(true);
      const path = `/orders/${orderId}`;
      const body = { table_id: v.table_id, lines: merged(v) };
      const tableName = tables.data?.find((t) => t.id === v.table_id)?.name ?? '';
      try {
        let order: OrderDto | null = null;
        let queued = false;
        try {
          order = await api<OrderDto>(path, { method: 'PUT', body });
        } catch (e) {
          if (!(e instanceof NetworkError)) throw e;
          outbox.enqueue({ method: 'PUT', path, body, label: `Commande ${tableName}` });
          queued = true;
        }
        if (pay) {
          const payBody = { method: v.method, amount_received: v.method === 'cash' ? (v.received ?? total) : null };
          if (queued) {
            outbox.enqueue({ method: 'POST', path: `${path}/pay`, body: payBody, label: `Encaissement ${tableName}` });
            order = localOrder(v, 'paid');
          } else {
            try {
              order = await api<OrderDto>(`${path}/pay`, { method: 'POST', body: payBody });
            } catch (e) {
              if (!(e instanceof NetworkError)) throw e;
              outbox.enqueue({ method: 'POST', path: `${path}/pay`, body: payBody, label: `Encaissement ${tableName}` });
              order = localOrder(v, 'paid');
              queued = true;
            }
          }
        }
        const finalOrder = order ?? localOrder(v, pay ? 'paid' : 'open');
        printTicket(finalOrder, settings); // ticket de caisse si encaissé, « addition » sinon
        refresh();
        if (queued) toast.warning('Hors-ligne : vente gardée, envoi automatique au retour du réseau');
        setDone(finalOrder);
      } catch (e) {
        toast.error(errorMessage(e));
        if (e instanceof ApiError && (e.code === 'TABLE_BUSY' || e.code === 'ORDER_CLOSED')) refresh();
      } finally {
        setBusy(false);
      }
    })();

  const newSale = () => {
    reset({ table_id: '', lines: [{ ...emptyLine }], method: 'cash', received: null });
    setOrderId(uuid());
    setExisting(null);
    setDone(null);
  };

  /* ───────── Écran de confirmation ───────── */
  if (done) {
    return (
      <div className="mx-auto max-w-lg space-y-5">
        <Card>
          <CardContent className="space-y-4 pt-5 text-center">
            <CheckCircle2 className="mx-auto size-12 text-primary" aria-hidden />
            <div>
              <h2 className="font-display text-2xl font-semibold">{done.status === 'paid' ? 'Vente enregistrée' : 'Commande enregistrée'}</h2>
              <p className="text-muted-foreground">{done.table_name} · {done.lines.reduce((s, l) => s + l.quantity, 0)} article(s)</p>
            </div>
            <p className="num font-display text-4xl font-semibold">{money(done.total)}</p>
            {done.payment_method === 'cash' && done.amount_received != null && done.amount_received > done.total && (
              <p className="text-lg font-semibold text-primary">Rendu : {money(done.amount_received - done.total)}</p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="outline" size="lg" onClick={() => printTicket(done, settings)}><Printer /> Réimprimer le ticket</Button>
              <Button size="lg" onClick={newSale}><Plus /> Nouvelle vente</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const noMenu = menu.isSuccess && !items.length;

  return (
    <form className="mx-auto max-w-3xl space-y-5" onSubmit={(e) => e.preventDefault()} noValidate>
      <PageHeader title="Nouvelle vente" description="Choisissez la table, les plats et les quantités, puis enregistrez : le ticket s'imprime." />

      {noMenu && <p className="rounded-lg bg-muted p-4 text-sm" role="alert">Le menu est vide. Le gérant doit d'abord ajouter des plats (écran « Menu et recettes »).</p>}

      <Card>
        <CardContent className="space-y-1.5 pt-4">
          <Label htmlFor="table_id">Table</Label>
          <Select id="table_id" aria-invalid={!!errors.table_id} {...register('table_id')}>
            <option value="">— Choisir une table —</option>
            {(tables.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.open_order_id ? ` (commande en cours : ${money(t.open_total)})` : ''}</option>
            ))}
          </Select>
          {errors.table_id && <p className="text-sm text-destructive">{errors.table_id.message}</p>}
          {existing && <p className="text-sm text-muted-foreground">Cette table a déjà une commande ouverte : ses plats sont repris, vous pouvez les modifier.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Plats</h2>
            <Button size="sm" variant="outline" onClick={() => append({ ...emptyLine })}><Plus /> Ajouter un plat</Button>
          </div>

          <ul className="space-y-3">
            {fields.map((f, i) => {
              const item = byId.get(lines?.[i]?.menu_item_id ?? '');
              const qty = Number.isFinite(lines?.[i]?.quantity) ? lines![i]!.quantity : 0;
              const e = errors.lines?.[i];
              return (
                <li key={f.id} className="rounded-lg border border-border p-3">
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <div className="space-y-1">
                      <Label htmlFor={`plat-${i}`} className="sr-only">Plat {i + 1}</Label>
                      <Select id={`plat-${i}`} aria-label={`Plat ${i + 1}`} aria-invalid={!!e?.menu_item_id} {...register(`lines.${i}.menu_item_id`)}>
                        <option value="">— Choisir un plat —</option>
                        {grouped.map((g) => (
                          <optgroup key={g.id} label={g.name}>
                            {g.items.map((it) => (
                              <option key={it.id} value={it.id} disabled={chosen.has(it.id) && lines?.[i]?.menu_item_id !== it.id}>
                                {it.name} — {money(it.price)}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </Select>
                      {e?.menu_item_id && <p className="text-sm text-destructive">{e.menu_item_id.message}</p>}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button size="icon" variant="outline" aria-label="Diminuer la quantité"
                        onClick={() => setValue(`lines.${i}.quantity`, Math.max(1, (Number(getValues(`lines.${i}.quantity`)) || 1) - 1), { shouldDirty: true })}><Minus /></Button>
                      <Input type="number" inputMode="numeric" min={1} max={99} step={1} aria-label="Quantité" className="w-20 text-center num"
                        aria-invalid={!!e?.quantity} {...register(`lines.${i}.quantity`, { valueAsNumber: true })} />
                      <Button size="icon" variant="outline" aria-label="Augmenter la quantité"
                        onClick={() => setValue(`lines.${i}.quantity`, Math.min(99, (Number(getValues(`lines.${i}.quantity`)) || 0) + 1), { shouldDirty: true })}><Plus /></Button>
                    </div>
                  </div>
                  {e?.quantity && <p className="mt-1 text-sm text-destructive">{e.quantity.message}</p>}

                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{item ? `${qty} × ${money(item.price)}` : ' '}</span>
                    <span className="flex items-center gap-2">
                      <span className="num font-semibold">{item ? money(item.price * qty) : ''}</span>
                      {fields.length > 1 && (
                        <Button size="icon" variant="ghost" className="size-8" aria-label={`Retirer le plat ${i + 1}`} onClick={() => remove(i)}><Trash2 className="text-destructive" /></Button>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          {errors.lines?.message && <p className="text-sm text-destructive">{errors.lines.message}</p>}
          {errors.lines?.root?.message && <p className="text-sm text-destructive">{errors.lines.root.message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-4">
          <p className="flex items-baseline justify-between rounded-lg bg-ink px-4 py-3 text-ink-foreground">
            <span>Total à payer</span>
            <span className="num font-display text-3xl font-semibold text-white" data-testid="total">{money(total)}</span>
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="method">Mode de paiement</Label>
              <Select id="method" {...register('method')}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m as PaymentMethod]}</option>)}
              </Select>
            </div>
            {method === 'cash' && (
              <div className="space-y-1.5">
                <Label htmlFor="received">Montant reçu (Ar)</Label>
                <Input id="received" type="number" inputMode="numeric" min={0} step={1} placeholder={String(total || '')} className="num"
                  {...register('received', { setValueAs: (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v)) })} />
              </div>
            )}
          </div>
          {change != null && (
            <p className={change < 0 ? 'font-semibold text-destructive' : 'font-semibold text-primary'}>
              {change < 0 ? `Il manque ${money(-change)}` : `Rendu : ${money(change)}`}
            </p>
          )}

          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Button size="xl" variant="accent" disabled={busy || noMenu} onClick={() => void submit(true)}>
              <Printer /> {busy ? 'Enregistrement…' : 'Enregistrer la vente et imprimer'}
            </Button>
            <Button size="xl" variant="outline" disabled={busy || noMenu} onClick={() => void submit(false)}>Sans encaisser</Button>
          </div>
          <p className="text-xs text-muted-foreground">« Sans encaisser » garde la commande ouverte sur la table et imprime l'addition.</p>
        </CardContent>
      </Card>
    </form>
  );
}
