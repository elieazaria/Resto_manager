import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { HOTEL_STATUS_LABELS, type HotelReservationDto } from '@resto/shared';
import { PageHeader } from '@/components/PageHeader';
import { ReservationDetail } from '@/components/hotel/ReservationDetail';
import { ReservationDialog } from '@/components/hotel/ReservationDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fmtDate, money, todayStr } from '@/lib/format';
import { PAY_LABEL, PAY_TONE, STATUS_COLOR, useReservations } from '@/lib/hotel';
import { cn } from '@/lib/utils';

type Tab = 'upcoming' | 'staying' | 'done' | 'cancelled' | 'all';
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function ReservationsPage() {
  const today = todayStr();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const list = useReservations({});
  const all = list.data ?? [];

  const match: Record<Tab, (r: HotelReservationDto) => boolean> = {
    upcoming: (r) => ['option', 'confirmed'].includes(r.status) && r.departure > today,
    staying: (r) => r.status === 'checked_in',
    done: (r) => r.status === 'checked_out',
    cancelled: (r) => r.status === 'cancelled',
    all: () => true,
  };
  const tabs: { k: Tab; label: string }[] = [
    { k: 'upcoming', label: 'À venir' }, { k: 'staying', label: 'En séjour' }, { k: 'done', label: 'Terminées' }, { k: 'cancelled', label: 'Annulées' }, { k: 'all', label: 'Toutes' },
  ];
  const rows = useMemo(() => {
    const t = norm(q.trim());
    const out = all.filter(match[tab]).filter((r) => !t || norm(`${r.client_name} ${r.room_number} ${r.ref} ${r.client_phone ?? ''}`).includes(t));
    return out.sort((a, b) => (tab === 'done' || tab === 'all' ? b.arrival.localeCompare(a.arrival) : a.arrival.localeCompare(b.arrival)));
  }, [all, tab, q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <PageHeader title="Réservations" description={`${all.filter(match.upcoming).length} réservation(s) à venir`} actions={<Button onClick={() => setOpen(true)}><Plus /> Nouvelle réservation</Button>} />
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={cn('rounded-full border px-4 py-1.5 text-sm font-medium', tab === t.k ? 'border-ink bg-ink text-white' : 'border-border bg-card hover:bg-muted')}>
            {t.label} <span className="num ml-1 opacity-70">{all.filter(match[t.k]).length}</span>
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Client, chambre, N°…" aria-label="Rechercher" className="h-10 w-full rounded-full border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>{['Client', 'Chambre', 'Arrivée', 'Départ', 'Nuits', 'Montant', 'Payé', 'Statut'].map((h, i) => <th key={h} className={cn('px-4 py-3 font-medium', i >= 4 && i <= 6 && 'text-right')}>{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              return (
                <tr key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setDetail(r.id)}>
                  <td className="px-4 py-3"><span className="block font-semibold">{r.client_name}</span><span className="text-xs text-muted-foreground">{r.client_phone ?? r.ref}</span></td>
                  <td className="px-4 py-3"><span className="num rounded-md bg-muted px-2 py-1 font-semibold">{r.room_number}</span></td>
                  <td className="num px-4 py-3">{fmtDate(r.arrival)}</td>
                  <td className="num px-4 py-3">{fmtDate(r.departure)}</td>
                  <td className="num px-4 py-3 text-right">{r.nights}</td>
                  <td className="num px-4 py-3 text-right">{money(r.net_amount)}</td>
                  <td className="num px-4 py-3 text-right"><span className="block">{money(r.paid_amount)}</span><Badge tone={PAY_TONE[r.pay_status]}>{PAY_LABEL[r.pay_status]}</Badge></td>
                  <td className="px-4 py-3"><span className="rounded-full px-2.5 py-0.5 text-xs font-medium text-white" style={{ background: STATUS_COLOR[r.status] }}>{r.status === 'checked_in' ? 'En cours' : HOTEL_STATUS_LABELS[r.status]}</span></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">{list.isLoading ? 'Chargement…' : 'Aucune réservation.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <ReservationDialog open={open} onOpenChange={setOpen} />
      <ReservationDetail id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
