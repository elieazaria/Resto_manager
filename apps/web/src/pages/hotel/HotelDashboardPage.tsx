import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HOTEL_PAYMENT_LABELS, HOTEL_STATUS_LABELS, ROOM_LIVE_LABELS, type HotelDashboardDto, type HotelResStatus, type RoomLiveStatus } from '@resto/shared';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { api } from '@/lib/api';
import { compactAr, fmtDate, money } from '@/lib/format';
import { LIVE_COLOR, STATUS_COLOR } from '@/lib/hotel';

const MONTHS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
const Kpi = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <Card className="px-4 py-3.5"><p className="text-sm text-muted-foreground">{label}</p><p className="num mt-1 font-display text-2xl font-semibold">{value}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</Card>
);

export default function HotelDashboardPage() {
  const q = useQuery({ queryKey: ['hotel', 'dashboard'], queryFn: () => api<HotelDashboardDto>('/hotel/dashboard'), refetchInterval: 30_000 });
  const d = q.data;
  if (!d) return <p className="p-10 text-center text-muted-foreground">Chargement…</p>;
  const monthly = d.monthly.map((m) => ({ ...m, label: `${MONTHS[Number(m.month.slice(5)) - 1]} ${m.month.slice(2, 4)}` }));
  const weekly = d.weekly.map((w) => ({ ...w, label: fmtDate(w.week_start).slice(0, 5) }));
  return (
    <div className="space-y-5">
      <PageHeader title="Tableau de bord hôtel" description={`Situation au ${fmtDate(d.date)}`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Taux d’occupation" value={`${d.occupancy_percent} %`} hint={`${d.occupied_today} / ${d.units_total} chambres`} />
        <Kpi label="Arrivées aujourd’hui" value={String(d.arrivals_today)} hint={`${d.upcoming_7d} dans les 7 jours`} />
        <Kpi label="Départs aujourd’hui" value={String(d.departures_today)} />
        <Kpi label="Reste à encaisser" value={money(d.outstanding_total)} />
        <Kpi label="CA du mois" value={money(d.revenue_month)} />
        <Kpi label="Encaissé ce mois" value={money(d.collected_month)} />
        <Kpi label="Encaissé au total" value={money(d.collected_total)} />
        <Kpi label="Ventes sur place (jour)" value={money(d.walkin_today)} hint="Piscine, clients externes" />
        <Kpi label="Ventes sur place (mois)" value={money(d.walkin_month)} />
        <Kpi label="Réservations actives" value={String(d.status_counts.confirmed + d.status_counts.checked_in + d.status_counts.option)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 font-display text-lg font-semibold">Chiffre d’affaires et encaissements (12 mois)</h2>
          <div className="h-64"><ResponsiveContainer><BarChart data={monthly}><CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tickFormatter={compactAr} width={44} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: any) => money(Number(v))} /><Legend /><Bar dataKey="revenue" name="CA" fill="var(--series-1)" radius={[3, 3, 0, 0]} /><Bar dataKey="collected" name="Encaissé" fill="var(--series-2)" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 font-display text-lg font-semibold">Récapitulatif hebdomadaire (8 semaines)</h2>
          <div className="h-64"><ResponsiveContainer><BarChart data={weekly}><CartesianGrid vertical={false} stroke="var(--border)" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} width={30} tick={{ fontSize: 11 }} />
            <Tooltip /><Legend /><Bar dataKey="reservations" name="Réservations" fill="var(--series-1)" radius={[3, 3, 0, 0]} /><Bar dataKey="nights" name="Nuitées" fill="var(--series-3)" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4"><h2 className="mb-2 font-display text-lg font-semibold">Chambres maintenant</h2>
          <ul className="space-y-1.5 text-sm">{(Object.keys(ROOM_LIVE_LABELS) as RoomLiveStatus[]).filter((s) => d.room_status[s]).map((s) => <li key={s} className="flex items-center justify-between"><span className="inline-flex items-center gap-2"><i className="size-2.5 rounded-full" style={{ background: LIVE_COLOR[s] }} />{ROOM_LIVE_LABELS[s]}</span><b className="num">{d.room_status[s]}</b></li>)}</ul></Card>
        <Card className="p-4"><h2 className="mb-2 font-display text-lg font-semibold">Réservations (30 derniers jours et à venir)</h2>
          <ul className="space-y-1.5 text-sm">{(Object.keys(HOTEL_STATUS_LABELS) as HotelResStatus[]).map((s) => <li key={s} className="flex items-center justify-between"><span className="inline-flex items-center gap-2"><i className="size-2.5 rounded-sm" style={{ background: STATUS_COLOR[s] }} />{HOTEL_STATUS_LABELS[s]}</span><b className="num">{d.status_counts[s]}</b></li>)}</ul></Card>
        <Card className="p-4"><h2 className="mb-2 font-display text-lg font-semibold">Encaissé ce mois par mode</h2>
          {d.by_method.length ? <ul className="space-y-1.5 text-sm">{d.by_method.map((m) => <li key={m.method} className="flex items-center justify-between"><span>{HOTEL_PAYMENT_LABELS[m.method]}</span><b className="num">{money(m.total)}</b></li>)}</ul> : <p className="text-sm text-muted-foreground">Aucun encaissement.</p>}</Card>
      </div>
    </div>
  );
}
