import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileDown, ListOrdered, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { HOTEL_STATUS_LABELS, type HotelReservationDto, type HotelResStatus, type HotelSettings } from '@resto/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { ReservationDetail } from '@/components/hotel/ReservationDetail';
import { ReservationDialog } from '@/components/hotel/ReservationDialog';
import { api } from '@/lib/api';
import { fmtDate, money, shiftDate, todayStr } from '@/lib/format';
import { daysBetween, downloadCsv, PAY_LABEL, STATUS_COLOR, useReservations, useRooms } from '@/lib/hotel';
import { pdfPlanning, pdfReservations } from '@/lib/pdf';
import { cn } from '@/lib/utils';

const CELL = 44;
const DOW = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
type Chip = 'all' | 'arrivals' | 'departures' | 'confirmed' | 'option' | 'cancelled';

export default function PlanningPage() {
  const today = todayStr();
  const [start, setStart] = useState(shiftDate(today, -3));
  const [span, setSpan] = useState(21);
  const [type, setType] = useState('');
  const [chip, setChip] = useState<Chip>('all');
  const [newOpen, setNewOpen] = useState(false);
  const [initial, setInitial] = useState<{ room_id?: string; arrival?: string }>();
  const [detail, setDetail] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);

  const end = shiftDate(start, span);
  const days = useMemo(() => Array.from({ length: span }, (_, i) => shiftDate(start, i)), [start, span]);
  const rooms = useRooms();
  const res = useReservations({ from: start, to: shiftDate(end, -1) });
  const settings = useQuery({ queryKey: ['hotel', 'settings'], queryFn: () => api<HotelSettings>('/hotel/settings') });

  const all = res.data ?? [];
  const counts = {
    arrivals: all.filter((r) => r.arrival === today && r.status !== 'cancelled').length,
    departures: all.filter((r) => r.departure === today && r.status !== 'cancelled').length,
    confirmed: all.filter((r) => r.status === 'confirmed').length,
    option: all.filter((r) => r.status === 'option').length,
    cancelled: all.filter((r) => r.status === 'cancelled').length,
  };
  const visible = all.filter((r) => {
    switch (chip) {
      case 'arrivals': return r.arrival === today && r.status !== 'cancelled';
      case 'departures': return r.departure === today && r.status !== 'cancelled';
      case 'confirmed': return r.status === 'confirmed';
      case 'option': return r.status === 'option';
      case 'cancelled': return r.status === 'cancelled';
      default: return r.status !== 'cancelled';
    }
  });

  const activeRooms = (rooms.data ?? []).filter((r) => r.is_active && (!type || r.room_type_id === type));
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; color: string; rooms: typeof activeRooms }>();
    for (const r of activeRooms) (m.get(r.room_type_id) ?? m.set(r.room_type_id, { name: r.type_name, color: r.color, rooms: [] }).get(r.room_type_id)!).rooms.push(r);
    return [...m.values()];
  }, [activeRooms]);
  const types = useMemo(() => [...new Map((rooms.data ?? []).map((r) => [r.room_type_id, r.type_name])).entries()], [rooms.data]);

  const chips: { k: Chip; label: string; n?: number }[] = [
    { k: 'arrivals', label: 'Arrivées du jour', n: counts.arrivals }, { k: 'departures', label: 'Départs du jour', n: counts.departures },
    { k: 'confirmed', label: 'Confirmée', n: counts.confirmed }, { k: 'option', label: 'En option', n: counts.option }, { k: 'cancelled', label: 'Annulées', n: counts.cancelled },
  ];

  const bar = (r: HotelReservationDto) => {
    const a = Math.max(0, daysBetween(start, r.arrival));
    const clippedLeft = r.arrival < start;
    const b = Math.min(span, daysBetween(start, r.departure));
    const left = a * CELL + (clippedLeft ? 0 : CELL / 2);
    const right = b * CELL - (r.departure > end ? 0 : CELL / 2);
    return { left, width: Math.max(CELL / 2, right - left - 2) };
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Planning des réservations"
        description="Cliquez sur une case libre pour réserver, sur une barre pour ouvrir le dossier."
        actions={
          <>
            <Button variant="outline" onClick={() => setListOpen(true)}><ListOrdered /> Vue planning liste</Button>
            <Button variant="outline" onClick={() => settings.data ? pdfPlanning(activeRooms, all, days, settings.data) : toast.error('Chargement…')}><FileDown /> PDF</Button>
            <Button variant="accent" onClick={() => { setInitial(undefined); setNewOpen(true); }}><Users /> Réservation groupée</Button>
            <Button onClick={() => { setInitial(undefined); setNewOpen(true); }}><Plus /> Nouvelle réservation</Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button key={c.k} onClick={() => setChip(chip === c.k ? 'all' : c.k)}
            className={cn('rounded-full border px-3 py-1.5 text-sm font-medium', chip === c.k ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted')}>
            {c.label} <span className="num ml-1 opacity-80">{c.n}</span>
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="icon" variant="outline" aria-label="Période précédente" onClick={() => setStart(shiftDate(start, -7))}><ChevronLeft /></Button>
          <Input type="date" className="h-10 w-40" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} aria-label="Début" />
          <Button size="icon" variant="outline" aria-label="Période suivante" onClick={() => setStart(shiftDate(start, 7))}><ChevronRight /></Button>
          <Button variant="ghost" onClick={() => setStart(shiftDate(today, -3))}>Aujourd’hui</Button>
          <Select className="h-10 w-32" value={span} onChange={(e) => setSpan(Number(e.target.value))} aria-label="Durée">
            <option value={14}>14 jours</option><option value={21}>21 jours</option><option value={31}>31 jours</option>
          </Select>
          <Select className="h-10 w-44" value={type} onChange={(e) => setType(e.target.value)} aria-label="Catégorie">
            <option value="">Toutes catégories</option>{types.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {(['option', 'confirmed', 'checked_in', 'checked_out'] as HotelResStatus[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5"><i className="size-3 rounded-sm" style={{ background: STATUS_COLOR[s] }} />{HOTEL_STATUS_LABELS[s]}</span>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <div style={{ width: 150 + span * CELL }} className="relative">
          <div className="sticky top-0 z-20 flex border-b border-border bg-muted/70 text-xs">
            <div className="sticky left-0 z-30 w-[150px] shrink-0 border-r border-border bg-muted px-3 py-2 font-semibold">Chambre</div>
            {days.map((d) => {
              const dt = new Date(`${d}T00:00:00Z`);
              return (
                <div key={d} style={{ width: CELL }} className={cn('shrink-0 border-r border-border/50 py-1 text-center', d === today && 'bg-accent/40 font-semibold', [0, 6].includes(dt.getUTCDay()) && 'text-muted-foreground')}>
                  <div>{DOW[dt.getUTCDay()]}</div><div className="num">{d.slice(8)}/{d.slice(5, 7)}</div>
                </div>
              );
            })}
          </div>
          {groups.map((g) => (
            <div key={g.name}>
              <div className="sticky left-0 flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1 text-xs font-semibold" style={{ width: 150 + span * CELL }}>
                <i className="size-2.5 rounded-full" style={{ background: g.color }} /> {g.name} <span className="font-normal text-muted-foreground">({g.rooms.length})</span>
              </div>
              {g.rooms.map((room) => (
                <div key={room.id} className="relative flex h-10 border-b border-border/60">
                  <div className="sticky left-0 z-10 flex w-[150px] shrink-0 items-center border-r border-border bg-card px-3 text-sm font-medium">{room.number}</div>
                  <div className="relative" style={{ width: span * CELL }}>
                    <div className="absolute inset-0 flex">
                      {days.map((d) => (
                        <button key={d} aria-label={`Réserver ${room.number} le ${fmtDate(d)}`} style={{ width: CELL }}
                          className={cn('h-full shrink-0 border-r border-border/40 hover:bg-primary/10', d === today && 'bg-accent/20', [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()) && 'bg-muted/30')}
                          onClick={() => { setInitial({ room_id: room.id, arrival: d }); setNewOpen(true); }} />
                      ))}
                    </div>
                    {visible.filter((r) => r.room_id === room.id).map((r) => {
                      const { left, width } = bar(r);
                      return (
                        <button key={r.id} onClick={() => setDetail(r.id)} title={`${r.client_name} · ${fmtDate(r.arrival)} → ${fmtDate(r.departure)} · ${HOTEL_STATUS_LABELS[r.status]}`}
                          className="absolute top-1 h-8 overflow-hidden rounded-md px-2 text-left text-xs font-medium text-white shadow-sm ring-1 ring-black/10 hover:brightness-110"
                          style={{ left, width, background: STATUS_COLOR[r.status] }}>
                          <span className="block truncate">{r.client_name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {!rooms.isLoading && groups.length === 0 && <p className="p-8 text-center text-muted-foreground">Aucune chambre. Créez-en dans « Hôtel › Chambres (gestion) » ou chargez les données démo dans les réglages.</p>}
          {days.includes(today) && <div className="pointer-events-none absolute bottom-0 top-0 z-[5] w-px bg-destructive/60" style={{ left: 150 + (daysBetween(start, today) + 0.5) * CELL }} />}
        </div>
      </div>

      <ReservationDialog open={newOpen} onOpenChange={setNewOpen} initial={initial} />
      <ReservationDetail id={detail} onClose={() => setDetail(null)} />
      <ListDialog open={listOpen} onOpenChange={setListOpen} settings={settings.data} onOpen={(id) => { setListOpen(false); setDetail(id); }} />
    </div>
  );
}

function ListDialog({ open, onOpenChange, settings, onOpen }: { open: boolean; onOpenChange: (o: boolean) => void; settings?: HotelSettings; onOpen: (id: string) => void }) {
  const today = todayStr();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [applied, setApplied] = useState({ from: today, to: today });
  const [q, setQ] = useState('');
  const list = useReservations({ ...applied, q });
  const rows = list.data ?? [];
  const preset = (f: string, t: string) => { setFrom(f); setTo(t); setApplied({ from: f, to: t }); };
  const ym = today.slice(0, 7);
  const lastMonth = shiftDate(`${ym}-01`, -1).slice(0, 7);
  const period = `${fmtDate(applied.from)} → ${fmtDate(applied.to)}`;
  const presets: [string, () => void][] = [
    ['Aujourd’hui', () => preset(today, today)], ['Hier', () => preset(shiftDate(today, -1), shiftDate(today, -1))],
    ['7 jours', () => preset(today, shiftDate(today, 6))], ['Ce mois', () => preset(`${ym}-01`, shiftDate(`${shiftDate(`${ym}-28`, 7).slice(0, 7)}-01`, -1))],
    ['Mois dernier', () => preset(`${lastMonth}-01`, shiftDate(`${ym}-01`, -1))], ['Cette année', () => preset(`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`)],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader title="Vue planning" description="Réservations qui chevauchent la période choisie." />
        <DialogBody className="space-y-3">
          <div className="flex flex-wrap gap-2">{presets.map(([l, f]) => <Button key={l} size="sm" variant="outline" onClick={f}>{l}</Button>)}</div>
          <div className="flex flex-wrap items-end gap-2">
            <Input type="date" className="h-10 w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Du" />
            <Input type="date" className="h-10 w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Au" />
            <Input className="h-10 w-48" placeholder="Rechercher client, N°…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button onClick={() => from && to && from <= to ? setApplied({ from, to }) : toast.error('Période invalide')}>Charger</Button>
            <Button variant="outline" disabled={!rows.length} onClick={() => downloadCsv(`reservations_${applied.from}_${applied.to}.csv`, [['N°', 'Client', 'Chambre', 'Arrivée', 'Départ', 'Statut', 'Total net', 'Payé', 'Reste'], ...rows.map((r) => [r.ref, r.client_name, r.room_number, r.arrival, r.departure, HOTEL_STATUS_LABELS[r.status], r.net_amount, r.paid_amount, Math.max(0, r.balance)])])}>Exporter CSV</Button>
            <Button variant="outline" disabled={!rows.length || !settings} onClick={() => settings && pdfReservations(rows, settings, period)}><FileDown /> Exporter PDF</Button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                <tr>{['N°', 'Client', 'Chambre(s)', 'Arrivée', 'Départ', 'Statut', 'Paiement', 'Total'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => onOpen(r.id)}>
                    <td className="num whitespace-nowrap px-3 py-2">{r.ref}</td><td className="px-3 py-2">{r.client_name}</td><td className="px-3 py-2">{r.room_number}</td>
                    <td className="num px-3 py-2">{fmtDate(r.arrival)}</td><td className="num px-3 py-2">{fmtDate(r.departure)}</td>
                    <td className="px-3 py-2"><span className="rounded-full px-2 py-0.5 text-xs text-white" style={{ background: STATUS_COLOR[r.status] }}>{HOTEL_STATUS_LABELS[r.status]}</span></td>
                    <td className="px-3 py-2"><Badge tone={r.pay_status === 'paid' ? 'ok' : r.pay_status === 'partial' ? 'warn' : 'danger'}>{PAY_LABEL[r.pay_status]}</Badge></td>
                    <td className="num px-3 py-2 text-right">{money(r.net_amount)}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Aucune réservation sur cette période.</td></tr>}
              </tbody>
            </table>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
