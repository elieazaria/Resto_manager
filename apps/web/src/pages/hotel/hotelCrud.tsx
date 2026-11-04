import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileDown, ReceiptText } from 'lucide-react';
import {
  CHARGE_MODE_LABELS, CHARGE_MODES, RATE_MODE_LABELS, RATE_MODES, ROOM_TECH_LABELS, ROOM_TECH_STATUSES, WEEKDAY_LABELS,
  hotelClientSchema, hotelServiceSchema, rateRuleSchema, roomSchema, roomTypeSchema, HOTEL_STATUS_LABELS,
  type HotelReservationDto, type HotelSettings,
} from '@resto/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { CrudPage, type CrudConfig } from '@/components/CrudPage';
import { ReservationDetail } from '@/components/hotel/ReservationDetail';
import { api } from '@/lib/api';
import { activeCol, dateCol, moneyCol, textCol } from '@/lib/columns';
import { fmtDate, money } from '@/lib/format';
import { PAY_LABEL, PAY_TONE } from '@/lib/hotel';
import { pdfStatement } from '@/lib/pdf';

const opt = <T extends string>(values: readonly T[], labels: Record<T, string>) => values.map((v) => ({ value: v, label: labels[v] }));
const NUM = { type: 'number', step: '1', inputMode: 'numeric' } as const;

export function RoomTypesPage() {
  const cfg: CrudConfig<any> = {
    title: 'Types de chambres', singular: 'Type', endpoint: '/hotel/room-types', queryKey: 'hotel-room-types', invalidates: ['hotel'],
    description: 'Catégories du planning (Chambre, Bungalow, Suite…) avec tarif de base et couleur.',
    columns: [textCol('name', 'Nom'), { accessorKey: 'color', header: 'Couleur', cell: ({ getValue }) => <i className="inline-block size-4 rounded" style={{ background: getValue<string>() }} /> }, moneyCol('base_price', 'Tarif / nuit'), textCol('capacity', 'Capacité'), textCol('room_count', 'Chambres')],
    fields: [
      { name: 'name', label: 'Nom', type: 'text' }, { name: 'color', label: 'Couleur (#rrggbb)', type: 'text', placeholder: '#3b82f6' },
      { name: 'base_price', label: 'Tarif de base par nuit (Ar)', ...NUM }, { name: 'capacity', label: 'Capacité (personnes)', ...NUM }, { name: 'sort_order', label: 'Ordre', ...NUM },
    ],
    schema: roomTypeSchema, defaults: { name: '', color: '#3b82f6', base_price: 150000, capacity: 2, sort_order: 0 },
  };
  return <CrudPage cfg={cfg} />;
}

export function RoomsAdminPage() {
  const cfg: CrudConfig<any> = {
    title: 'Chambres (gestion)', singular: 'Chambre', endpoint: '/hotel/rooms', queryKey: 'hotel-rooms-admin', invalidates: ['hotel'], canDelete: true,
    description: 'Numéro, type, tarif et état technique. Un tarif vide reprend celui du type.',
    columns: [textCol('number', 'Numéro'), textCol('type_name', 'Type'), textCol('capacity', 'Capacité'), moneyCol('effective_price', 'Tarif / nuit'),
      { accessorKey: 'tech_status', header: 'État technique', cell: ({ getValue }) => <Badge tone={getValue() === 'normal' ? 'ok' : 'warn'}>{ROOM_TECH_LABELS[getValue<any>() as keyof typeof ROOM_TECH_LABELS]}</Badge> }, activeCol()],
    fields: [
      { name: 'number', label: 'Numéro / nom', type: 'text' },
      { name: 'room_type_id', label: 'Type', type: 'select', optionsFrom: { endpoint: '/hotel/room-types', label: (r) => r.name } },
      { name: 'price', label: 'Tarif spécifique (Ar, facultatif)', nullable: true, ...NUM },
      { name: 'capacity', label: 'Capacité (facultatif)', nullable: true, ...NUM },
      { name: 'tech_status', label: 'État technique', type: 'select', options: opt(ROOM_TECH_STATUSES, ROOM_TECH_LABELS) },
      { name: 'sort_order', label: 'Ordre', ...NUM }, { name: 'notes', label: 'Notes', type: 'text', nullable: true, span: 2 }, { name: 'is_active', label: 'Active', type: 'checkbox' },
    ],
    schema: roomSchema, defaults: { number: '', room_type_id: '', price: null, capacity: null, tech_status: 'normal', sort_order: 0, notes: null, is_active: true },
    toForm: (r) => ({ number: r.number, room_type_id: r.room_type_id, price: r.price ?? null, capacity: r.capacity ?? null, tech_status: r.tech_status, sort_order: r.sort_order, notes: r.notes, is_active: r.is_active }),
  };
  return <CrudPage cfg={cfg} />;
}

export function HotelServicesPage() {
  const cfg: CrudConfig<any> = {
    title: 'Suppléments et services', singular: 'Supplément', endpoint: '/hotel/services', queryKey: 'hotel-services', invalidates: ['hotel'],
    description: 'Matelas, location cuisine… proposés lors de la réservation (quantité saisie à la commande).',
    columns: [textCol('name', 'Nom'), moneyCol('unit_price', 'Prix unitaire'), { accessorKey: 'charge_mode', header: 'Facturation', cell: ({ getValue }) => CHARGE_MODE_LABELS[getValue<'flat'>()] }, activeCol()],
    fields: [
      { name: 'name', label: 'Nom', type: 'text' }, { name: 'unit_price', label: 'Prix unitaire (Ar)', ...NUM },
      { name: 'charge_mode', label: 'Facturation', type: 'select', options: opt(CHARGE_MODES, CHARGE_MODE_LABELS) },
      { name: 'walk_in', label: 'Vente sur place pour clients externes (ex. piscine)', type: 'checkbox' },
      { name: 'sort_order', label: 'Ordre', ...NUM }, { name: 'is_active', label: 'Actif', type: 'checkbox' },
    ],
    schema: hotelServiceSchema, defaults: { name: '', unit_price: 0, charge_mode: 'flat', walk_in: false, sort_order: 0, is_active: true },
  };
  return <CrudPage cfg={cfg} />;
}

export function RateRulesPage() {
  const cfg: CrudConfig<any> = {
    title: 'Tarifs dynamiques', singular: 'Règle', endpoint: '/hotel/rate-rules', queryKey: 'hotel-rate-rules', invalidates: ['hotel'],
    description: 'Haute saison, week-end, fêtes… La règle de plus haute priorité s’applique nuit par nuit ; le prix reste modifiable à la réservation.',
    columns: [textCol('name', 'Nom'), textCol('room_type_name', 'Type'), dateCol('date_from', 'Du'), dateCol('date_to', 'Au'),
      { accessorKey: 'value', header: 'Valeur', cell: ({ row: { original: r } }) => <span className="num">{r.mode === 'percent' ? `${r.value > 0 ? '+' : ''}${r.value} %` : money(r.value)}</span> },
      { accessorKey: 'weekdays', header: 'Jours', cell: ({ getValue }) => (getValue<number[] | null>()?.length ? getValue<number[]>().map((d) => WEEKDAY_LABELS[d]).join(' ') : 'Tous') },
      textCol('priority', 'Priorité'), activeCol()],
    fields: [
      { name: 'name', label: 'Nom', type: 'text', span: 2 },
      { name: 'room_type_id', label: 'Type de chambre', type: 'select', nullable: true, optionsFrom: { endpoint: '/hotel/room-types', label: (r) => r.name }, help: 'Vide = tous les types' },
      { name: 'mode', label: 'Mode', type: 'select', options: opt(RATE_MODES, RATE_MODE_LABELS) },
      { name: 'value', label: 'Valeur (Ar ou %)', ...NUM }, { name: 'priority', label: 'Priorité', ...NUM },
      { name: 'date_from', label: 'Du', type: 'date' }, { name: 'date_to', label: 'Au', type: 'date' },
      { name: 'weekdays_text', label: 'Jours (0=dim … 6=sam)', type: 'text', placeholder: '5,6', help: 'Vide = tous les jours' },
      { name: 'is_active', label: 'Active', type: 'checkbox' },
    ],
    schema: rateRuleSchema, defaults: { name: '', room_type_id: null, mode: 'percent', value: 10, priority: 0, date_from: '', date_to: '', weekdays_text: '', is_active: true },
    toForm: (r) => ({ ...r, weekdays_text: (r.weekdays ?? []).join(',') }),
    transform: (v) => {
      const { weekdays_text, ...rest } = v;
      return { ...rest, weekdays: String(weekdays_text ?? '').split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => n >= 0 && n <= 6) };
    },
  };
  return <CrudPage cfg={cfg} />;
}

export function HotelClientsPage() {
  const [account, setAccount] = useState<any | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const cfg: CrudConfig<any> = {
    title: 'Clients de l’hôtel', singular: 'Client', endpoint: '/hotel/clients', queryKey: 'hotel-clients', invalidates: ['hotel'], searchPlaceholder: 'Rechercher un client…',
    description: 'Fiches clients et comptes : séjours, suppléments, paiements et solde.',
    columns: [textCol('full_name', 'Nom'), textCol('phone', 'Téléphone'), textCol('email', 'E-mail'), textCol('reservation_count', 'Séjours')],
    fields: [
      { name: 'full_name', label: 'Nom complet', type: 'text', span: 2 }, { name: 'phone', label: 'Téléphone', type: 'text', nullable: true, inputMode: 'tel' }, { name: 'email', label: 'E-mail', type: 'text', nullable: true },
      { name: 'id_document', label: 'CIN / passeport', type: 'text', nullable: true }, { name: 'address', label: 'Adresse', type: 'text', nullable: true }, { name: 'notes', label: 'Notes', type: 'text', nullable: true, span: 2 },
    ],
    schema: hotelClientSchema, defaults: { full_name: '', phone: null, email: null, id_document: null, address: null, notes: null },
    toForm: (r) => ({ full_name: r.full_name, phone: r.phone, email: r.email, id_document: r.id_document, address: r.address, notes: r.notes }),
    rowActions: (r) => <Button size="sm" variant="outline" onClick={() => setAccount(r)}><ReceiptText /> Compte</Button>,
  };
  return (
    <>
      <CrudPage cfg={cfg} />
      <AccountDialog client={account} onClose={() => setAccount(null)} onOpen={(id) => setDetail(id)} />
      <ReservationDetail id={detail} onClose={() => setDetail(null)} />
    </>
  );
}

function AccountDialog({ client, onClose, onOpen }: { client: any | null; onClose: () => void; onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ['hotel', 'account', client?.id], queryFn: () => api<{ reservations: HotelReservationDto[]; totals: { billed: number; paid: number; balance: number } }>(`/hotel/clients/${client.id}/account`), enabled: !!client });
  const settings = useQuery({ queryKey: ['hotel', 'settings'], queryFn: () => api<HotelSettings>('/hotel/settings'), enabled: !!client });
  const a = q.data;
  return (
    <Dialog open={!!client} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader title={`Compte de ${client?.full_name ?? ''}`} description={client?.phone ?? undefined} />
        <DialogBody className="space-y-4">
          {!a ? <p className="text-muted-foreground">Chargement…</p> : (<>
            <dl className="num grid grid-cols-3 gap-3 rounded-lg bg-muted/60 p-3 text-sm">
              <div><dt className="text-muted-foreground">Facturé</dt><dd className="font-semibold">{money(a.totals.billed)}</dd></div>
              <div><dt className="text-muted-foreground">Payé</dt><dd className="font-semibold">{money(a.totals.paid)}</dd></div>
              <div><dt className="text-muted-foreground">Solde dû</dt><dd className="font-semibold text-destructive">{money(a.totals.balance)}</dd></div>
            </dl>
            <ul className="divide-y divide-border text-sm">
              {a.reservations.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <button className="text-left hover:underline" onClick={() => onOpen(r.id)}><b className="num">{r.ref}</b><br /><span className="text-muted-foreground">Ch. {r.room_number} · {fmtDate(r.arrival)} → {fmtDate(r.departure)} · {HOTEL_STATUS_LABELS[r.status]}</span></button>
                  <span className="num text-right">{money(r.net_amount)}<br /><Badge tone={PAY_TONE[r.pay_status]}>{PAY_LABEL[r.pay_status]}</Badge></span>
                </li>
              ))}
              {!a.reservations.length && <li className="py-4 text-center text-muted-foreground">Aucun séjour.</li>}
            </ul>
            <Button variant="outline" disabled={!settings.data || !a.reservations.length} onClick={() => settings.data && pdfStatement(client.full_name, a.reservations, settings.data)}><FileDown /> Relevé de compte PDF</Button>
          </>)}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
