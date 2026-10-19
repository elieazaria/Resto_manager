import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { CloudUpload } from 'lucide-react';
import type { PosTableDto } from '@resto/shared';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { api } from '@/lib/api';
import { money, since } from '@/lib/format';
import { outbox, useOutbox } from '@/lib/outbox';
import { cn, errorMessage } from '@/lib/utils';

export default function PosTablesPage() {
  const nav = useNavigate();
  useOutbox(); // re-rendu quand la file change
  const tables = useQuery({
    queryKey: ['pos-tables'], queryFn: () => api<PosTableDto[]>('/pos/tables'),
    networkMode: 'offlineFirst', refetchInterval: 30_000, refetchOnWindowFocus: true,
  });
  const data = tables.data ?? [];
  const busy = data.filter((t) => t.open_order_id || outbox.pendingOrderForTable(t.id)).length;

  return (
    <div className="space-y-5">
      <PageHeader title="Caisse" description={tables.data ? `${busy} table(s) en cours sur ${data.length}` : undefined} actions={<Link to="/pos/vente" className={buttonVariants({ variant: 'accent' })}>Nouvelle vente</Link>} />
      {tables.isError && !data.length && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/8 p-4 text-sm text-destructive" role="alert">
          Impossible de charger les tables : {errorMessage(tables.error)}. Ouvrez l'application une première fois avec du réseau pour la rendre disponible hors-ligne.
        </p>
      )}
      {tables.isSuccess && !data.length && <p className="rounded-lg bg-muted p-6 text-center text-muted-foreground">Aucune table. Le gérant peut les créer dans « Tables de la salle ».</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {data.map((t) => {
          const pending = outbox.pendingOrderForTable(t.id);
          const open = !!t.open_order_id || !!pending;
          return (
            <button key={t.id} onClick={() => nav(`/pos/table/${t.id}`)}
              className={cn('relative flex aspect-[5/4] flex-col justify-between rounded-xl border p-3 text-left transition-transform active:scale-[0.98]',
                open ? 'border-accent bg-accent text-accent-foreground' : 'border-border border-l-[6px] border-l-primary bg-card hover:bg-muted/50')}>
              <span className="font-display text-xl font-semibold leading-tight">{t.name}</span>
              <span className="text-sm">
                {t.open_order_id ? (
                  <><span className="num block text-lg font-semibold">{money(t.open_total)}</span><span className="opacity-75">ouverte depuis {since(t.open_since!)}</span></>
                ) : pending ? (
                  <span className="flex items-center gap-1 font-medium"><CloudUpload className="size-4" /> à envoyer</span>
                ) : (
                  <span className="text-muted-foreground">Libre</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
