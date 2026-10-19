import { useMemo, useState, type ReactNode } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ZodType } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/utils';
import { DataTable } from './DataTable';
import { PageHeader } from './PageHeader';

export interface Option {
  value: string | number;
  label: string;
}
export interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'date' | 'password' | 'textarea';
  /** Options statiques, ou chargées depuis l'API. */
  options?: Option[];
  optionsFrom?: { endpoint: string; label: (row: any) => string; filter?: (row: any) => boolean };
  /** '' devient null (clé étrangère / texte facultatif). */
  nullable?: boolean;
  help?: string;
  step?: string;
  inputMode?: 'numeric' | 'decimal' | 'tel';
  autoComplete?: string;
  placeholder?: string;
  /** Champ masqué selon les autres valeurs du formulaire. */
  hideWhen?: (v: Record<string, any>) => boolean;
  span?: 2;
}

export interface CrudConfig<Row extends { id: string }> {
  title: string;
  singular: string;
  description?: string;
  endpoint: string;
  queryKey: string;
  columns: ColumnDef<Row, any>[];
  fields: FieldDef[];
  schema: ZodType<any>;
  /** Schéma à l'édition si différent (ex. mot de passe facultatif). */
  editSchema?: ZodType<any>;
  defaults: Record<string, unknown>;
  toForm?: (row: Row) => Record<string, unknown>;
  rowActions?: (row: Row) => ReactNode;
  /** Autres requêtes à rafraîchir après une écriture. */
  invalidates?: string[];
  canDelete?: boolean;
  searchPlaceholder?: string;
  extraToolbar?: ReactNode;
  /** Sens de la ligne éditée vers le serveur. */
  transform?: (values: Record<string, any>, isEdit: boolean) => Record<string, any>;
}

/** Valeurs de formulaire -> charge utile : NaN -> absent, '' -> null (facultatif), mot de passe vide -> absent. */
export function normalize(values: Record<string, any>, fields: FieldDef[]) {
  const out = { ...values };
  for (const f of fields) {
    let v = out[f.name];
    if (f.type === 'number') {
      if (typeof v === 'number' && Number.isNaN(v)) v = undefined;
    } else if (typeof v === 'string' && v === '') {
      if (f.type === 'password') v = undefined;
      else if (f.nullable) v = null;
    }
    out[f.name] = v;
  }
  return out;
}

export function useFieldOptions(fields: FieldDef[]) {
  const withApi = fields.filter((f) => f.optionsFrom);
  const results = useQueries({
    queries: withApi.map((f) => ({ queryKey: ['options', f.optionsFrom!.endpoint], queryFn: () => api<any[]>(f.optionsFrom!.endpoint), staleTime: 30_000 })),
  });
  return useMemo(() => {
    const map: Record<string, Option[]> = {};
    withApi.forEach((f, i) => {
      const rows = (results[i]?.data ?? []).filter(f.optionsFrom!.filter ?? (() => true));
      map[f.name] = rows.map((r) => ({ value: r.id, label: f.optionsFrom!.label(r) }));
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((r) => r.dataUpdatedAt).join(',')]);
}

export function FormDialog({
  open, onOpenChange, title, description, fields, schema, defaults, submitLabel = 'Enregistrer', onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  fields: FieldDef[];
  schema: ZodType<any>;
  defaults: Record<string, unknown>;
  submitLabel?: string;
  onSubmit: (values: Record<string, any>) => Promise<void>;
}) {
  const options = useFieldOptions(fields);
  const resolver: Resolver<any> = (values, ctx, opts) => zodResolver(schema as any)(normalize(values, fields) as any, ctx, opts) as any;
  // null -> '' : les <input>/<select> non contrôlés n'acceptent pas null
  const cleaned = Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, v ?? '']));
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<Record<string, any>>({ resolver, defaultValues: cleaned });
  const all = watch();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={handleSubmit(async (values) => {
            await onSubmit(normalize(values, fields));
          })}
        >
          <DialogHeader title={title} description={description} />
          <DialogBody>
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.filter((f) => !f.hideWhen?.(all)).map((f) => {
                const err = errors[f.name]?.message as string | undefined;
                const common = { id: `f-${f.name}`, 'aria-invalid': !!err } as const;
                return (
                  <div key={f.name} className={f.span === 2 || f.type === 'textarea' ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}>
                    {f.type === 'checkbox' ? (
                      <label className="flex h-11 items-center gap-3 text-sm font-medium">
                        <input type="checkbox" className="size-5 accent-[var(--primary)]" {...register(f.name)} /> {f.label}
                      </label>
                    ) : (
                      <Label htmlFor={common.id}>{f.label}</Label>
                    )}
                    {f.type === 'select' && (
                      <Select {...common} {...register(f.name)}>
                        {(f.nullable || f.optionsFrom) && <option value="">{f.nullable ? '— Aucun —' : '— Choisir —'}</option>}
                        {(f.options ?? options[f.name] ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                    )}
                    {f.type === 'textarea' && <Textarea {...common} {...register(f.name)} />}
                    {(f.type === 'text' || f.type === 'date' || f.type === 'password') && (
                      <Input {...common} type={f.type} placeholder={f.placeholder} autoComplete={f.autoComplete ?? (f.type === 'password' ? 'new-password' : 'off')} inputMode={f.inputMode} {...register(f.name)} />
                    )}
                    {f.type === 'number' && (
                      <Input {...common} type="number" step={f.step ?? 'any'} inputMode={f.inputMode ?? 'decimal'} placeholder={f.placeholder} {...register(f.name, { valueAsNumber: true })} />
                    )}
                    {f.help && !err && <p className="text-xs text-muted-foreground">{f.help}</p>}
                    {err && <p className="text-xs text-destructive" role="alert">{err}</p>}
                  </div>
                );
              })}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
            <Button type="submit" disabled={isSubmitting}>{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Page CRUD générique : liste TanStack + formulaire React Hook Form validé par le même schéma Zod que l'API. */
export function CrudPage<Row extends { id: string }>({ cfg }: { cfg: CrudConfig<Row> }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: [cfg.queryKey], queryFn: () => api<Row[]>(cfg.endpoint) });
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);

  const refresh = () => {
    for (const k of [cfg.queryKey, ...(cfg.invalidates ?? [])]) void qc.invalidateQueries({ queryKey: [k] });
    void qc.invalidateQueries({ queryKey: ['options'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const remove = useMutation({
    mutationFn: (row: Row) => api(`${cfg.endpoint}/${row.id}`, { method: 'DELETE' }),
    onSuccess: () => { refresh(); toast.success(`${cfg.singular} supprimé`); setDeleting(null); },
    onError: (e) => { toast.error(errorMessage(e)); setDeleting(null); },
  });

  const columns = useMemo<ColumnDef<Row, any>[]>(() => [
    ...cfg.columns,
    {
      id: 'actions', header: '', enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          {cfg.rowActions?.(row.original)}
          <Button variant="ghost" size="icon" aria-label="Modifier" onClick={() => setEditing(row.original)}><Pencil /></Button>
          {cfg.canDelete !== false && <Button variant="ghost" size="icon" aria-label="Supprimer" onClick={() => setDeleting(row.original)}><Trash2 className="text-destructive" /></Button>}
        </div>
      ),
    },
  ], [cfg]);

  const isEdit = editing !== null && editing !== 'new';
  return (
    <div className="space-y-5">
      <PageHeader title={cfg.title} description={cfg.description}
        actions={<Button onClick={() => setEditing('new')}><Plus /> Ajouter</Button>} />
      <DataTable data={list.data ?? []} columns={columns} loading={list.isLoading} searchPlaceholder={cfg.searchPlaceholder} toolbar={cfg.extraToolbar} />

      {editing && (
        <FormDialog
          key={isEdit ? (editing as Row).id : 'new'}
          open onOpenChange={(o) => !o && setEditing(null)}
          title={isEdit ? `Modifier : ${cfg.singular}` : `Nouveau : ${cfg.singular}`}
          fields={cfg.fields}
          schema={isEdit ? (cfg.editSchema ?? cfg.schema) : cfg.schema}
          defaults={isEdit ? (cfg.toForm ? cfg.toForm(editing as Row) : (editing as Row as any)) : cfg.defaults}
          onSubmit={async (values) => {
            const body = cfg.transform ? cfg.transform(values, isEdit) : values;
            try {
              if (isEdit) await api(`${cfg.endpoint}/${(editing as Row).id}`, { method: 'PATCH', body });
              else await api(cfg.endpoint, { method: 'POST', body });
              refresh();
              toast.success(isEdit ? 'Modifications enregistrées' : `${cfg.singular} ajouté`);
              setEditing(null);
            } catch (e) {
              toast.error(errorMessage(e));
            }
          }}
        />
      )}

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent size="sm">
          <DialogHeader title={`Supprimer ${cfg.singular.toLowerCase()} ?`} description="Si cet élément est déjà utilisé, désactivez-le plutôt que de le supprimer." />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Annuler</Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>Supprimer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
