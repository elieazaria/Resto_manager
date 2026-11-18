import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from '@resto/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { NumberField } from '@/components/ui/number-field';
import { DateField } from '@/components/ui/date-field';
import { PageHeader } from '@/components/PageHeader';
import { api } from '@/lib/api';
import { fmtDate, money, shiftDate, todayStr } from '@/lib/format';
import { errorMessage } from '@/lib/utils';

interface TableRow { id: string; name: string; is_active?: boolean }
interface Item { id: string; name: string; price: number; category_name: string; is_active: boolean }
interface Line { menu_item_id: string; quantity: number }
interface Done { id: string; date: string; total: number; method: PaymentMethod; n: number }

export default function BackdatedSalesPage() {
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ['menu-items'], queryFn: () => api<Item[]>('/menu-items') });
  const tables = useQuery({ queryKey: ['pos-tables'], queryFn: () => api<TableRow[]>('/pos/tables') });
  const [tableId, setTableId] = useState('');
  const table = tableId || tables.data?.[0]?.id || '';
  const [date, setDate] = useState(shiftDate(todayStr(), -1));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [updateStock, setUpdateStock] = useState(true);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([{ menu_item_id: '', quantity: 1 }]);
  const [done, setDone] = useState<Done[]>([]);

  const list = (items.data ?? []).filter((i) => i.is_active);
  const byId = new Map(list.map((i) => [i.id, i]));
  const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const [search, setSearch] = useState('');
  const needle = norm(search);
  const matches = needle ? list.filter((i) => norm(i.name).includes(needle)) : [];
  const chosen = new Set(lines.map((l) => l.menu_item_id).filter(Boolean));
  const groups = [...new Set(list.map((i) => i.category_name))];
  const valid = lines.filter((l) => l.menu_item_id && l.quantity > 0);
  const total = valid.reduce((s, l) => s + (byId.get(l.menu_item_id)?.price ?? 0) * l.quantity, 0);
  const upd = (i: number, p: Partial<Line>) => setLines((x) => x.map((l, j) => (j === i ? { ...l, ...p } : l)));
  /** Résultat de recherche : +1 si déjà présent, sinon remplit la première ligne vide ou en ajoute une. */
  const quickAdd = (id: string) => setLines((cur) => {
    const at = cur.findIndex((l) => l.menu_item_id === id);
    if (at >= 0) return cur.map((l, j) => (j === at ? { ...l, quantity: Math.min(999, l.quantity + 1) } : l));
    const empty = cur.findIndex((l) => !l.menu_item_id);
    if (empty >= 0) return cur.map((l, j) => (j === empty ? { menu_item_id: id, quantity: 1 } : l));
    return [...cur, { menu_item_id: id, quantity: 1 }];
  });

  const save = useMutation({
    mutationFn: () => api<{ id: string; total: number }>('/sales/backdated', { method: 'POST', body: { date, payment_method: method, update_stock: updateStock, table_id: table || null, note: note || null, lines: valid } }),
    onSuccess: (o) => {
      toast.success(`Vente du ${fmtDate(date)} enregistrée (${money(o.total)})`);
      setDone((d) => [{ id: o.id, date, total: o.total, method, n: valid.length }, ...d]);
      setLines([{ menu_item_id: '', quantity: 1 }]); setNote(''); setSearch('');
      for (const k of ['dashboard', 'orders', 'stock', 'profitability']) void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Saisie de ventes antérieures" description="Enregistrez une vente passée à la date de votre choix : elle apparaît au tableau de bord, aux ventes et à la rentabilité à cette date." />

      <Card className="p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="d">Date de la vente</Label><DateField id="d" max={todayStr()} value={date} onChange={setDate} /></div>
          <div className="space-y-1.5"><Label htmlFor="m">Mode de paiement</Label>
            <Select id="m" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}</Select></div>
          <div className="space-y-1.5"><Label htmlFor="t">Table</Label>
            <Select id="t" value={table} onChange={(e) => setTableId(e.target.value)}>{(tables.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="n">Note (facultatif)</Label><Input id="n" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Plats et boissons vendus</h2>
          <Button size="sm" variant="outline" onClick={() => setLines((x) => [...x, { menu_item_id: '', quantity: 1 }])}><Plus /> Ajouter un plat</Button>
        </div>

        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un plat ou une boisson (ex. jus, coca…)" aria-label="Rechercher dans le menu" className="pl-9" />
          </div>
          {needle && (
            <div className="flex flex-wrap gap-2" aria-live="polite">
              {matches.slice(0, 12).map((it) => (
                <Button key={it.id} size="sm" variant={chosen.has(it.id) ? 'default' : 'outline'} onClick={() => quickAdd(it.id)}><Plus /> {it.name} · {money(it.price)}</Button>
              ))}
              {!matches.length && <p className="text-sm text-muted-foreground">Aucun plat ne correspond à « {search} ».</p>}
              {matches.length > 12 && <p className="self-center text-xs text-muted-foreground">+ {matches.length - 12} autres : précisez la recherche.</p>}
            </div>
          )}
        </div>

        <ul className="space-y-3">
          {lines.map((l, i) => {
            const it = byId.get(l.menu_item_id);
            return (
              <li key={i} className="rounded-lg border border-border p-3">
                <Select value={l.menu_item_id} onChange={(e) => upd(i, { menu_item_id: e.target.value })} aria-label={`Plat ${i + 1}`}>
                  <option value="">— Choisir un plat —</option>
                  {groups.map((g) => <optgroup key={g} label={g}>{list.filter((x) => x.category_name === g && (!needle || chosen.has(x.id) || norm(x.name).includes(needle))).map((x) => <option key={x.id} value={x.id} disabled={chosen.has(x.id) && l.menu_item_id !== x.id}>{x.name} — {money(x.price)}</option>)}</optgroup>)}
                </Select>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <NumberField min={1} max={999} value={l.quantity} onChange={(n) => upd(i, { quantity: n })} aria-label="Quantité" />
                  <span className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">{it ? `${l.quantity} × ${money(it.price)}` : ''}</span>
                    <span className="num font-semibold">{it ? money(it.price * l.quantity) : ''}</span>
                    <Button size="icon" variant="ghost" className="size-9" aria-label={`Retirer le plat ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((x) => x.filter((_, j) => j !== i))}><Trash2 className="text-destructive" /></Button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="p-4">
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 size-5" checked={updateStock} onChange={(e) => setUpdateStock(e.target.checked)} />
          <span><b>Mettre à jour le stock</b><br /><span className="text-muted-foreground">Retire les ingrédients des recettes (et les boissons revendues) du stock, au jour de la vente. Décochez si le stock a déjà été ajusté.</span></span></label>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-3 flex items-center gap-3 border-t border-border bg-background/95 px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-xs text-muted-foreground">Total · {fmtDate(date)} · prix actuels du menu</p>
          <p className="num font-display text-2xl font-semibold">{money(total)}</p>
        </div>
        <Button size="lg" disabled={!valid.length || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Envoi…' : 'Enregistrer'}</Button>
      </div>

      {done.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-2 font-display text-lg font-semibold">Saisies de cette session</h2>
          <ul className="divide-y divide-border text-sm">{done.map((d) => <li key={d.id} className="flex justify-between gap-2 py-1.5"><span>{fmtDate(d.date)} · {d.n} ligne(s) · {PAYMENT_LABELS[d.method]}</span><b className="num">{money(d.total)}</b></li>)}</ul>
        </Card>
      )}
    </div>
  );
}
