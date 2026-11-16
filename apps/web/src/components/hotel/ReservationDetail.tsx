import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, LogIn, LogOut, Plus, Trash2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { HOTEL_PAYMENT_LABELS, HOTEL_PAYMENT_METHODS, HOTEL_STATUS_LABELS, type HotelPaymentMethod, type HotelReservationDto, type HotelSettings } from '@resto/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { TimeField24 } from '@/components/ui/time-field';
import { NumberField } from '@/components/ui/number-field';
import { api } from '@/lib/api';
import { fmtDate, money } from '@/lib/format';
import { PAY_LABEL, PAY_TONE, STATUS_COLOR } from '@/lib/hotel';
import { pdfInvoice } from '@/lib/pdf';
import { errorMessage } from '@/lib/utils';

export function ReservationDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hotel', 'reservation', id], queryFn: () => api<HotelReservationDto>(`/hotel/reservations/${id}`), enabled: !!id });
  const settings = useQuery({ queryKey: ['hotel', 'settings'], queryFn: () => api<HotelSettings>('/hotel/settings'), enabled: !!id });
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<HotelPaymentMethod>('cash');
  const [kind, setKind] = useState<'payment' | 'refund'>('payment');
  const services = useQuery({ queryKey: ['hotel', 'services'], queryFn: () => api<{ id: string; name: string; unit_price: number; charge_mode: 'flat' | 'per_night'; is_active: boolean; walk_in?: boolean }[]>('/hotel/services'), enabled: !!id });
  const [sLabel, setSLabel] = useState('');
  const [sPrice, setSPrice] = useState(0);
  const [sQty, setSQty] = useState(1);
  const [sSvc, setSSvc] = useState<{ id: string | null; perNight: boolean }>({ id: null, perNight: false });
  const r = q.data;
  const grp = useQuery({ queryKey: ['hotel', 'group', r?.group_id], queryFn: () => api<{ reservations: HotelReservationDto[]; totals: { billed: number; paid: number; balance: number; surplus: number } }>(`/hotel/groups/${r!.group_id}`), enabled: !!r?.group_id });
  const [gAmount, setGAmount] = useState('');
  const [gMethod, setGMethod] = useState<HotelPaymentMethod>('cash');
  const payGroup = () => {
    const n = Math.round(Number(gAmount));
    if (!n || n <= 0) return toast.error('Montant invalide');
    run.mutate(async () => { await api(`/hotel/groups/${r!.group_id}/payments`, { method: 'POST', body: { amount: n, method: gMethod, kind: 'payment' } }); setGAmount(''); toast.success('Paiement réparti sur les chambres du groupe'); });
  };
  const [times, setTimes] = useState<{ cin: string; cout: string } | null>(null);
  const cinEff = r?.checkin_time ?? settings.data?.checkin_time ?? '14:00';
  const coutEff = r?.checkout_time ?? settings.data?.checkout_time ?? '12:00';
  const saveTimes = () => times && run.mutate(async () => { await api(`/hotel/reservations/${id}`, { method: 'PATCH', body: { checkin_time: times.cin, checkout_time: times.cout } }); setTimes(null); toast.success('Heures enregistrées'); });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['hotel'] }); };

  const run = useMutation({
    mutationFn: (f: () => Promise<unknown>) => f(),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setStatus = (status: string, reason?: string) => run.mutate(() => api(`/hotel/reservations/${id}/status`, { method: 'POST', body: { status, reason } }));
  const cancel = () => {
    const reason = window.prompt('Motif de l’annulation ?');
    if (reason?.trim()) setStatus('cancelled', reason.trim());
  };
  const pickService = (sv: { id: string; name: string; unit_price: number; charge_mode: string }) => { setSLabel(sv.name); setSPrice(sv.unit_price); setSQty(1); setSSvc({ id: sv.id, perNight: sv.charge_mode === 'per_night' }); };
  const addSupplement = () => {
    if (!r) return;
    if (!sLabel.trim()) return toast.error('Choisissez ou saisissez un supplément');
    run.mutate(async () => {
      await api(`/hotel/reservations/${id}/extras`, { method: 'POST', body: { service_id: sSvc.id, label: sLabel.trim(), unit_price: sPrice, quantity: Math.max(1, sQty), multiplier: sSvc.perNight ? Math.max(1, r.nights) : 1 } });
      setSLabel(''); setSPrice(0); setSQty(1); setSSvc({ id: null, perNight: false });
      toast.success('Supplément ajouté à la facture');
    });
  };
  const pay = () => {
    const n = Math.round(Number(amount));
    if (!n || n <= 0) return toast.error('Montant invalide');
    run.mutate(async () => { await api(`/hotel/reservations/${id}/payments`, { method: 'POST', body: { amount: n, method, kind } }); setAmount(''); toast.success(kind === 'refund' ? 'Remboursement enregistré' : 'Paiement enregistré'); });
  };

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader title={r ? r.ref : 'Réservation'} description={r ? `${r.client_name} · chambre ${r.room_number}` : undefined} />
        <DialogBody className="space-y-5">
          {!r ? <p className="text-muted-foreground">Chargement…</p> : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full px-2.5 py-0.5 text-xs font-medium text-white" style={{ background: STATUS_COLOR[r.status] }}>{HOTEL_STATUS_LABELS[r.status]}</span>
                <Badge tone={PAY_TONE[r.pay_status]}>{PAY_LABEL[r.pay_status]}</Badge>
                {r.is_demo && <Badge>Démo</Badge>}
                {r.group_id && <Badge>Groupe</Badge>}
              </div>
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div><dt className="inline text-muted-foreground">Séjour : </dt><dd className="num inline">{fmtDate(r.arrival)} → {fmtDate(r.departure)} ({r.nights} nuit{r.nights > 1 ? 's' : ''})</dd></div>
                <div className="sm:col-span-2"><dt className="inline text-muted-foreground">Arrivée / départ : </dt>
                  {times ? (
                    <dd className="mt-1 flex flex-wrap items-center gap-2">
                      <TimeField24 className="w-36" value={times.cin} onChange={(v) => setTimes({ ...times, cin: v })} aria-label="Heure d’arrivée" />
                      <TimeField24 className="w-36" value={times.cout} onChange={(v) => setTimes({ ...times, cout: v })} aria-label="Heure de départ" />
                      <Button size="sm" onClick={saveTimes} disabled={run.isPending}>Enregistrer</Button>
                      <Button size="sm" variant="ghost" onClick={() => setTimes(null)}>Annuler</Button>
                    </dd>
                  ) : (
                    <dd className="num inline">{cinEff} → {coutEff}{r.status !== 'cancelled' && r.status !== 'checked_out' && <Button size="sm" variant="ghost" className="ml-1" onClick={() => setTimes({ cin: cinEff, cout: coutEff })}>Modifier</Button>}</dd>
                  )}</div>
                <div><dt className="inline text-muted-foreground">Personnes : </dt><dd className="inline">{r.adults} adulte(s), {r.children} enfant(s)</dd></div>
                <div><dt className="inline text-muted-foreground">Téléphone : </dt><dd className="inline">{r.client_phone ?? '—'}</dd></div>
                <div><dt className="inline text-muted-foreground">Type : </dt><dd className="inline">{r.room_type_name}</dd></div>
                {r.note && <div className="sm:col-span-2"><dt className="inline text-muted-foreground">Observation : </dt><dd className="inline">{r.note}</dd></div>}
                {r.cancel_reason && <div className="sm:col-span-2 text-destructive">Annulée : {r.cancel_reason}</div>}
              </dl>

              <table className="num w-full text-sm">
                <tbody className="divide-y divide-border">
                  <tr><td className="py-1.5">Hébergement ({r.nights} × {money(r.price_per_night)})</td><td className="text-right">{money(r.lodging_amount)}</td></tr>
                  {r.extras.map((e) => <tr key={e.id}><td className="py-1.5">{e.label} ({e.quantity}{e.multiplier > 1 ? ` × ${e.multiplier} nuits` : ''} × {money(e.unit_price)})</td><td className="text-right">{money(e.amount)}{r.status !== 'cancelled' && r.status !== 'checked_out' && <Button size="icon" variant="ghost" aria-label="Retirer le supplément" onClick={() => window.confirm('Retirer ce supplément ?') && run.mutate(() => api(`/hotel/reservations/${id}/extras/${e.id}`, { method: 'DELETE' }))}><Trash2 /></Button>}</td></tr>)}
                  {r.tourist_tax > 0 && <tr><td className="py-1.5">Taxe de séjour</td><td className="text-right">{money(r.tourist_tax)}</td></tr>}
                  {r.discount_amount > 0 && <tr><td className="py-1.5">Remise{r.discount_percent ? ` (${r.discount_percent} %)` : ''}</td><td className="text-right">- {money(r.discount_amount)}</td></tr>}
                  <tr className="font-semibold"><td className="py-1.5">Net séjour</td><td className="text-right">{money(r.net_amount)}</td></tr>
                  <tr><td className="py-1.5">Déjà payé</td><td className="text-right">{money(r.paid_amount)}</td></tr>
                  <tr className="font-display text-base font-semibold"><td className="py-1.5">Reste à payer</td><td className={`text-right ${r.balance > 0 ? 'text-destructive' : ''}`}>{money(Math.max(0, r.balance))}</td></tr>
                </tbody>
              </table>

              {r.group_id && grp.data && (
                <section className="rounded-lg border p-3" style={{ borderColor: 'color-mix(in srgb, var(--tone-violet) 35%, var(--border))', background: 'color-mix(in srgb, var(--tone-violet) 6%, var(--card))' }}>
                  <h3 className="mb-1 text-sm font-semibold">Réservation groupée · {grp.data.reservations.filter((x) => x.status !== 'cancelled').length} chambre(s)</h3>
                  <ul className="mb-2 divide-y divide-border text-sm">
                    {grp.data.reservations.map((x) => (
                      <li key={x.id} className={`flex justify-between gap-2 py-1 ${x.id === r.id ? 'font-medium' : ''}`}>
                        <span>Ch. {x.room_number}{x.status === 'cancelled' ? ' (annulée)' : ''}</span>
                        <span className="num">{money(x.net_amount)} · payé {money(x.paid_amount)}</span>
                      </li>
                    ))}
                  </ul>
                  <dl className="num grid grid-cols-3 gap-2 text-sm">
                    <div><dt className="text-muted-foreground">Total groupe</dt><dd className="font-semibold">{money(grp.data.totals.billed)}</dd></div>
                    <div><dt className="text-muted-foreground">Payé</dt><dd className="font-semibold">{money(grp.data.totals.paid)}</dd></div>
                    <div><dt className="text-muted-foreground">Reste</dt><dd className="font-semibold text-destructive">{money(grp.data.totals.balance)}</dd></div>
                  </dl>
                  {grp.data.totals.surplus > 0 && <p className="mt-2 text-xs text-destructive">Trop-perçu de {money(grp.data.totals.surplus)} : supprimez le paiement en double ou remboursez depuis la chambre concernée.</p>}
                  {grp.data.totals.balance > 0 && (
                    <div className="mt-3 grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <div className="space-y-1"><Label>Payer pour tout le groupe (Ar)</Label><NumberField stepper={false} min={0} value={Number(gAmount) || 0} onChange={(n) => setGAmount(String(n))} aria-label="Montant groupe" />
                        <button type="button" className="text-xs text-primary underline" onClick={() => setGAmount(String(grp.data!.totals.balance))}>Solde du groupe : {money(grp.data.totals.balance)}</button></div>
                      <div className="space-y-1"><Label>Mode</Label><Select value={gMethod} onChange={(e) => setGMethod(e.target.value as HotelPaymentMethod)}>{HOTEL_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{HOTEL_PAYMENT_LABELS[m]}</option>)}</Select></div>
                      <Button onClick={payGroup} disabled={run.isPending}>Encaisser</Button>
                    </div>
                  )}
                </section>
              )}

              {r.status !== 'cancelled' && r.status !== 'checked_out' && (
                <section className="rounded-lg border border-border p-3">
                  <h3 className="mb-1 text-sm font-semibold">Ajouter un supplément (sur place)</h3>
                  <p className="mb-2 text-xs text-muted-foreground">Le montant est ajouté au total de la facture.</p>
                  <div className="mb-2 flex flex-wrap gap-2">
                    {(services.data ?? []).filter((x) => x.is_active).map((x) => <Button key={x.id} size="sm" variant={sSvc.id === x.id ? 'default' : 'outline'} onClick={() => pickService(x)}>{x.name} · {money(x.unit_price)}</Button>)}
                    <Button size="sm" variant="outline" onClick={() => { setSLabel('Autre supplément'); setSPrice(0); setSQty(1); setSSvc({ id: null, perNight: false }); }}><Plus /> Autre</Button>
                  </div>
                  {sLabel && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
                      <div className="space-y-1"><Label>Libellé</Label><Input value={sLabel} onChange={(e) => setSLabel(e.target.value)} /></div>
                      <div className="space-y-1"><Label>Quantité</Label><NumberField min={1} max={999} value={sQty} onChange={setSQty} aria-label="Quantité" /></div>
                      <div className="space-y-1"><Label>Prix unitaire (Ar)</Label><NumberField stepper={false} min={0} value={sPrice} onChange={setSPrice} aria-label="Prix unitaire" /></div>
                      <Button onClick={addSupplement} disabled={run.isPending}><Plus /> Ajouter</Button>
                    </div>
                  )}
                  {sLabel && sSvc.perNight && <p className="mt-1 text-xs text-muted-foreground">Facturé par nuit : × {r.nights} nuit(s) = {money(sQty * sPrice * r.nights)}</p>}
                </section>
              )}

              <section>
                <h3 className="mb-1.5 text-sm font-semibold">Paiements</h3>
                {r.payments.length === 0 ? <p className="text-sm text-muted-foreground">Aucun paiement.</p> : (
                  <ul className="divide-y divide-border text-sm">
                    {r.payments.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                        <span>{fmtDate(p.paid_on)} · {p.kind === 'refund' ? 'Remboursement' : p.kind === 'deposit' ? 'Acompte' : 'Paiement'} · {HOTEL_PAYMENT_LABELS[p.method]}</span>
                        <span className="num flex items-center gap-1 font-medium">{money(p.amount)}
                          <Button size="icon" variant="ghost" aria-label="Supprimer le paiement" onClick={() => window.confirm('Supprimer ce paiement ?') && run.mutate(() => api(`/hotel/reservations/${id}/payments/${p.id}`, { method: 'DELETE' }))}><Trash2 /></Button></span>
                      </li>
                    ))}
                  </ul>
                )}
                {r.status !== 'cancelled' && (
                  <div className="mt-3 grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                    <div className="space-y-1"><Label>Montant (Ar)</Label><Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={r.balance > 0 ? String(r.balance) : ''} />{r.balance > 0 && <button type="button" className="text-xs text-primary underline" onClick={() => { setAmount(String(r.balance)); setKind('payment'); }}>Solde : {money(r.balance)}</button>}</div>
                    <div className="space-y-1"><Label>Mode</Label><Select value={method} onChange={(e) => setMethod(e.target.value as any)}>{HOTEL_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{HOTEL_PAYMENT_LABELS[m]}</option>)}</Select></div>
                    <div className="space-y-1"><Label>Type</Label><Select value={kind} onChange={(e) => setKind(e.target.value as any)}><option value="payment">Paiement</option><option value="refund">Remboursement</option></Select></div>
                    <Button onClick={pay} disabled={run.isPending}>Ajouter</Button>
                  </div>
                )}
              </section>
            </>
          )}
        </DialogBody>
        {r && (
          <DialogFooter className="justify-between">
            <Button variant="outline" onClick={() => settings.data && pdfInvoice(r, settings.data)}><FileText /> Facture PDF</Button>
            <div className="flex flex-wrap gap-2">
              {(r.status === 'option') && <Button variant="outline" onClick={() => setStatus('confirmed')}>Confirmer</Button>}
              {(r.status === 'option' || r.status === 'confirmed') && <Button onClick={() => setStatus('checked_in')}><LogIn /> Check-in</Button>}
              {r.status === 'checked_in' && <Button onClick={() => setStatus('checked_out')}><LogOut /> Check-out</Button>}
              {r.status === 'cancelled' && <Button variant="outline" onClick={() => setStatus('confirmed')}>Réactiver</Button>}
              {r.status !== 'cancelled' && r.status !== 'checked_out' && <Button variant="destructive" onClick={cancel}><XCircle /> Annuler</Button>}
              {r.status === 'cancelled' && <Button variant="ghost" onClick={() => window.confirm('Supprimer définitivement ?') && run.mutate(async () => { await api(`/hotel/reservations/${id}`, { method: 'DELETE' }); onClose(); })}><Trash2 /> Supprimer</Button>}
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
