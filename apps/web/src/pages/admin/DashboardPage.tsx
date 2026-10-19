import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { PAYMENT_LABELS, type DashboardDto, type PaymentMethod, type YearlyRowDto } from '@resto/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { api } from '@/lib/api';
import { compactAr, fmtDate, fmtQty, money, shiftDate, todayStr } from '@/lib/format';
import { cn, errorMessage } from '@/lib/utils';

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
// Ordre fixe des séries (palette catégorielle validée) : la couleur suit le mode de paiement, jamais son rang.
const METHOD_COLOR: Record<PaymentMethod, string> = {
  cash: 'var(--series-1)', mvola: 'var(--series-2)', orange_money: 'var(--series-3)', airtel_money: 'var(--series-4)', card: 'var(--series-5)',
};

function Kpi({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: 'profit' }) {
  const neg = tone === 'profit' && value < 0;
  return (
    <Card className="px-4 py-3.5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn('num mt-1 font-display text-2xl font-semibold sm:text-[1.7rem]', neg && 'text-destructive')}>{money(value)}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function SalesTooltip({ active, payload }: { active?: boolean; payload?: { payload: { date: string; total: number } }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-sm shadow-md">
      <p className="num font-semibold">{money(p.total)}</p>
      <p className="text-xs text-muted-foreground">{fmtDate(p.date)}</p>
    </div>
  );
}

export default function DashboardPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayStr());
  const [asTable, setAsTable] = useState(false);
  const [year, setYear] = useState(Number(todayStr().slice(0, 4)));
  const [opening, setOpening] = useState<number>(0);

  const dash = useQuery({ queryKey: ['dashboard', date], queryFn: () => api<DashboardDto>(`/dashboard?date=${date}`), placeholderData: (prev) => prev });
  const yearly = useQuery({ queryKey: ['dashboard', 'yearly', year], queryFn: () => api<YearlyRowDto[]>(`/dashboard/yearly?year=${year}`), placeholderData: (prev) => prev });
  const d = dash.data;
  useEffect(() => { if (d) setOpening(d.cash.opening); }, [d?.date, d?.cash.opening]);

  const saveOpening = useMutation({
    mutationFn: () => api('/dashboard/opening-balance', { method: 'PUT', body: { date, amount: Math.round(opening || 0) } }),
    onSuccess: () => { toast.success('Solde initial enregistré'); void qc.invalidateQueries({ queryKey: ['dashboard', date] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const series = (d?.series ?? []).map((s) => ({ ...s, label: s.date.slice(8) }));
  const maxTop = Math.max(1, ...(d?.top_items ?? []).map((t) => t.quantity));
  const maxMethod = Math.max(1, ...(d?.by_method ?? []).map((m) => m.total));
  const total = (k: keyof Omit<YearlyRowDto, 'month'>) => (yearly.data ?? []).reduce((s, r) => s + r[k], 0);
  const isToday = date === todayStr();

  return (
    <div className="space-y-6">
      <PageHeader title="Tableau de bord" description={d ? `Situation au ${fmtDate(d.date)}${d.open_orders ? ` · ${d.open_orders} table(s) en cours` : ''}` : undefined} />

      {/* Filtre : une seule ligne au-dessus du contenu qu'il pilote */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5"><Label htmlFor="date">Date de référence</Label><Input id="date" type="date" value={date} max={todayStr()} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" /></div>
        <Button variant={isToday ? 'default' : 'outline'} onClick={() => setDate(todayStr())}>Aujourd’hui</Button>
        <Button variant={date === shiftDate(todayStr(), -1) ? 'default' : 'outline'} onClick={() => setDate(shiftDate(todayStr(), -1))}>Hier</Button>
      </div>

      <div className={cn('space-y-6 transition-opacity', dash.isFetching && 'opacity-70')}>
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Chiffre d'affaires et bénéfice">
          <Kpi label="Ventes du jour" value={d?.kpis.sales_day ?? 0} hint={`${d?.kpis.orders_day ?? 0} ticket(s)`} />
          <Kpi label="Ventes du mois" value={d?.kpis.sales_month ?? 0} hint={`${d?.kpis.orders_month ?? 0} ticket(s)`} />
          <Kpi label="Bénéfice net du jour" value={d?.kpis.profit_day ?? 0} tone="profit" hint="ventes − achats − dépenses" />
          <Kpi label="Bénéfice net du mois" value={d?.kpis.profit_month ?? 0} tone="profit" hint="ventes − achats − dépenses" />
          <Kpi label="Achats du jour" value={d?.kpis.purchases_day ?? 0} />
          <Kpi label="Achats du mois" value={d?.kpis.purchases_month ?? 0} />
          <Kpi label="Dépenses du jour" value={d?.kpis.expenses_day ?? 0} />
          <Kpi label="Dépenses du mois" value={d?.kpis.expenses_month ?? 0} />
        </section>

        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <Card>
            <CardHeader>
              <CardTitle>Ventes des 30 derniers jours</CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setAsTable((v) => !v)}>{asTable ? 'Voir le graphique' : 'Voir les chiffres'}</Button>
            </CardHeader>
            <CardContent>
              {asTable ? (
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground"><tr><th className="py-1.5 font-medium">Jour</th><th className="py-1.5 text-right font-medium">Ventes</th></tr></thead>
                    <tbody className="divide-y divide-border">{[...series].reverse().map((s) => <tr key={s.date}><td className="py-1.5">{fmtDate(s.date)}</td><td className="num py-1.5 text-right">{money(s.total)}</td></tr>)}</tbody>
                  </table>
                </div>
              ) : (
                <div className="h-64" role="img" aria-label="Histogramme des ventes quotidiennes sur 30 jours">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={series} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} interval="preserveStartEnd" minTickGap={14} />
                      <YAxis tickLine={false} axisLine={false} width={44} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} tickFormatter={compactAr} />
                      <Tooltip content={<SalesTooltip />} cursor={{ fill: 'var(--muted)' }} />
                      <Bar dataKey="total" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Trésorerie du jour</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Encaissements (ventes)</dt><dd className="num font-medium">{money(d?.cash.inflow ?? 0)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Décaissements (achats + dépenses)</dt><dd className="num font-medium">{money(d?.cash.outflow ?? 0)}</dd></div>
              </dl>
              <div className="space-y-1.5">
                <Label htmlFor="opening">Solde initial</Label>
                <div className="flex gap-2">
                  <Input id="opening" type="number" inputMode="numeric" min={0} step={1} value={Number.isNaN(opening) ? '' : opening} onChange={(e) => setOpening(e.target.valueAsNumber)} />
                  <Button variant="outline" disabled={saveOpening.isPending} onClick={() => saveOpening.mutate()}>OK</Button>
                </div>
              </div>
              <p className="flex items-baseline justify-between border-t border-border pt-3"><span className="text-sm">Reste en caisse</span><span className={cn('num font-display text-2xl font-semibold', (d?.cash.remaining ?? 0) < 0 && 'text-destructive')}>{money(d?.cash.remaining ?? 0)}</span></p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader><CardTitle>Plats les plus vendus ce mois</CardTitle></CardHeader>
            <CardContent>
              {!d?.top_items.length && <p className="text-sm text-muted-foreground">Aucune vente ce mois-ci.</p>}
              <ul className="space-y-3">
                {d?.top_items.map((t) => (
                  <li key={t.name}>
                    <div className="flex justify-between gap-3 text-sm"><span className="truncate">{t.name}</span><span className="num shrink-0 font-medium">{t.quantity}</span></div>
                    <div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${(t.quantity / maxTop) * 100}%` }} /></div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Modes de paiement ce mois</CardTitle></CardHeader>
            <CardContent>
              {!d?.by_method.length && <p className="text-sm text-muted-foreground">Aucun encaissement ce mois-ci.</p>}
              <ul className="space-y-3">
                {d?.by_method.map((m) => (
                  <li key={m.method}>
                    <div className="flex justify-between gap-3 text-sm"><span>{PAYMENT_LABELS[m.method]} <span className="text-muted-foreground">({m.count})</span></span><span className="num font-medium">{money(m.total)}</span></div>
                    <div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full" style={{ width: `${(m.total / maxMethod) * 100}%`, background: METHOD_COLOR[m.method] }} /></div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Stock à commander</CardTitle><Link to="/stock" className="text-sm text-primary underline-offset-2 hover:underline">Voir tout</Link></CardHeader>
            <CardContent>
              {!d?.low_stock.length && <p className="text-sm text-muted-foreground">Rien à commander pour le moment.</p>}
              <ul className="divide-y divide-border">
                {d?.low_stock.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="truncate">{s.name}</span>
                    <span className={cn('num shrink-0 font-medium', s.qty <= 0 ? 'text-destructive' : 'text-[#8a5200]')}>{fmtQty(s.qty)} / {fmtQty(s.min_qty)} {s.unit}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Tableau mensuel</CardTitle>
            <Select aria-label="Année" value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-9 w-28">
              {[0, 1, 2, 3].map((i) => { const y = Number(todayStr().slice(0, 4)) - i; return <option key={y} value={y}>{y}</option>; })}
            </Select>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2 font-medium">Mois</th><th className="py-2 text-right font-medium">Chiffre d’affaires</th><th className="py-2 text-right font-medium">Achats</th><th className="py-2 text-right font-medium">Dépenses</th><th className="py-2 text-right font-medium">Bénéfice</th></tr></thead>
              <tbody className="divide-y divide-border">
                {(yearly.data ?? []).map((r) => (
                  <tr key={r.month}><td className="py-2">{MONTHS[r.month - 1]}</td><td className="num py-2 text-right">{money(r.sales)}</td><td className="num py-2 text-right">{money(r.purchases)}</td><td className="num py-2 text-right">{money(r.expenses)}</td><td className={cn('num py-2 text-right font-medium', r.profit < 0 && 'text-destructive')}>{money(r.profit)}</td></tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border font-semibold"><tr><td className="py-2">Total {year}</td><td className="num py-2 text-right">{money(total('sales'))}</td><td className="num py-2 text-right">{money(total('purchases'))}</td><td className="num py-2 text-right">{money(total('expenses'))}</td><td className={cn('num py-2 text-right', total('profit') < 0 && 'text-destructive')}>{money(total('profit'))}</td></tr></tfoot>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
