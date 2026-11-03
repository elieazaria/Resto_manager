import { useQuery } from '@tanstack/react-query';
import type { HotelReservationDto, HotelResStatus, HotelRoomDto, RoomLiveStatus } from '@resto/shared';
import { api } from './api';

/** Couleurs des barres du planning (même code que la maquette). */
export const STATUS_COLOR: Record<HotelResStatus, string> = {
  option: '#f59e0b', confirmed: '#16a34a', checked_in: '#2563eb', checked_out: '#6b7280', cancelled: '#dc2626',
};
export const LIVE_COLOR: Record<RoomLiveStatus, string> = {
  available: '#16a34a', reserved: '#f59e0b', arriving: '#8b5cf6', occupied: '#2563eb', cleaning: '#06b6d4', maintenance: '#ea580c', out_of_service: '#6b7280',
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
