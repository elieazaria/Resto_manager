import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { StockRowDto } from '@resto/shared';
import { stockAdjustSchema } from '@resto/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/DataTable';
import { FormDialog } from '@/components/CrudPage';
import { PageHeader } from '@/components/PageHeader';
import { api } from '@/lib/api';
import { fmtDateTime, fmtQty } from '@/lib/format';
import { cn, errorMessage } from '@/lib/utils';

interface Movement { id: string; created_at: string; qty: number; reason: string; note: string | null; stock_item_name: string; unit: string; user_name: string | null }
const REASONS: Record<string, string> = { purchase: 'Achat', sale: 'Vente', void: 'Annulation de vente', adjustment: 'Inventaire' };

export default function StockPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'levels' | 'moves'>('levels');
  const [onlyLow, setOnlyLow] = useState(false);
  const [adjusting, setAdjusting] = useState<StockRowDto | null>(null);
  const stock = useQuery({ queryKey: ['stock'], queryFn: () => api<StockRowDto[]>('/stock') });
  const moves = useQuery({ queryKey: ['stock', 'moves'], queryFn: () => api<Movement[]>('/stock/movements?limit=300'), enabled: tab === 'moves' });
  const lowCount = (stock.data ?? []).filter((s) => s.low).length;
  const rows = (stock.data ?? []).filter((s) => !onlyLow || s.low);

  const adjust = useMutation({
    mutationFn: (v: Record<string, any>) => api('/stock/adjust', { method: 'POST', body: v }),
    onSuccess: () => { toast.success('Inventaire enregistré'); setAdjusting(null); void qc.invalidateQueries({ queryKey: ['stock'] }); void qc.invalidateQueries({ queryKey: ['dashboard'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Niveaux de stock" description="Calculé en direct : achats, ventes (via les recettes) et inventaires."
        actions={<Badge tone={lowCount ? 'warn' : 'ok'}>{lowCount ? `${lowCount} à commander` : 'Tout est en stock'}</Badge>} />
      <div className="flex gap-2" role="tablist">
        {([['levels', 'Niveaux'], ['moves', 'Mouvements']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn('h-10 rounded-md px-4 text-sm font-medium', tab === k ? 'bg-ink text-ink-foreground' : 'bg-muted text-muted-foreground')}>{l}</button>
        ))}
      </div>

      {tab === 'levels' ? (
        <DataTable<StockRowDto>
          data={rows} loading={stock.isLoading} pageSize={20} searchPlaceholder="Rechercher un article…"
          toolbar={<label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> À commander seulement</label>}
          columns={[
            { accessorKey: 'name', header: 'Article' },
            { accessorKey: 'kind', header: 'Type', cell: ({ getValue }) => (getValue() === 'ingredient' ? 'Ingrédient' : 'Produit') },
            { accessorKey: 'qty', header: 'En stock', cell: ({ row: { original: r } }) => <span className={cn('num font-medium', r.qty < 0 && 'text-destructive')}>{fmtQty(r.qty)} {r.unit}</span> },
            { accessorKey: 'min_qty', header: 'Seuil', cell: ({ row: { original: r } }) => <span className="num text-muted-foreground">{fmtQty(r.min_qty)} {r.unit}</span> },
            { accessorKey: 'low', header: 'État', cell: ({ getValue }) => (getValue() ? <Badge tone="warn">À commander</Badge> : <Badge tone="ok">OK</Badge>) },
            { id: 'a', header: '', enableSorting: false, cell: ({ row }) => <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => setAdjusting(row.original)}><ClipboardCheck /> Inventaire</Button></div> },
          ]}
        />
      ) : (
        <DataTable<Movement>
          data={moves.data ?? []} loading={moves.isLoading} pageSize={20} searchPlaceholder="Rechercher un mouvement…"
          columns={[
            { accessorKey: 'created_at', header: 'Date', cell: ({ getValue }) => <span className="num">{fmtDateTime(getValue<string>())}</span> },
            { accessorKey: 'stock_item_name', header: 'Article' },
            { accessorKey: 'reason', header: 'Motif', cell: ({ getValue }) => REASONS[getValue<string>()] ?? getValue() },
            { accessorKey: 'qty', header: 'Quantité', cell: ({ row: { original: r } }) => <span className={cn('num font-medium', r.qty < 0 ? 'text-destructive' : 'text-primary')}>{r.qty > 0 ? '+' : ''}{fmtQty(r.qty)} {r.unit}</span> },
            { accessorKey: 'user_name', header: 'Par' },
          ]}
        />
      )}

      {adjusting && (
        <FormDialog
          open onOpenChange={(o) => !o && setAdjusting(null)} key={adjusting.id}
          title={`Inventaire : ${adjusting.name}`}
          description={`Stock calculé : ${fmtQty(adjusting.qty)} ${adjusting.unit}. Saisissez la quantité réellement comptée.`}
          fields={[{ name: 'counted', label: `Quantité comptée (${adjusting.unit})`, type: 'number' }, { name: 'note', label: 'Note', type: 'text', nullable: true }]}
          schema={stockAdjustSchema.omit({ stock_item_id: true })}
          defaults={{ counted: adjusting.qty, note: '' }}
          submitLabel="Enregistrer l'inventaire"
          onSubmit={async (v) => { await adjust.mutateAsync({ ...v, stock_item_id: adjusting.id }).catch(() => {}); }}
        />
      )}
    </div>
  );
}
