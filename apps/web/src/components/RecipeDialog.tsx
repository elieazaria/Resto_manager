import { useEffect } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { z } from 'zod';
import { recipeSchema } from '@resto/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/utils';

type RecipeForm = z.infer<typeof recipeSchema>;
interface StockItem { id: string; name: string; unit: string; kind: string; is_active: boolean }

/** Composition d'un plat : chaque vente décompte ces quantités du stock. */
export function RecipeDialog({ item, onClose }: { item: { id: string; name: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const stock = useQuery({ queryKey: ['options', '/stock-items'], queryFn: () => api<StockItem[]>('/stock-items') });
  const recipe = useQuery({ queryKey: ['recipe', item.id], queryFn: () => api<{ lines: { stock_item_id: string; qty_per_portion: number }[] }>(`/menu-items/${item.id}/recipe`) });
  const { control, register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<RecipeForm>({
    resolver: zodResolver(recipeSchema), defaultValues: { lines: [] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  useEffect(() => { if (recipe.data) reset({ lines: recipe.data.lines }); }, [recipe.data, reset]);

  const ingredients = (stock.data ?? []).filter((s) => s.kind === 'ingredient' && s.is_active);
  const unitOf = (id: string) => stock.data?.find((s) => s.id === id)?.unit ?? '';

  const save = handleSubmit(async (v) => {
    try {
      await api(`/menu-items/${item.id}/recipe`, { method: 'PUT', body: v });
      toast.success('Recette enregistrée');
      void qc.invalidateQueries({ queryKey: ['menu-items'] });
      void qc.invalidateQueries({ queryKey: ['recipe', item.id] });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader title={`Recette : ${item.name}`} description="Quantité d'ingrédient consommée pour une portion." />
          <DialogBody className="space-y-2">
            {fields.map((f, i) => (
              <div key={f.id} className="grid grid-cols-[1fr_7rem_auto] items-start gap-2">
                <div>
                  <Select aria-label="Ingrédient" aria-invalid={!!errors.lines?.[i]?.stock_item_id} {...register(`lines.${i}.stock_item_id`)}>
                    <option value="">— Ingrédient —</option>
                    {ingredients.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </div>
                <div>
                  <Input type="number" step="any" inputMode="decimal" aria-label="Quantité par portion" aria-invalid={!!errors.lines?.[i]?.qty_per_portion} {...register(`lines.${i}.qty_per_portion`, { valueAsNumber: true })} />
                  <p className="mt-0.5 text-xs text-muted-foreground">{unitOf(fields[i]?.stock_item_id ?? '')}</p>
                </div>
                <Button variant="ghost" size="icon" aria-label="Retirer" onClick={() => remove(i)}><Trash2 className="text-destructive" /></Button>
              </div>
            ))}
            {!fields.length && <p className="rounded-md bg-muted/60 p-4 text-sm text-muted-foreground">Aucun ingrédient : ce plat ne décompte rien du stock.</p>}
            {(errors.lines?.message || errors.lines?.root?.message) && <p className="text-sm text-destructive">{errors.lines?.message ?? errors.lines?.root?.message}</p>}
            <Button variant="outline" onClick={() => append({ stock_item_id: '', qty_per_portion: 100 })}><Plus /> Ajouter un ingrédient</Button>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Annuler</Button>
            <Button type="submit" disabled={isSubmitting || recipe.isLoading}>Enregistrer la recette</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
