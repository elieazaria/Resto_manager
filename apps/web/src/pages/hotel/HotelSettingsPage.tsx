import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_HOTEL_SETTINGS, type HotelSettings } from '@resto/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/utils';

export default function HotelSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hotel', 'settings'], queryFn: () => api<HotelSettings>('/hotel/settings') });
  const [s, setS] = useState<HotelSettings>(DEFAULT_HOTEL_SETTINGS);
  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);
  const set = <K extends keyof HotelSettings>(k: K, v: HotelSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const done = () => void qc.invalidateQueries({ queryKey: ['hotel'] });

  const save = useMutation({ mutationFn: () => api('/hotel/settings', { method: 'PUT', body: s }), onSuccess: () => { toast.success('Réglages enregistrés'); done(); }, onError: (e) => toast.error(errorMessage(e)) });
  const load = useMutation({ mutationFn: () => api<{ created: number }>('/hotel/demo', { method: 'POST' }), onSuccess: (r) => { toast.success(`Données démo mises à jour (${r.created} réservations)`); done(); }, onError: (e) => toast.error(errorMessage(e)) });
  const clear = useMutation({ mutationFn: () => api('/hotel/demo', { method: 'DELETE' }), onSuccess: () => { toast.success('Données démo supprimées'); done(); }, onError: (e) => toast.error(errorMessage(e)) });
  const boot = useMutation({ mutationFn: () => api('/hotel/bootstrap', { method: 'POST' }), onSuccess: () => { toast.success('Chambres, suppléments et tarifs d’exemple créés'); done(); }, onError: (e) => toast.error(errorMessage(e)) });

  const txt = (k: keyof HotelSettings, label: string, p: Record<string, unknown> = {}) => (
    <div className="space-y-1.5"><Label>{label}</Label><Input value={String(s[k] ?? '')} onChange={(e) => set(k, (p.type === 'number' ? Math.max(0, Math.round(Number(e.target.value) || 0)) : e.target.value) as any)} {...p} /></div>
  );
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Réglages de l’hôtel" description="Informations imprimées sur les factures, horaires, taxes et données d’essai." />
      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {txt('name', 'Nom de l’hôtel')} {txt('tax_id', 'NIF / STAT')}
          {txt('address', 'Adresse')} {txt('phone', 'Téléphone')} {txt('email', 'E-mail')}
          {txt('ref_prefix', 'Préfixe des réservations', { placeholder: 'HM-01' })}
          {txt('checkin_time', 'Heure d’arrivée', { type: 'time' })} {txt('checkout_time', 'Heure de départ', { type: 'time' })}
          {txt('tourist_tax_per_person_night', 'Taxe de séjour (Ar / personne / nuit)', { type: 'number' })}
          {txt('vat_percent', 'TVA incluse (%)', { type: 'number' })}
        </div>
        <div className="space-y-1.5"><Label>Pied de facture</Label><Textarea rows={2} value={s.invoice_footer} onChange={(e) => set('invoice_footer', e.target.value)} /></div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Enregistrer</Button>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-display text-lg font-semibold">Valeurs de démonstration (essai)</h2>
        <p className="text-sm text-muted-foreground">« Mettre à jour » recrée des réservations d’essai datées autour d’aujourd’hui (séjours en cours, arrivées, option, terminé, acomptes Mvola / Orange Money / Airtel Money…). Vos vraies réservations ne sont jamais touchées.</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => boot.mutate()} variant="outline" disabled={boot.isPending}>Créer chambres et tarifs d’exemple</Button>
          <Button onClick={() => load.mutate()} disabled={load.isPending}><RefreshCw /> {load.isPending ? 'Mise à jour…' : 'Mettre à jour les valeurs démo'}</Button>
          <Button variant="destructive" onClick={() => window.confirm('Supprimer toutes les réservations de démonstration ?') && clear.mutate()} disabled={clear.isPending}><Trash2 /> Effacer la démo</Button>
        </div>
      </Card>
    </div>
  );
}
