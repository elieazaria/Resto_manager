import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { fmtDate, fmtQty, money } from './format';

export const textCol = <T,>(key: keyof T & string, header: string, o: Partial<ColumnDef<T, any>> = {}): ColumnDef<T, any> => ({ accessorKey: key, header, ...o });
export const moneyCol = <T,>(key: keyof T & string, header: string): ColumnDef<T, any> => ({
  accessorKey: key, header, cell: ({ getValue }) => <span className="num">{money(getValue<number>())}</span>,
});
export const dateCol = <T,>(key: keyof T & string, header = 'Date'): ColumnDef<T, any> => ({
  accessorKey: key, header, cell: ({ getValue }) => <span className="num">{fmtDate(getValue<string>())}</span>,
});
export const qtyCol = <T,>(key: keyof T & string, header: string, unitKey?: keyof T & string): ColumnDef<T, any> => ({
  accessorKey: key, header,
  cell: ({ row, getValue }) => <span className="num">{fmtQty(getValue<number>())}{unitKey ? ` ${(row.original as any)[unitKey]}` : ''}</span>,
});
export const activeCol = <T,>(key: keyof T & string = 'is_active' as any): ColumnDef<T, any> => ({
  accessorKey: key, header: 'Actif',
  cell: ({ getValue }) => (getValue() ? <Badge tone="ok">Actif</Badge> : <Badge>Désactivé</Badge>),
});
