import { useState } from 'react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, type OrderDto, type Settings } from '@resto/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Label, Select } from '@/components/ui/input';
import { api } from '@/lib/api';
import { getPrefs, printTicket, setPrefs, type PrintMode } from '@/lib/print';

const sample = (): OrderDto => ({
  id: 'test', ticket_no: 0, table_id: 't', table_name: 'Table 1', status: 'paid', note: null, total: 27000,
  payment_method: 'cash', amount_received: 30000, business_date: null, created_at: new Date().toISOString(),
  paid_at: new Date().toISOString(), opened_by_name: 'Test', paid_by_name: 'Test', void_reason: null,
  lines: [
    { id: '1', menu_item_id: 'a', name: 'Poulet au coco', unit_price: 12000, quantity: 2, note: null },
    { id: '2', menu_item_id: 'b', name: 'Coca-Cola 33 cl', unit_price: 3000, quantity: 1, note: 'bien frais' },
  ],
});

/** Réglages propres à CET appareil (la caisse peut être une tablette, le gérant un téléphone…). */
export function DeviceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [prefs, setLocal] = useState(getPrefs);
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') });
  const update = (p: Partial<typeof prefs>) => {
    setPrefs(p);
    setLocal({ ...prefs, ...p });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader title="Impression sur cet appareil" description="Ces réglages ne concernent que cet appareil." />
        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mode">Mode d'impression</Label>
            <Select id="mode" value={prefs.mode} onChange={(e) => update({ mode: e.target.value as PrintMode })}>
              <option value="browser">Navigateur (imprimante installée sur l'appareil)</option>
              <option value="rawbt">Application RawBT (Android, imprimante Bluetooth/USB)</option>
            </Select>
            <p className="text-xs text-muted-foreground">
              {prefs.mode === 'rawbt'
                ? 'Installez RawBT sur la tablette et choisissez votre imprimante thermique dans RawBT : les tickets partent sans boîte de dialogue.'
                : "Pour imprimer sans confirmation sur PC, lancez Chrome avec l'option --kiosk-printing."}
            </p>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={prefs.autoPrint} onChange={(e) => update({ autoPrint: e.target.checked })} />
            Imprimer le ticket automatiquement après l'encaissement
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => { printTicket(sample(), settings.data ?? DEFAULT_SETTINGS); toast.info('Ticket de test envoyé'); }}>
            Imprimer un ticket de test
          </Button>
          <Button onClick={() => onOpenChange(false)}>Terminé</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
