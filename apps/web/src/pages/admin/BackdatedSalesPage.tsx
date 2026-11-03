import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from '@resto/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { api } from '@/lib/api';
import { fmtDate, money, shiftDate, todayStr } from '@/lib/format';
import { errorMessage } from '@/lib/utils';

interface Item { id: string; name: string; price: number; category_name: string; is_active: boolean }
interface Line { menu_item_id: string; quantity: number }
interface Done { id: string; date: string; total: number; method: PaymentMethod; n: number }

export default function BackdatedSalesPage() {
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ['menu-items'], queryFn: () => api<Item[]>('/menu-items') });
  const [date, setDate] = useState(shiftDate(todayStr(), -1));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [updateStock, setUpdateStock] = useState(true);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([{ menu_item_id: '', quantity: 1 }]);
  const [done, setDone] = useState<Done[]>([]);

  const list = (items.data ?? []).filter((i) => i.is_active);
  const byId = new Map(list.map((i) => [i.id, i]));
  const groups = [...new Set(list.map((i) => i.category_name))];
  const valid = lines.filter((l) => l.menu_item_id && l.quantity > 0);
  const total = valid.reduce((s, l) => s + (byId.get(l.menu_item_id)?.price ?? 0) * l.quantity, 0);
  const upd = (i: number, p: Partial<Line>) => setLines((x) => x.map((l, j) => (j === i ? { ...l, ...p } : l)));

  const save = useMutation({
    mutationFn: () => api<{ id: string; total: number }>('/sales/backdated', { method: 'POST', body: { date, payment_method: method, update_stock: updateStock, note: note || null, lines: valid } }),
    onSuccess: (o) => {
      toast.success(`Vente du ${fmtDate(date)} enregistrée (${money(o.total)})`);
      setDone((d) => [{ id: o.id, date, total: o.total, method, n: valid.length }, ...d]);
      setLines([{ menu_item_id: '', quantity: 1 }]); setNote('');
      for (const k of ['dashboard', 'orders', 'stock', 'profitability']) void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Saisie de ventes antérieures" description="Enregistrez une vente passée à la date de votre choix : elle apparaît au tableau de bord, aux ventes et à la rentabilité à cette date." />
      <Card className="space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><Label htmlFor="d">Date de la vente</Label><Input id="d" type="date" max={todayStr()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="m">Mode de paiement</Label>
            <Select id="m" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}</Select></div>
          <div className="space-y-1.5"><Label htmlFor="n">Note (facultatif)</Label><Input id="n" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>

        <div className="space-y-2">
          <Label>Plats et boissons vendus</Label>
          {lines.map((l, i) => {
            const it = byId.get(l.menu_item_id);
            return (
              <div key={i} className="grid grid-cols-[1fr_5.5rem_7rem_auto] items-center gap-2">
                <Select value={l.menu_item_id} onChange={(e) => upd(i, { menu_item_id: e.target.value })} aria-label="Plat">
                  <option value="">— Choisir un plat —</option>
                  {groups.map((g) => <optgroup key={g} label={g}>{list.filter((x) => x.category_name === g).map((x) => <option key={x.id} value={x.id}>{x.name} · {money(x.price)}</option>)}</optgroup>)}
                </Select>
                <Input type="number" min={1} value={l.quantity} onChange={(e) => upd(i, { quantity: Math.max(1, Math.round(Number(e.target.value)) || 1) })} aria-label="Quantité" />
                <span className="num text-right text-sm">{it ? money(it.price * l.quantity) : ''}</span>
                <Button size="icon" variant="ghost" aria-label="Retirer" disabled={lines.length === 1} onClick={() => setLines((x) => x.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            );
          })}
          <Button variant="outline" size="sm" onClick={() => setLines((x) => [...x, { menu_item_id: '', quantity: 1 }])}><Plus /> Ajouter un plat</Button>
        </div>

        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 size-5" checked={updateStock} onChange={(e) => setUpdateStock(e.target.checked)} />
          <span><b>Mettre à jour le stock</b><br /><span className="text-muted-foreground">Retire les ingrédients des recettes (et les boissons revendues) du stock, au jour de la vente. Décochez si le stock a déjà été ajusté.</span></span></label>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">Prix du menu actuels. Total : <b className="num font-display text-xl text-foreground">{money(total)}</b></p>
          <Button size="lg" disabled={!valid.length || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Enregistrement…' : 'Enregistrer la vente'}</Button>
        </div>
      </Card>

      {done.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-2 font-display text-lg font-semibold">Saisies de cette session</h2>
          <ul className="divide-y divide-border text-sm">{done.map((d) => <li key={d.id} className="flex justify-between py-1.5"><span>{fmtDate(d.date)} · {d.n} ligne(s) · {PAYMENT_LABELS[d.method]}</span><b className="num">{money(d.total)}</b></li>)}</ul>
        </Card>
      )}
    </div>
  );
}
