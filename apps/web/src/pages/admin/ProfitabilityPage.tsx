import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import type { CostBasis, ProfitabilityDto, ProfitabilityRowDto } from '@resto/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { api } from '@/lib/api';
import { fmtQty, money, shiftDate, todayStr } from '@/lib/format';
import { downloadCsv } from '@/lib/hotel';
import { cn } from '@/lib/utils';

type SortKey = 'name' | 'price' | 'cost' | 'margin' | 'margin_percent' | 'sold_qty' | 'profit_total';

export default function ProfitabilityPage() {
  const today = todayStr();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [basis, setBasis] = useState<CostBasis>('average');
  const [cat, setCat] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'margin_percent', dir: -1 });
  const [open, setOpen] = useState<string | null>(null);

  const q = useQuery({ queryKey: ['profitability', from, to, basis], queryFn: () => api<ProfitabilityDto>(`/profitability?from=${from}&to=${to}&basis=${basis}`), placeholderData: (p) => p });
  const d = q.data;
  const cats = useMemo(() => [...new Set((d?.rows ?? []).map((r) => r.category_name))], [d]);
  const rows = useMemo(() => {
    const list = (d?.rows ?? []).filter((r) => (!cat || r.category_name === cat) && r.name.toLowerCase().includes(search.toLowerCase()));
    return list.sort((a, b) => (a[sort.k] > b[sort.k] ? 1 : a[sort.k] < b[sort.k] ? -1 : 0) * sort.dir);
  }, [d, cat, search, sort]);
  const missing = (d?.rows ?? []).filter((r) => r.missing_cost).length;

  const preset = (f: string, t: string) => { setFrom(f); setTo(t); };
  const ym = today.slice(0, 7);
  const th = (k: SortKey, label: string, right = true) => (
    <th className={cn('px-3 py-2 font-medium', right && 'text-right')}>
      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : -1 }))}>{label}{sort.k === k && (sort.dir === 1 ? ' ▲' : ' ▼')}</button>
    </th>
  );
  const tone = (r: ProfitabilityRowDto) => (r.missing_cost ? 'text-muted-foreground' : r.margin_percent >= 60 ? 'text-primary' : r.margin_percent >= 30 ? '' : 'text-destructive');

  return (
    <div className="space-y-4">
      <PageHeader title="Rentabilité des menus" description="Bénéfice réel = prix de vente − coût des ingrédients (et produits revendus) calculé d’après vos prix d’achat."
        actions={<Button variant="outline" disabled={!rows.length} onClick={() => downloadCsv(`rentabilite_${from}_${to}.csv`, [['Menu', 'Catégorie', 'Prix', 'Coût', 'Bénéfice', 'Marge %', 'Vendus', 'CA', 'Bénéfice réalisé'], ...rows.map((r) => [r.name, r.category_name, r.price, r.cost, r.margin, r.margin_percent, r.sold_qty, r.revenue, r.profit_total])])}><Download /> CSV</Button>} />

      <div className="flex flex-wrap items-center gap-2">
        {([['Aujourd’hui', today, today], ['7 jours', shiftDate(today, -6), today], ['Ce mois', `${ym}-01`, today], ['Mois dernier', `${shiftDate(`${ym}-01`, -1).slice(0, 7)}-01`, shiftDate(`${ym}-01`, -1)], ['Cette année', `${today.slice(0, 4)}-01-01`, today]] as const).map(([l, f, t]) => (
          <Button key={l} size="sm" variant={from === f && to === t ? 'default' : 'outline'} onClick={() => preset(f, t)}>{l}</Button>
        ))}
        <Input type="date" className="h-9 w-38" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="Du" />
        <Input type="date" className="h-9 w-38" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="Au" />
        <Select className="h-9 w-auto" value={basis} onChange={(e) => setBasis(e.target.value as CostBasis)} aria-label="Base du coût">
          <option value="average">Coût moyen pondéré des achats</option><option value="last">Dernier prix d’achat</option>
        </Select>
        <Select className="h-9 w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Catégorie"><option value="">Toutes catégories</option>{cats.map((c) => <option key={c}>{c}</option>)}</Select>
        <Input className="h-9 w-48" placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {d && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[['Chiffre d’affaires', money(d.totals.revenue)], ['Coût des matières vendues', money(d.totals.cost_total)], ['Bénéfice réalisé', money(d.totals.profit_total)], ['Marge', `${d.totals.margin_percent} %`]].map(([l, v]) => (
            <Card key={l} className="px-4 py-3.5"><p className="text-sm text-muted-foreground">{l}</p><p className="num mt-1 font-display text-2xl font-semibold">{v}</p></Card>
          ))}
        </div>
      )}
      {missing > 0 && <p className="rounded-md bg-accent/30 px-3 py-2 text-sm">{missing} article(s) n’ont pas de coût complet (recette vide ou ingrédient jamais acheté) : enregistrez les achats correspondants pour obtenir leur vrai bénéfice.</p>}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="w-8" />{th('name', 'Menu', false)}{th('price', 'Prix de vente')}{th('cost', 'Coût')}{th('margin', 'Bénéfice / portion')}{th('margin_percent', 'Marge')}{th('sold_qty', 'Vendus')}{th('profit_total', 'Bénéfice réalisé')}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr className="cursor-pointer hover:bg-muted/40" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <td className="pl-3">{open === r.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</td>
                  <td className="px-3 py-2"><b>{r.name}</b> <span className="text-xs text-muted-foreground">{r.category_name}{r.kind === 'resale' ? ' · revendu' : ''}</span> {r.missing_cost && <Badge tone="warn">Coût incomplet</Badge>}</td>
                  <td className="num px-3 py-2 text-right">{money(r.price)}</td>
                  <td className="num px-3 py-2 text-right">{money(r.cost)}</td>
                  <td className={cn('num px-3 py-2 text-right font-semibold', tone(r))}>{money(r.margin)}</td>
                  <td className={cn('num px-3 py-2 text-right', tone(r))}>{r.margin_percent} %</td>
                  <td className="num px-3 py-2 text-right">{fmtQty(r.sold_qty)}</td>
                  <td className="num px-3 py-2 text-right font-medium">{money(r.profit_total)}</td>
                </tr>
                {open === r.id && (
                  <tr className="bg-muted/30"><td /><td colSpan={7} className="px-3 py-3">
                    {r.lines.length === 0 ? <p className="text-muted-foreground">Aucune recette : ajoutez les ingrédients dans « Menu et recettes ».</p> : (
                      <table className="num w-full max-w-2xl text-xs">
                        <thead className="text-muted-foreground"><tr><th className="text-left font-medium">Ingrédient / produit</th><th className="text-right font-medium">Qté / portion</th><th className="text-right font-medium">Coût unitaire</th><th className="text-right font-medium">Coût</th></tr></thead>
                        <tbody>{r.lines.map((l) => (
                          <tr key={l.stock_item_id}><td className="py-0.5">{l.name}</td><td className="text-right">{fmtQty(l.qty)} {l.unit}</td>
                            <td className="text-right">{l.unit_cost == null ? <span className="text-destructive">aucun achat</span> : `${fmtQty(l.unit_cost)} Ar / ${l.unit}`}</td><td className="text-right">{l.cost == null ? '—' : money(l.cost)}</td></tr>
                        ))}</tbody>
                      </table>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">Prix {money(r.price)} − coût {money(r.cost)} = bénéfice {money(r.margin)} par portion (coût matières = {r.cost_percent} % du prix). CA période : {money(r.revenue)}.</p>
                  </td></tr>
                )}
              </Fragment>
            ))}
            {!rows.length && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Aucun article.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
