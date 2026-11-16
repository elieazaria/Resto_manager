import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileDown, ListOrdered, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { HOTEL_STATUS_LABELS, type HotelReservationDto, type HotelResStatus, type HotelSettings } from '@resto/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { DateField } from '@/components/ui/date-field';
import { PageHeader } from '@/components/PageHeader';
import { ReservationDetail } from '@/components/hotel/ReservationDetail';
import { ReservationDialog } from '@/components/hotel/ReservationDialog';
import { api } from '@/lib/api';
import { fmtDate, money, shiftDate, todayStr } from '@/lib/format';
import { BAR_STYLE, daysBetween, downloadCsv, PAY_LABEL, STATUS_COLOR, useReservations, useRooms } from '@/lib/hotel';
import { pdfPlanning, pdfReservations } from '@/lib/pdf';
import { cn } from '@/lib/utils';

const CELL = 56;
const LABEL_W = 170;
const ROW_H = 60;
const DOW = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
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
        title="Planning des chambres"
        description="Cliquez sur une case vide pour réserver, sur une barre pour ouvrir le dossier."
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
          <DateField value={start} onChange={setStart} aria-label="Début" />
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
        {(['checked_in', 'confirmed', 'option', 'checked_out'] as HotelResStatus[]).map((st) => (
          <span key={st} className="inline-flex items-center gap-1.5"><i className="size-3 rounded-sm border" style={{ background: BAR_STYLE[st].background, borderColor: BAR_STYLE[st].border, borderStyle: BAR_STYLE[st].borderStyle }} />{HOTEL_STATUS_LABELS[st]}</span>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <div style={{ width: LABEL_W + span * CELL }} className="relative">
          <div className="sticky top-0 z-20 flex border-b border-border bg-card text-xs">
            <div className="sticky left-0 z-30 flex w-[170px] shrink-0 flex-col justify-center border-r border-border bg-card px-4 py-2">
              <span className="text-sm text-muted-foreground">Chambre</span><span className="text-[11px] text-muted-foreground/80">Remplissage</span>
            </div>
            {days.map((d) => {
              const dt = new Date(`${d}T00:00:00Z`);
              const busy = new Set(all.filter((r) => r.status !== 'cancelled' && r.arrival <= d && r.departure > d).map((r) => r.room_id));
              const pct = activeRooms.length ? Math.round((activeRooms.filter((rm) => busy.has(rm.id)).length / activeRooms.length) * 100) : 0;
              return (
                <div key={d} style={{ width: CELL }} className={cn('shrink-0 border-r border-border/40 py-1.5 text-center', d === today && 'bg-accent/30', [0, 6].includes(dt.getUTCDay()) && d !== today && 'bg-muted/40')}>
                  <div className="text-muted-foreground">{DOW[dt.getUTCDay()]}</div>
                  <div className={cn('num font-display text-lg font-semibold leading-tight', d === today && 'text-primary')}>{Number(d.slice(8))}</div>
                  <div className="num text-[11px] text-muted-foreground">{pct} %</div>
                </div>
              );
            })}
          </div>
          {activeRooms.map((room) => (
            <div key={room.id} className="relative flex border-b border-border/60" style={{ height: ROW_H }}>
              <div className="sticky left-0 z-10 flex w-[170px] shrink-0 flex-col justify-center border-r border-border bg-card px-4">
                <span className="font-display text-lg font-semibold leading-tight">{room.number}</span>
                <span className="truncate text-xs text-muted-foreground">{room.type_name}</span>
              </div>
              <div className="relative" style={{ width: span * CELL }}>
                <div className="absolute inset-0 flex">
                  {days.map((d) => (
                    <button key={d} aria-label={`Réserver ${room.number} le ${fmtDate(d)}`} style={{ width: CELL }}
                      className={cn('h-full shrink-0 border-r border-border/30 hover:bg-primary/10', d === today && 'bg-accent/20', [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()) && d !== today && 'bg-muted/25')}
                      onClick={() => { setInitial({ room_id: room.id, arrival: d }); setNewOpen(true); }} />
                  ))}
                </div>
                {visible.filter((r) => r.room_id === room.id).map((r) => {
                  const { left, width } = bar(r);
                  const st = BAR_STYLE[r.status];
                  return (
                    <button key={r.id} onClick={() => setDetail(r.id)} title={`${r.client_name} · ${fmtDate(r.arrival)} → ${fmtDate(r.departure)} · ${HOTEL_STATUS_LABELS[r.status]}`}
                      className="absolute overflow-hidden rounded-lg border px-2.5 py-1 text-left shadow-sm hover:brightness-105"
                      style={{ left, width, top: 8, height: ROW_H - 16, background: st.background, color: st.color, borderColor: st.border, borderStyle: st.borderStyle ?? 'solid' }}>
                      <span className="block truncate text-[13px] font-semibold leading-tight" style={{ textDecoration: st.textDecoration }}>{r.client_name}</span>
                      <span className="block truncate text-[11px] leading-tight opacity-90">{r.nights} nuit{r.nights > 1 ? 's' : ''} · {r.status === 'checked_in' ? 'En séjour' : r.status === 'checked_out' ? 'Terminée' : HOTEL_STATUS_LABELS[r.status]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {!rooms.isLoading && activeRooms.length === 0 && <p className="p-8 text-center text-muted-foreground">Aucune chambre. Créez-en dans « Hôtel › Chambres (gestion) » ou chargez les données démo dans les réglages.</p>}
          {days.includes(today) && <div className="pointer-events-none absolute bottom-0 top-0 z-[5] w-px bg-primary/50" style={{ left: LABEL_W + (daysBetween(start, today) + 0.5) * CELL }} />}
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
            <DateField value={from} onChange={setFrom} aria-label="Du" />
            <DateField value={to} onChange={setTo} aria-label="Au" />
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
