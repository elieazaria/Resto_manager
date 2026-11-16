import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, LogIn, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { type HotelReservationDto, type HotelSettings } from '@resto/shared';
import { PageHeader } from '@/components/PageHeader';
import { ReservationDetail } from '@/components/hotel/ReservationDetail';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DateField } from '@/components/ui/date-field';
import { api } from '@/lib/api';
import { fmtDate, money, shiftDate, todayStr } from '@/lib/format';
import { useReservations } from '@/lib/hotel';
import { errorMessage } from '@/lib/utils';

export default function ArrivalsPage() {
  const qc = useQueryClient();
  const today = todayStr();
  const [day, setDay] = useState(today);
  const [detail, setDetail] = useState<string | null>(null);
  const list = useReservations({});
  const settings = useQuery({ queryKey: ['hotel', 'settings'], queryFn: () => api<HotelSettings>('/hotel/settings') });
  const all = (list.data ?? []).filter((r) => r.status !== 'cancelled');

  const arrivals = all.filter((r) => r.arrival === day && ['option', 'confirmed', 'checked_in'].includes(r.status));
  const departures = all.filter((r) => r.departure === day && ['checked_in', 'checked_out'].includes(r.status));
  const staying = all.filter((r) => r.status === 'checked_in' && r.arrival < day && r.departure > day);

  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: string }) => api(`/hotel/reservations/${v.id}/status`, { method: 'POST', body: { status: v.status } }),
    onSuccess: () => { toast.success('Statut mis à jour'); void qc.invalidateQueries({ queryKey: ['hotel'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const Row = ({ r, kind }: { r: HotelReservationDto; kind: 'in' | 'out' | 'stay' }) => {
    const time = kind === 'in' ? (r.checkin_time ?? settings.data?.checkin_time) : kind === 'out' ? (r.checkout_time ?? settings.data?.checkout_time) : null;
    return (
      <li className="flex flex-wrap items-center gap-3 py-3">
        <span className="num grid h-9 min-w-12 place-items-center rounded-lg bg-muted px-2 text-sm font-semibold">{r.room_number}</span>
        <button className="min-w-0 flex-1 text-left" onClick={() => setDetail(r.id)}>
          <span className="block truncate font-medium">{r.client_name}</span>
          <span className="block text-xs text-muted-foreground">
            {r.adults + r.children} pers. · {r.nights} nuit{r.nights > 1 ? 's' : ''}{time ? ` · ${time}` : ''}{r.balance > 0 ? ` · reste ${money(r.balance)}` : ''}
          </span>
        </button>
        {kind === 'in' && (r.status === 'checked_in' ? <span className="text-xs font-medium text-primary">Arrivé</span> : <Button size="sm" onClick={() => setStatus.mutate({ id: r.id, status: 'checked_in' })} disabled={setStatus.isPending}><LogIn /> Check-in</Button>)}
        {kind === 'out' && (r.status === 'checked_out' ? <span className="text-xs font-medium text-muted-foreground">Parti</span> : <Button size="sm" variant="accent" onClick={() => setDetail(r.id)}><LogOut /> Check-out</Button>)}
      </li>
    );
  };

  const Section = ({ title, tone, rows, kind, empty }: { title: string; tone: string; rows: HotelReservationDto[]; kind: 'in' | 'out' | 'stay'; empty: string }) => (
    <Card className="p-4" style={{ background: `color-mix(in srgb, ${tone} 5%, var(--card))`, borderColor: `color-mix(in srgb, ${tone} 25%, var(--border))` }}>
      <h2 className="mb-1 flex items-center justify-between font-display text-lg font-semibold">{title}<span className="num rounded-full px-2.5 py-0.5 text-sm text-white" style={{ background: tone }}>{rows.length}</span></h2>
      {rows.length ? <ul className="divide-y divide-border">{rows.map((r) => <Row key={r.id} r={r} kind={kind} />)}</ul> : <p className="py-4 text-sm text-muted-foreground">{empty}</p>}
    </Card>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Arrivées et départs" description={day === today ? 'Aujourd’hui' : fmtDate(day)} actions={
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" aria-label="Jour précédent" onClick={() => setDay(shiftDate(day, -1))}><ChevronLeft /></Button>
          <DateField value={day} onChange={setDay} aria-label="Jour" />
          <Button size="icon" variant="outline" aria-label="Jour suivant" onClick={() => setDay(shiftDate(day, 1))}><ChevronRight /></Button>
          <Button variant="ghost" onClick={() => setDay(today)}>Aujourd’hui</Button>
        </div>
      } />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Arrivées" tone="var(--tone-green)" rows={arrivals} kind="in" empty="Aucune arrivée ce jour." />
        <Section title="Départs" tone="var(--tone-red)" rows={departures} kind="out" empty="Aucun départ ce jour." />
      </div>
      <Section title="En séjour" tone="var(--tone-violet)" rows={staying} kind="stay" empty="Aucun client en séjour (hors arrivées et départs du jour)." />
      <ReservationDetail id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
