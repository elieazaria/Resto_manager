import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DEFAULT_SETTINGS, PAPER_WIDTHS, settingsSchema, type OrderDto, type Settings } from '@resto/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { Ticket } from '@/components/PrintHost';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/utils';

const demo: OrderDto = {
  id: 'demo', ticket_no: 128, table_id: 't', table_name: 'Table 4', status: 'paid', note: null, total: 27000, payment_method: 'cash', amount_received: 30000,
  business_date: null, created_at: new Date().toISOString(), paid_at: new Date().toISOString(), opened_by_name: 'Rina', paid_by_name: 'Rina', void_reason: null,
  lines: [
    { id: '1', menu_item_id: 'a', name: 'Poulet au coco', unit_price: 12000, quantity: 2, note: null },
    { id: '2', menu_item_id: 'b', name: 'Coca-Cola 33 cl', unit_price: 3000, quantity: 1, note: null },
  ],
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') });
  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<Settings>({ resolver: zodResolver(settingsSchema) as any, defaultValues: DEFAULT_SETTINGS });
  useEffect(() => { if (settings.data) reset(settings.data); }, [settings.data, reset]);
  const live = watch();

  const save = handleSubmit(async (v) => {
    try {
      await api('/settings', { method: 'PUT', body: { ...v, paper_width: Number(v.paper_width) } });
      await qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Réglages enregistrés');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Restaurant et ticket" description="Ces informations apparaissent en haut et en bas de chaque ticket." />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader><CardTitle>Informations</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="restaurant_name">Nom du restaurant</Label><Input id="restaurant_name" {...register('restaurant_name')} />{errors.restaurant_name && <p className="text-xs text-destructive">{errors.restaurant_name.message}</p>}</div>
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="address">Adresse</Label><Input id="address" {...register('address')} /></div>
              <div className="space-y-1.5"><Label htmlFor="phone">Téléphone</Label><Input id="phone" inputMode="tel" {...register('phone')} /></div>
              <div className="space-y-1.5">
                <Label htmlFor="paper_width">Largeur du papier</Label>
                <Select id="paper_width" {...register('paper_width', { valueAsNumber: true })}>
                  {PAPER_WIDTHS.map((w) => <option key={w} value={w}>{w === 32 ? '58 mm (32 colonnes)' : w === 42 ? '80 mm (42 colonnes)' : '80 mm (48 colonnes)'}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="ticket_footer">Message de fin de ticket</Label><Input id="ticket_footer" {...register('ticket_footer')} /></div>
              <div className="sm:col-span-2"><Button type="submit" disabled={isSubmitting}>Enregistrer</Button></div>
            </form>
          </CardContent>
        </Card>
        <Card className="self-start">
          <CardHeader><CardTitle>Aperçu du ticket</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border border-dashed border-input bg-white p-2">
              <Ticket order={demo} settings={{ ...DEFAULT_SETTINGS, ...live, paper_width: Number(live.paper_width) as 32 | 42 | 48 }} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
