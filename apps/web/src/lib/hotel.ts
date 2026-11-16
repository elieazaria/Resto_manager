import { useQuery } from '@tanstack/react-query';
import type { HotelReservationDto, HotelResStatus, HotelRoomDto, RoomLiveStatus } from '@resto/shared';
import { api } from './api';

/** Couleurs des barres du planning (même code que la maquette). */
export const STATUS_COLOR: Record<HotelResStatus, string> = {
  option: '#b45309', confirmed: '#15803d', checked_in: '#1f6fa3', checked_out: '#6b7280', cancelled: '#b91c1c',
};
/** Style des barres du planning : en séjour plein, confirmée crème, option pointillée, terminée grise. */
export const BAR_STYLE: Record<HotelResStatus, { background: string; color: string; border: string; borderStyle?: string; textDecoration?: string }> = {
  checked_in: { background: '#1f6fa3', color: '#fff', border: '#0d3b5c' },
  confirmed: { background: '#d3f0dd', color: '#0a5a28', border: '#4fb877' },
  option: { background: '#fff4d6', color: '#7a3f00', border: '#d99a2b', borderStyle: 'dashed' },
  checked_out: { background: '#e5e7eb', color: '#4b5563', border: '#c4c8ce' },
  cancelled: { background: '#fde8e6', color: '#b42318', border: '#f3b3ad', textDecoration: 'line-through' },
};
export const LIVE_COLOR: Record<RoomLiveStatus, string> = {
  available: '#15803d', reserved: '#7c3aed', arriving: '#0891b2', occupied: '#1f6fa3', cleaning: '#d97706', maintenance: '#c2410c', out_of_service: '#6b7280',
};
export const PAY_LABEL = { unpaid: 'Impayé', partial: 'Acompte versé', paid: 'Payé intégralement' } as const;
export const PAY_TONE = { unpaid: 'danger', partial: 'warn', paid: 'ok' } as const;

export const useRooms = () => useQuery({ queryKey: ['hotel', 'rooms'], queryFn: () => api<HotelRoomDto[]>('/hotel/rooms'), refetchInterval: 15_000 });
export const useReservations = (p: { from?: string; to?: string; status?: string; q?: string } = {}) => {
  const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({ queryKey: ['hotel', 'reservations', qs], queryFn: () => api<HotelReservationDto[]>(`/hotel/reservations${qs ? `?${qs}` : ''}`), placeholderData: (x) => x, refetchInterval: 20_000 });
};
export const hotelKeys = ['hotel'] as const;

export const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);

export function downloadCsv(name: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
