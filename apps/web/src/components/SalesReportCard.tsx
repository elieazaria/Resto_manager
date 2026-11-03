import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileDown } from 'lucide-react';
import { toast } from 'sonner';
import type { SalesReportDto, Settings, YearlyRowDto } from '@resto/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { api } from '@/lib/api';
import { fmtDate, fmtQty, money, todayStr } from '@/lib/format';
import { comparePeriod, pct, periodOf, PERIOD_LABELS, type CompareKind, type PeriodKind } from '@/lib/period';
import { pdfSalesReport } from '@/lib/salesPdf';
import { cn, errorMessage } from '@/lib/utils';

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const delta = (a: number, b: number) => { const p = pct(a, b); return p == null ? 'nouveau' : `${p > 0 ? '+' : ''}${p.toLocaleString('fr-FR')} %`; };
const tone = (n: number) => (n > 0 ? 'text-primary' : n < 0 ? 'text-destructive' : '');

/** Statistiques de ventes d'une période (jour / semaine / mois / année), comparaisons et export PDF. */
export function SalesReportCard() {
  const [kind, setKind] = useState<PeriodKind>('month');
  const [ref, setRef] = useState(todayStr());
  const [cmp, setCmp] = useState<CompareKind>('previous');
  const [busy, setBusy] = useState(false);
  const year = Number(ref.slice(0, 4));

  const p = periodOf(kind, ref);
  const cp = cmp === 'none' ? null : comparePeriod(kind, p, cmp);
  const get = (x: { from: string; to: string }) => api<SalesReportDto>(`/dashboard/report?from=${x.from}&to=${x.to}`);
  const cur = useQuery({ queryKey: ['dashboard', 'report', p.from, p.to], queryFn: () => get(p), placeholderData: (v) => v });
  const prev = useQuery({ queryKey: ['dashboard', 'report', cp?.from, cp?.to], queryFn: () => get(cp!), enabled: !!cp, placeholderData: (v) => v });
  const yA = useQuery({ queryKey: ['dashboard', 'yearly', year - 1], queryFn: () => api<YearlyRowDto[]>(`/dashboard/yearly?year=${year - 1}`) });
  const yB = useQuery({ queryKey: ['dashboard', 'yearly', year], queryFn: () => api<YearlyRowDto[]>(`/dashboard/yearly?year=${year}`) });
  const r = cur.data;
  const c = cp ? prev.data : undefined;

  const label = (x: { from: string; to: string }) => (x.from === x.to ? fmtDate(x.from) : `${fmtDate(x.from)} au ${fmtDate(x.to)}`);
  const cmpLabel = cmp === 'lastyear' ? `Même période ${year - 1}` : `Période précédente`;

  const download = async () => {
    if (!r) return;
    setBusy(true);
    try {
      const s = await api<Settings>('/settings');
      await pdfSalesReport({
        restaurant: s.restaurant_name, title: `${PERIOD_LABELS[kind]} · ${label(p)}`, report: r,
        compare: c && cp ? { label: `${cmpLabel} (${label(cp)})`, report: c } : undefined,
        grid: yA.data && yB.data ? [{ year: year - 1, rows: yA.data }, { year, rows: yB.data }] : undefined,
      });
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const kp: [string, number, number | undefined, boolean][] = r ? [
    ['Total des ventes', r.total, c?.total, true], ['Tickets', r.orders, c?.orders, false], ['Ticket moyen', r.avg_ticket, c?.avg_ticket, true], ['Articles vendus', r.items_sold, c?.items_sold, false],
  ] : [];
  const sa = (m: number) => yA.data?.find((x) => x.month === m)?.sales ?? 0;
  const sb = (m: number) => yB.data?.find((x) => x.month === m)?.sales ?? 0;
  const ta = (yA.data ?? []).reduce((s, x) => s + x.sales, 0);
  const tb = (yB.data ?? []).reduce((s, x) => s + x.sales, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Statistiques de ventes et comparatifs</CardTitle>
        <Button onClick={download} disabled={!r || busy}><FileDown /> {busy ? 'Génération…' : 'Télécharger en PDF'}</Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5"><Label htmlFor="pk">Période</Label>
            <Select id="pk" className="h-10 w-36" value={kind} onChange={(e) => setKind(e.target.value as PeriodKind)}>{(Object.keys(PERIOD_LABELS) as PeriodKind[]).map((k) => <option key={k} value={k}>{PERIOD_LABELS[k]}</option>)}</Select></div>
          <div className="space-y-1.5"><Label htmlFor="pr">Date de référence</Label>
            <Input id="pr" type="date" className="h-10 w-44" value={ref} max={todayStr()} onChange={(e) => e.target.value && setRef(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="pc">Comparer à</Label>
            <Select id="pc" className="h-10 w-56" value={cmp} onChange={(e) => setCmp(e.target.value as CompareKind)}>
              <option value="previous">La période précédente</option><option value="lastyear">La même période l’an dernier</option><option value="none">Aucune comparaison</option></Select></div>
          <p className="pb-2 text-sm text-muted-foreground">{label(p)}{cp ? ` · comparée à ${label(cp)}` : ''}</p>
        </div>

        {r && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {kp.map(([l, v, o, m]) => (
                <div key={l} className="rounded-lg border border-border px-4 py-3">
                  <p className="text-sm text-muted-foreground">{l}</p>
                  <p className="num mt-0.5 font-display text-xl font-semibold">{m ? money(v) : fmtQty(v)}</p>
                  {o !== undefined && <p className={cn('num text-xs', tone(v - o))}>{delta(v, o)} <span className="text-muted-foreground">vs {m ? money(o) : fmtQty(o)}</span></p>}
                </div>
              ))}
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold">Meilleures ventes</h3>
              <table className="w-full text-sm"><thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1.5 font-medium">Produit</th><th className="py-1.5 text-right font-medium">Qté</th><th className="py-1.5 text-right font-medium">CA</th></tr></thead>
                <tbody className="divide-y divide-border">{r.top_items.slice(0, 10).map((t, i) => <tr key={t.name}><td className="py-1.5">{i + 1}. {t.name}</td><td className="num py-1.5 text-right">{fmtQty(t.quantity)}</td><td className="num py-1.5 text-right">{money(t.revenue)}</td></tr>)}
                  {!r.top_items.length && <tr><td colSpan={3} className="py-4 text-center text-muted-foreground">Aucune vente sur cette période.</td></tr>}</tbody></table>
            </div>
          </>
        )}

        <div>
          <h3 className="mb-1 text-sm font-semibold">Comparatif mensuel des ventes : {year - 1} / {year}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1.5 font-medium">Mois</th><th className="py-1.5 text-right font-medium">{year - 1}</th><th className="py-1.5 text-right font-medium">{year}</th><th className="py-1.5 text-right font-medium">Écart</th><th className="py-1.5 text-right font-medium">%</th></tr></thead>
              <tbody className="divide-y divide-border">
                {MONTHS.map((mn, i) => { const a = sa(i + 1), b = sb(i + 1); return (
                  <tr key={mn}><td className="py-1.5">{mn}</td><td className="num py-1.5 text-right">{money(a)}</td><td className="num py-1.5 text-right">{money(b)}</td>
                    <td className={cn('num py-1.5 text-right', tone(b - a))}>{b - a > 0 ? '+' : ''}{money(b - a)}</td><td className={cn('num py-1.5 text-right', tone(b - a))}>{delta(b, a)}</td></tr>); })}
              </tbody>
              <tfoot className="border-t-2 border-border font-semibold"><tr><td className="py-2">Total</td><td className="num py-2 text-right">{money(ta)}</td><td className="num py-2 text-right">{money(tb)}</td><td className={cn('num py-2 text-right', tone(tb - ta))}>{tb - ta > 0 ? '+' : ''}{money(tb - ta)}</td><td className={cn('num py-2 text-right', tone(tb - ta))}>{delta(tb, ta)}</td></tr></tfoot>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
