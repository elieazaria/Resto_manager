import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BedDouble, LogIn, LogOut, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ROOM_LIVE_LABELS, ROOM_TECH_LABELS, ROOM_TECH_STATUSES, roomLiveStatus, type HotelRoomDto, type RoomLiveStatus } from '@resto/shared';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { ReservationDetail } from '@/components/hotel/ReservationDetail';
import { ReservationDialog } from '@/components/hotel/ReservationDialog';
import { api } from '@/lib/api';
import { fmtDate, money } from '@/lib/format';
import { LIVE_COLOR, useReservations, useRooms } from '@/lib/hotel';
import { cn, errorMessage } from '@/lib/utils';

export default function RoomsPage() {
  const qc = useQueryClient();
  const rooms = useRooms();
  const [filter, setFilter] = useState<RoomLiveStatus | ''>('');
  const [detail, setDetail] = useState<string | null>(null);
  const [book, setBook] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const arriving = useReservations({ status: 'option,confirmed' });

  const list = (rooms.data ?? []).filter((r) => r.is_active);
  const counts = list.reduce<Record<string, number>>((m, r) => { const s = roomLiveStatus(r); m[s] = (m[s] ?? 0) + 1; return m; }, {});
  const shown = list.filter((r) => !filter || roomLiveStatus(r) === filter);

  const tech = useMutation({
    mutationFn: (v: { id: string; tech_status: string }) => api(`/hotel/rooms/${v.id}`, { method: 'PATCH', body: { tech_status: v.tech_status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hotel'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const status = useMutation({
    mutationFn: (v: { id: string; status: string }) => api(`/hotel/reservations/${v.id}/status`, { method: 'POST', body: { status: v.status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hotel'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  // Réservation du jour pour proposer le check-in directement depuis la carte
  const todays = (roomId: string) => (arriving.data ?? []).find((r) => r.room_id === roomId && r.arrival <= today && r.departure > today);

  return (
    <div className="space-y-4">
      <PageHeader title="Chambres en temps réel" description="Statut mis à jour automatiquement ; check-in / check-out en un clic."
        actions={<Button onClick={() => setBook('')}><Plus /> Nouvelle réservation</Button>} />
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilter('')} className={cn('rounded-full border px-3 py-1.5 text-sm', !filter ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card')}>Toutes <span className="num ml-1">{list.length}</span></button>
        {(Object.keys(ROOM_LIVE_LABELS) as RoomLiveStatus[]).filter((s) => counts[s]).map((s) => (
          <button key={s} onClick={() => setFilter(filter === s ? '' : s)} className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm', filter === s ? 'border-ink bg-ink text-ink-foreground' : 'border-border bg-card')}>
            <i className="size-2.5 rounded-full" style={{ background: LIVE_COLOR[s] }} />{ROOM_LIVE_LABELS[s]} <span className="num">{counts[s]}</span>
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((r: HotelRoomDto) => {
          const live = roomLiveStatus(r);
          const t = todays(r.id);
          return (
            <article key={r.id} className="flex flex-col rounded-xl border border-border bg-card p-4" style={{ borderTop: `4px solid ${LIVE_COLOR[live]}` }}>
              <div className="flex items-start justify-between gap-2">
                <div><h3 className="font-display text-lg font-semibold">{r.number}</h3><p className="text-xs text-muted-foreground">{r.type_name} · {r.capacity} pers. · <span className="whitespace-nowrap">{money(r.effective_price)}</span></p></div>
                <span className="rounded-full px-2.5 py-0.5 text-xs font-medium text-white" style={{ background: LIVE_COLOR[live] }}>{ROOM_LIVE_LABELS[live]}</span>
              </div>
              <div className="mt-2 min-h-10 text-sm">
                {r.occupied_by ? <p><BedDouble className="mr-1 inline size-4" /><b>{r.occupied_by}</b> jusqu’au {fmtDate(r.occupied_until!)}</p>
                  : r.next_arrival ? <p className="text-muted-foreground">Prochaine arrivée : {fmtDate(r.next_arrival)} · {r.next_client}</p>
                  : <p className="text-muted-foreground">Aucune réservation à venir</p>}
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                {r.occupied_reservation_id && <>
                  <Button size="sm" onClick={() => status.mutate({ id: r.occupied_reservation_id!, status: 'checked_out' })}><LogOut /> Check-out</Button>
                  <Button size="sm" variant="outline" onClick={() => setDetail(r.occupied_reservation_id)}>Dossier</Button></>}
                {!r.occupied_reservation_id && t && <>
                  <Button size="sm" onClick={() => status.mutate({ id: t.id, status: 'checked_in' })}><LogIn /> Check-in</Button>
                  <Button size="sm" variant="outline" onClick={() => setDetail(t.id)}>Dossier</Button></>}
                {!r.occupied_reservation_id && !t && <Button size="sm" variant="outline" onClick={() => setBook(r.id)}>Réserver</Button>}
                <Select className="h-9 w-auto min-w-0 flex-1 text-sm" value={r.tech_status} aria-label="État technique" onChange={(e) => tech.mutate({ id: r.id, tech_status: e.target.value })}>
                  {ROOM_TECH_STATUSES.map((s) => <option key={s} value={s}>{ROOM_TECH_LABELS[s]}</option>)}
                </Select>
              </div>
            </article>
          );
        })}
      </div>
      {!rooms.isLoading && !shown.length && <p className="py-10 text-center text-muted-foreground">Aucune chambre à afficher.</p>}
      <ReservationDialog open={book !== null} onOpenChange={(o) => !o && setBook(null)} initial={book ? { room_id: book } : undefined} />
      <ReservationDetail id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
