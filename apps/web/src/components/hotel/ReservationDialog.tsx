import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { HOTEL_PAYMENT_LABELS, HOTEL_PAYMENT_METHODS, type HotelPaymentMethod, type HotelQuoteDto, type HotelRoomDto, type HotelSettings } from '@resto/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { money, shiftDate, todayStr } from '@/lib/format';
import { daysBetween } from '@/lib/hotel';
import { errorMessage } from '@/lib/utils';

interface Extra { service_id: string | null; label: string; unit_price: number; quantity: number; per_night: boolean }
interface Svc { id: string; name: string; unit_price: number; charge_mode: 'flat' | 'per_night'; is_active: boolean }
const num = (v: string) => (v === '' ? 0 : Math.max(0, Math.round(Number(v)) || 0));

export function ReservationDialog({ open, onOpenChange, initial, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; initial?: { room_id?: string; arrival?: string }; onCreated?: () => void;
}) {
  const qc = useQueryClient();
  const rooms = useQuery({ queryKey: ['hotel', 'rooms'], queryFn: () => api<HotelRoomDto[]>('/hotel/rooms'), enabled: open });
  const clients = useQuery({ queryKey: ['hotel', 'clients'], queryFn: () => api<any[]>('/hotel/clients'), enabled: open });
  const services = useQuery({ queryKey: ['hotel', 'services'], queryFn: () => api<Svc[]>('/hotel/services'), enabled: open });
  const settings = useQuery({ queryKey: ['hotel', 'settings'], queryFn: () => api<HotelSettings>('/hotel/settings'), enabled: open });

  const [group, setGroup] = useState(false);
  const [newClient, setNewClient] = useState(false);
  const [clientId, setClientId] = useState('');
  const [nc, setNc] = useState({ full_name: '', phone: '', email: '' });
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [arrival, setArrival] = useState(todayStr());
  const [departure, setDeparture] = useState(shiftDate(todayStr(), 1));
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [extras, setExtras] = useState<Extra[]>([]);
  const [discPct, setDiscPct] = useState('');
  const [discAmt, setDiscAmt] = useState('');
  const [status, setStatus] = useState<'option' | 'confirmed'>('confirmed');
  const [deposit, setDeposit] = useState('');
  const [method, setMethod] = useState<HotelPaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const a = initial?.arrival ?? todayStr();
    setArrival(a); setDeparture(shiftDate(a, 1)); setRoomIds(initial?.room_id ? [initial.room_id] : []);
    setGroup(false); setNewClient(false); setClientId(''); setNc({ full_name: '', phone: '', email: '' }); setAdults(1); setChildren(0);
    setPrices({}); setExtras([]); setDiscPct(''); setDiscAmt(''); setStatus('confirmed'); setDeposit(''); setMethod('cash'); setNote('');
  }, [open, initial?.room_id, initial?.arrival]);

  const nights = Math.max(0, daysBetween(arrival, departure));
  const valid = nights > 0;

  // Prix dynamique : un devis par chambre choisie (règles saisonnières / week-end), modifiable ensuite.
  const quotes = useQuery({
    queryKey: ['hotel', 'quotes', roomIds.join(','), arrival, departure],
    enabled: open && valid && roomIds.length > 0,
    queryFn: async () => Object.fromEntries(await Promise.all(roomIds.map(async (id) => [id, await api<HotelQuoteDto>(`/hotel/quote?room_id=${id}&arrival=${arrival}&departure=${departure}`)] as const))),
  });
  useEffect(() => {
    if (!quotes.data) return;
    setPrices((p) => Object.fromEntries(roomIds.map((id) => [id, quotes.data![id]?.average ?? p[id] ?? 0])));
  }, [quotes.data, roomIds.join(',')]);

  const lodging = roomIds.reduce((s, id) => s + nights * (prices[id] ?? 0), 0);
  const extrasTotal = extras.reduce((s, e) => s + e.unit_price * e.quantity * (e.per_night ? nights : 1), 0);
  const tax = (settings.data?.tourist_tax_per_person_night ?? 0) * adults * nights * Math.max(1, roomIds.length);
  const gross = lodging + extrasTotal + tax;
  const pct = Math.min(100, Number(discPct) || 0);
  const discount = Math.min(gross, num(discAmt) || Math.round((gross * pct) / 100));
  const net = gross - discount;

  const save = async () => {
    if (!valid) return toast.error('Le départ doit être après l’arrivée');
    if (!roomIds.length) return toast.error('Choisissez une chambre');
    if (!newClient && !clientId) return toast.error('Choisissez ou créez un client');
    if (newClient && !nc.full_name.trim()) return toast.error('Nom du client requis');
    const dep = num(deposit);
    if (dep > net) return toast.error('L’acompte dépasse le net du séjour');
    const body: any = {
      ...(newClient ? { new_client: { full_name: nc.full_name.trim(), phone: nc.phone, email: nc.email } } : { client_id: clientId }),
      arrival, departure, adults, children, status, note: note || null,
      discount_percent: discAmt ? 0 : pct, discount_amount: discount,
      extras: extras.filter((e) => e.quantity > 0).map((e) => ({ service_id: e.service_id, label: e.label, unit_price: e.unit_price, quantity: e.quantity, multiplier: e.per_night ? nights : 1 })),
      ...(dep > 0 ? { deposit: { amount: dep, method } } : {}),
    };
    setBusy(true);
    try {
      if (roomIds.length > 1 || group) await api('/hotel/reservations/group', { method: 'POST', body: { ...body, rooms: roomIds.map((id) => ({ room_id: id, price_per_night: prices[id] ?? 0 })) } });
      else await api('/hotel/reservations', { method: 'POST', body: { ...body, room_id: roomIds[0], price_per_night: prices[roomIds[0]!] ?? 0 } });
      toast.success('Réservation créée');
      void qc.invalidateQueries({ queryKey: ['hotel'] });
      onCreated?.();
      onOpenChange(false);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const activeRooms = useMemo(() => (rooms.data ?? []).filter((r) => r.is_active), [rooms.data]);
  const addExtra = (s?: Svc) => setExtras((x) => [...x, s ? { service_id: s.id, label: s.name, unit_price: s.unit_price, quantity: 1, per_night: s.charge_mode === 'per_night' } : { service_id: null, label: 'Autre supplément', unit_price: 0, quantity: 1, per_night: false }]);
  const upd = (i: number, p: Partial<Extra>) => setExtras((x) => x.map((e, j) => (j === i ? { ...e, ...p } : e)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader title={group ? 'Réservation groupée' : 'Nouvelle réservation'} description="Le prix par nuit est calculé selon les tarifs dynamiques ; vous pouvez le modifier." />
        <DialogBody className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <div className="flex items-center justify-between"><Label>Client</Label>
                <button type="button" className="text-sm font-medium text-primary" onClick={() => setNewClient((v) => !v)}>{newClient ? 'Choisir un client existant' : '+ Nouveau client'}</button></div>
              {newClient ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input placeholder="Nom complet" value={nc.full_name} onChange={(e) => setNc({ ...nc, full_name: e.target.value })} />
                  <Input placeholder="Téléphone" inputMode="tel" value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} />
                  <Input placeholder="E-mail" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} />
                </div>
              ) : (
                <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">— Sélectionner un client —</option>
                  {(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.full_name}{c.phone ? ` · ${c.phone}` : ''}</option>)}
                </Select>
              )}
            </div>
            <div className="space-y-1.5"><Label>Arrivée</Label><Input type="date" value={arrival} onChange={(e) => { setArrival(e.target.value); if (e.target.value >= departure) setDeparture(shiftDate(e.target.value, 1)); }} /></div>
            <div className="space-y-1.5"><Label>Départ</Label><Input type="date" min={shiftDate(arrival, 1)} value={departure} onChange={(e) => setDeparture(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Nombre de nuitées</Label><Input readOnly value={nights} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5"><Label>Adultes</Label><Input type="number" min={1} value={adults} onChange={(e) => setAdults(Math.max(1, Number(e.target.value) || 1))} /></div>
              <div className="space-y-1.5"><Label>Enfants</Label><Input type="number" min={0} value={children} onChange={(e) => setChildren(Math.max(0, Number(e.target.value) || 0))} /></div>
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{group ? 'Chambres (plusieurs)' : 'Chambre'}</Label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={group} onChange={(e) => { setGroup(e.target.checked); if (!e.target.checked) setRoomIds((r) => r.slice(0, 1)); }} /> Réservation groupée</label>
            </div>
            {group ? (
              <div className="grid max-h-44 grid-cols-2 gap-1.5 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-4">
                {activeRooms.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4" checked={roomIds.includes(r.id)} onChange={(e) => setRoomIds((x) => (e.target.checked ? [...x, r.id] : x.filter((i) => i !== r.id)))} />
                    {r.number}
                  </label>
                ))}
              </div>
            ) : (
              <Select value={roomIds[0] ?? ''} onChange={(e) => setRoomIds(e.target.value ? [e.target.value] : [])}>
                <option value="">— Sélectionner une chambre —</option>
                {activeRooms.map((r) => <option key={r.id} value={r.id}>{r.number} · {r.type_name} · {money(r.effective_price)}</option>)}
              </Select>
            )}
            {roomIds.map((id) => {
              const r = activeRooms.find((x) => x.id === id);
              const q = quotes.data?.[id];
              return (
                <div key={id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-28 font-medium">{r?.number}</span>
                  <Label className="text-muted-foreground">Prix / nuit</Label>
                  <Input className="num h-9 w-36" type="number" min={0} value={prices[id] ?? 0} onChange={(e) => setPrices({ ...prices, [id]: num(e.target.value) })} />
                  {q && q.nightly.some((n) => n.rule) && <span className="text-xs text-muted-foreground">tarif dynamique : {[...new Set(q.nightly.map((n) => n.rule).filter(Boolean))].join(', ')}</span>}
                </div>
              );
            })}
          </section>

          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Suppléments</Label>
              <div className="flex flex-wrap gap-1.5">
                {(services.data ?? []).filter((s) => s.is_active).map((s) => <Button key={s.id} size="sm" variant="outline" onClick={() => addExtra(s)}><Plus /> {s.name}</Button>)}
                <Button size="sm" variant="ghost" onClick={() => addExtra()}><Plus /> Autre</Button>
              </div>
            </div>
            {extras.map((e, i) => (
              <div key={i} className="grid grid-cols-[1fr_5.5rem_7rem_auto] items-center gap-2">
                <Input value={e.label} onChange={(ev) => upd(i, { label: ev.target.value })} aria-label="Libellé" />
                <Input type="number" min={1} value={e.quantity} onChange={(ev) => upd(i, { quantity: Math.max(1, num(ev.target.value)) })} aria-label="Quantité" />
                <Input type="number" min={0} value={e.unit_price} onChange={(ev) => upd(i, { unit_price: num(ev.target.value) })} aria-label="Prix unitaire" />
                <Button size="icon" variant="ghost" onClick={() => setExtras((x) => x.filter((_, j) => j !== i))} aria-label="Retirer"><Trash2 /></Button>
                <label className="col-span-4 -mt-1 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={e.per_night} onChange={(ev) => upd(i, { per_night: ev.target.checked })} /> facturé par nuit ({nights} nuit{nights > 1 ? 's' : ''})</label>
              </div>
            ))}
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5"><Label>Remise (%)</Label><Input type="number" min={0} max={100} value={discPct} disabled={!!discAmt} onChange={(e) => setDiscPct(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Remise (Ar)</Label><Input type="number" min={0} value={discAmt} onChange={(e) => setDiscAmt(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Statut</Label>
              <Select value={status} onChange={(e) => setStatus(e.target.value as any)}><option value="confirmed">Confirmée</option><option value="option">En option</option></Select></div>
            <div className="space-y-1.5"><Label>Acompte (Ar)</Label><Input type="number" min={0} value={deposit} onChange={(e) => setDeposit(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Mode de paiement</Label>
              <Select value={method} onChange={(e) => setMethod(e.target.value as any)}>{HOTEL_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{HOTEL_PAYMENT_LABELS[m]}</option>)}</Select></div>
            <div className="space-y-1.5 sm:col-span-3"><Label>Besoin / observation</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          </section>

          <dl className="num grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-muted/60 p-3 text-sm sm:grid-cols-4">
            <div><dt className="text-muted-foreground">Hébergement</dt><dd className="font-semibold">{money(lodging)}</dd></div>
            <div><dt className="text-muted-foreground">Suppléments{tax ? ' + taxe' : ''}</dt><dd className="font-semibold">{money(extrasTotal + tax)}</dd></div>
            <div><dt className="text-muted-foreground">Remise</dt><dd className="font-semibold">- {money(discount)}</dd></div>
            <div><dt className="text-muted-foreground">Net séjour</dt><dd className="font-display text-lg font-semibold">{money(net)}</dd></div>
          </dl>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Enregistrement…' : 'Créer la réservation'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
