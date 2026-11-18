import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileDown } from 'lucide-react';
import { toast } from 'sonner';
import type { HotelReportDto, HotelYearlyRowDto, Settings } from '@resto/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label, Select } from '@/components/ui/input';
import { DateField } from '@/components/ui/date-field';
import { api } from '@/lib/api';
import { fmtDate, fmtQty, money, todayStr } from '@/lib/format';
import { pdfHotelReport } from '@/lib/hotelPdf';
import { comparePeriod, pct, periodOf, PERIOD_LABELS, type CompareKind, type PeriodKind } from '@/lib/period';
import { cn, errorMessage } from '@/lib/utils';

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const delta = (a: number, b: number) => { const p = pct(a, b); return p == null ? 'nouveau' : `${p > 0 ? '+' : ''}${p.toLocaleString('fr-FR')} %`; };
const tone = (n: number) => (n > 0 ? 'text-primary' : n < 0 ? 'text-destructive' : '');

/** Résultat net, statistiques et comparatifs de l'hôtel par période (jour / semaine / mois / année). */
export function HotelReportCard() {
  const [kind, setKind] = useState<PeriodKind>('month');
  const [ref, setRef] = useState(todayStr());
  const [cmp, setCmp] = useState<CompareKind>('previous');
  const [busy, setBusy] = useState(false);
  const year = Number(ref.slice(0, 4));
  const p = periodOf(kind, ref);
  const cp = cmp === 'none' ? null : comparePeriod(kind, p, cmp);
  const get = (x: { from: string; to: string }) => api<HotelReportDto>(`/hotel/report?from=${x.from}&to=${x.to}`);
  const cur = useQuery({ queryKey: ['hotel', 'report', p.from, p.to], queryFn: () => get(p), placeholderData: (v) => v });
  const prev = useQuery({ queryKey: ['hotel', 'report', cp?.from, cp?.to], queryFn: () => get(cp!), enabled: !!cp, placeholderData: (v) => v });
  const yA = useQuery({ queryKey: ['hotel', 'yearly', year - 1], queryFn: () => api<HotelYearlyRowDto[]>(`/hotel/yearly?year=${year - 1}`) });
  const yB = useQuery({ queryKey: ['hotel', 'yearly', year], queryFn: () => api<HotelYearlyRowDto[]>(`/hotel/yearly?year=${year}`) });
  const r = cur.data;
  const c = cp ? prev.data : undefined;
  const label = (x: { from: string; to: string }) => (x.from === x.to ? fmtDate(x.from) : `${fmtDate(x.from)} au ${fmtDate(x.to)}`);
  const cmpLabel = cmp === 'lastyear' ? `Même période ${year - 1}` : 'Période précédente';

  const download = async () => {
    if (!r) return;
    setBusy(true);
    try {
      const s = await api<Settings>('/settings');
      await pdfHotelReport({
        hotel: s.restaurant_name, title: `${PERIOD_LABELS[kind]} · ${label(p)}`, report: r,
        compare: c && cp ? { label: `${cmpLabel} (${label(cp)})`, report: c } : undefined,
        grid: yA.data && yB.data ? [{ year: year - 1, rows: yA.data }, { year, rows: yB.data }] : undefined,
      });
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  type K = [string, number, number | undefined, 'ar' | 'n' | 'p', boolean?];
  const kp: K[] = r ? [
    ['Chiffre d’affaires', r.revenue, c?.revenue, 'ar'], ['Dépenses', r.expenses, c?.expenses, 'ar', true], ['Résultat net', r.net, c?.net, 'ar'], ['Marge nette', r.margin_percent, c?.margin_percent, 'p'],
    ['Taux d’occupation', r.occupancy_percent, c?.occupancy_percent, 'p'], ['Nuitées vendues', r.nights, c?.nights, 'n'], ['Prix moyen / nuitée', r.adr, c?.adr, 'ar'], ['RevPAR', r.revpar, c?.revpar, 'ar'],
  ] : [];
  const fv = (n: number, t: K[3]) => (t === 'ar' ? money(n) : t === 'p' ? `${n.toLocaleString('fr-FR')} %` : fmtQty(n));
  const g = (rows: HotelYearlyRowDto[] | undefined, m: number, k: 'revenue' | 'expenses' | 'net') => rows?.find((x) => x.month === m)?.[k] ?? 0;
  const sum = (rows: HotelYearlyRowDto[] | undefined, k: 'revenue' | 'expenses' | 'net') => (rows ?? []).reduce((s, x) => s + x[k], 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Résultat net, statistiques et comparatifs</CardTitle>
        <Button onClick={download} disabled={!r || busy}><FileDown /> {busy ? 'Génération…' : 'Télécharger en PDF'}</Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5"><Label htmlFor="hpk">Période</Label>
            <Select id="hpk" className="h-10 w-36" value={kind} onChange={(e) => setKind(e.target.value as PeriodKind)}>{(Object.keys(PERIOD_LABELS) as PeriodKind[]).map((k) => <option key={k} value={k}>{PERIOD_LABELS[k]}</option>)}</Select></div>
          <div className="space-y-1.5"><Label htmlFor="hpr">Date de référence</Label><DateField id="hpr" value={ref} onChange={setRef} /></div>
          <div className="space-y-1.5"><Label htmlFor="hpc">Comparer à</Label>
            <Select id="hpc" className="h-10 w-56" value={cmp} onChange={(e) => setCmp(e.target.value as CompareKind)}>
              <option value="previous">La période précédente</option><option value="lastyear">La même période l’an dernier</option><option value="none">Aucune comparaison</option></Select></div>
          <p className="pb-2 text-sm text-muted-foreground">{label(p)}{cp ? ` · comparée à ${label(cp)}` : ''}</p>
        </div>

        {r && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {kp.map(([l, v, o, t, inverse]) => (
                <div key={l} className={cn('rounded-lg border border-border px-4 py-3', l === 'Résultat net' && (v < 0 ? 'bg-red-50' : 'bg-emerald-50'))}>
                  <p className="text-sm text-muted-foreground">{l}</p>
                  <p className={cn('num mt-0.5 font-display text-xl font-semibold', l === 'Résultat net' && (v < 0 ? 'text-destructive' : ''))}>{fv(v, t)}</p>
                  {o !== undefined && <p className={cn('num text-xs', tone(inverse ? o - v : v - o))}>{t === 'p' ? `${v - o > 0 ? '+' : ''}${(Math.round((v - o) * 10) / 10).toLocaleString('fr-FR')} pt` : delta(v, o)} <span className="text-muted-foreground">vs {fv(o, t)}</span></p>}
                </div>
              ))}
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <Block title="Répartition du chiffre d’affaires" rows={[['Hébergement', r.lodging], ['Suppléments', r.extras], ['Taxe de séjour', r.tourist_tax], ['Remises', -r.discounts], ['Ventes sur place', r.walkins]]} total={['Total CA', r.revenue]} />
              <Block title="Dépenses par catégorie" rows={r.expenses_by_category.map((x) => [x.category, x.total])} total={['Total dépenses', r.expenses]} empty="Aucune dépense « Hôtel » sur cette période." />
              <Block title="Par type de chambre" rows={r.by_room_type.map((x) => [`${x.name} · ${x.reservations} rés. · ${x.nights} nuit.`, x.revenue])} empty="Aucun séjour." />
              <Block title="Suppléments les plus vendus" rows={r.top_extras.map((x) => [`${x.label} × ${fmtQty(x.quantity)}`, x.revenue])} empty="Aucun supplément." />
            </div>
          </>
        )}

        <div>
          <h3 className="mb-1 text-sm font-semibold">Comparatif mensuel : {year - 1} / {year}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1.5 font-medium">Mois</th><th className="py-1.5 text-right font-medium">CA {year - 1}</th><th className="py-1.5 text-right font-medium">CA {year}</th><th className="py-1.5 text-right font-medium">%</th><th className="py-1.5 text-right font-medium">Net {year - 1}</th><th className="py-1.5 text-right font-medium">Net {year}</th></tr></thead>
              <tbody className="divide-y divide-border">
                {MONTHS.map((mn, i) => { const a = g(yA.data, i + 1, 'revenue'), b = g(yB.data, i + 1, 'revenue'), na = g(yA.data, i + 1, 'net'), nb = g(yB.data, i + 1, 'net'); return (
                  <tr key={mn}><td className="py-1.5">{mn}</td><td className="num py-1.5 text-right">{money(a)}</td><td className="num py-1.5 text-right">{money(b)}</td><td className={cn('num py-1.5 text-right', tone(b - a))}>{delta(b, a)}</td>
                    <td className={cn('num py-1.5 text-right', tone(na))}>{money(na)}</td><td className={cn('num py-1.5 text-right', tone(nb))}>{money(nb)}</td></tr>); })}
              </tbody>
              <tfoot className="border-t-2 border-border font-semibold"><tr><td className="py-2">Total</td><td className="num py-2 text-right">{money(sum(yA.data, 'revenue'))}</td><td className="num py-2 text-right">{money(sum(yB.data, 'revenue'))}</td><td className={cn('num py-2 text-right', tone(sum(yB.data, 'revenue') - sum(yA.data, 'revenue')))}>{delta(sum(yB.data, 'revenue'), sum(yA.data, 'revenue'))}</td><td className="num py-2 text-right">{money(sum(yA.data, 'net'))}</td><td className="num py-2 text-right">{money(sum(yB.data, 'net'))}</td></tr></tfoot>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Block({ title, rows, total, empty }: { title: string; rows: [string, number][]; total?: [string, number]; empty?: string }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <ul className="divide-y divide-border text-sm">
        {rows.map(([l, v]) => <li key={l} className="flex justify-between py-1.5"><span>{l}</span><span className="num">{money(v)}</span></li>)}
        {!rows.length && empty && <li className="py-3 text-center text-muted-foreground">{empty}</li>}
        {total && <li className="flex justify-between py-1.5 font-semibold"><span>{total[0]}</span><span className="num">{money(total[1])}</span></li>}
      </ul>
    </div>
  );
}
