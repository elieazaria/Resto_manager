import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { HOTEL_PAYMENT_LABELS, HOTEL_PAYMENT_METHODS, type HotelPaymentMethod, type HotelWalkinDto } from '@resto/shared';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { NumberField } from '@/components/ui/number-field';
import { api } from '@/lib/api';
import { fmtDate, money } from '@/lib/format';
import { errorMessage } from '@/lib/utils';

interface Svc { id: string; name: string; unit_price: number; is_active: boolean; walk_in: boolean }
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export default function WalkinsPage() {
  const qc = useQueryClient();
  const [day, setDay] = useState(iso(new Date()));
  const [svcId, setSvcId] = useState<string>('');
  const [label, setLabel] = useState('');
  const [price, setPrice] = useState(0);
  const [qty, setQty] = useState(1);
  const [method, setMethod] = useState<HotelPaymentMethod>('cash');
  const [customer, setCustomer] = useState('');

  const services = useQuery({ queryKey: ['hotel', 'services'], queryFn: () => api<Svc[]>('/hotel/services') });
  const list = useQuery({ queryKey: ['hotel', 'walkins', day], queryFn: () => api<HotelWalkinDto[]>(`/hotel/walkins?from=${day}&to=${day}`) });
  const choices = (services.data ?? []).filter((s) => s.is_active && s.walk_in);
  const total = (list.data ?? []).reduce((s, w) => s + w.amount, 0);
  const pick = (s: Svc) => { setSvcId(s.id); setLabel(s.name); setPrice(s.unit_price); setQty(1); };

  const add = useMutation({
    mutationFn: () => api('/hotel/walkins', { method: 'POST', body: { service_id: svcId || null, label: label.trim(), unit_price: price, quantity: qty, method, sold_on: day, customer: customer.trim() || undefined } }),
    onSuccess: () => { toast.success('Vente enregistrée'); setQty(1); setCustomer(''); void qc.invalidateQueries({ queryKey: ['hotel'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/hotel/walkins/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['hotel'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Ventes sur place" description="Entrée piscine et autres services payés par des personnes qui ne logent pas à l’hôtel." />
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          {choices.map((s) => <Button key={s.id} variant={svcId === s.id ? 'default' : 'outline'} onClick={() => pick(s)}>{s.name} · {money(s.unit_price)}</Button>)}
          <Button variant="outline" onClick={() => { setSvcId(''); setLabel('Autre'); setPrice(0); setQty(1); }}><Plus /> Autre</Button>
        </div>
        {choices.length === 0 && <p className="text-sm text-muted-foreground">Aucun service « vente sur place ». Cochez cette option dans Suppléments.</p>}
        {label && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-6 sm:items-end">
            <div className="space-y-1 sm:col-span-2"><Label>Libellé</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} /></div>
            <div className="space-y-1"><Label>Personnes / quantité</Label><NumberField min={1} max={999} value={qty} onChange={setQty} aria-label="Quantité" /></div>
            <div className="space-y-1"><Label>Prix unitaire (Ar)</Label><NumberField stepper={false} min={0} value={price} onChange={setPrice} aria-label="Prix unitaire" /></div>
            <div className="space-y-1"><Label>Paiement</Label><Select value={method} onChange={(e) => setMethod(e.target.value as HotelPaymentMethod)}>{HOTEL_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{HOTEL_PAYMENT_LABELS[m]}</option>)}</Select></div>
            <div className="space-y-1"><Label>Nom (facultatif)</Label><Input value={customer} onChange={(e) => setCustomer(e.target.value)} /></div>
            <div className="sm:col-span-6 flex items-center justify-between gap-3">
              <p className="num font-display text-lg font-semibold">Total : {money(qty * price)}</p>
              <Button onClick={() => add.mutate()} disabled={add.isPending || !label.trim()}>Encaisser</Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div className="space-y-1"><Label>Jour</Label><Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></div>
          <p className="num font-display text-xl font-semibold">{money(total)}</p>
        </div>
        {(list.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Aucune vente le {fmtDate(day)}.</p> : (
          <ul className="divide-y divide-border text-sm">
            {list.data!.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-2 py-2">
                <span>{w.label} × {w.quantity} · {HOTEL_PAYMENT_LABELS[w.method]}{w.customer ? ` · ${w.customer}` : ''}</span>
                <span className="num flex items-center gap-1 font-medium">{money(w.amount)}
                  <Button size="icon" variant="ghost" aria-label="Supprimer" onClick={() => window.confirm('Supprimer cette vente ?') && del.mutate(w.id)}><Trash2 /></Button></span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
