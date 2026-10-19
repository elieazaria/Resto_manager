import { useState } from 'react';
import { flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface Props<T> {
  data: T[];
  columns: ColumnDef<T, any>[];
  loading?: boolean;
  searchPlaceholder?: string;
  pageSize?: number;
  empty?: string;
  toolbar?: React.ReactNode;
  onRowClick?: (row: T) => void;
}

/** Tableau TanStack : tri, recherche, pagination. Défile horizontalement sur petit écran. */
export function DataTable<T>({ data, columns, loading, searchPlaceholder = 'Rechercher…', pageSize = 15, empty = 'Aucun élément', toolbar, onRowClick }: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState('');
  const table = useReactTable({
    data, columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });
  const rows = table.getRowModel().rows;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={searchPlaceholder} className="pl-9" aria-label="Rechercher" />
        </div>
        <div className="ml-auto flex items-center gap-2">{toolbar}</div>
      </div>

      <div className={cn('overflow-x-auto rounded-lg border border-border bg-card', loading && 'opacity-60')}>
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort();
                  const dir = h.column.getIsSorted();
                  return (
                    <th key={h.id} className="px-3 py-2.5 font-medium" aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}>
                      {h.isPlaceholder ? null : sortable ? (
                        <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={h.column.getToggleSortingHandler()}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {dir === 'asc' ? <ArrowUp className="size-3" /> : dir === 'desc' ? <ArrowDown className="size-3" /> : null}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id} className={cn('hover:bg-muted/40', onRowClick && 'cursor-pointer')} onClick={() => onRowClick?.(r.original)}>
                {r.getVisibleCells().map((c) => (
                  <td key={c.id} className="px-3 py-2.5 align-middle">{flexRender(c.column.columnDef.cell, c.getContext())}</td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={columns.length} className="px-3 py-10 text-center text-muted-foreground">{loading ? 'Chargement…' : filter ? 'Aucun résultat pour cette recherche' : empty}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{table.getFilteredRowModel().rows.length} éléments</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Page précédente"><ChevronLeft /></Button>
            <span className="num">{table.getState().pagination.pageIndex + 1} / {table.getPageCount()}</span>
            <Button variant="outline" size="icon" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Page suivante"><ChevronRight /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
