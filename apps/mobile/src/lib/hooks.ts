import { useQuery } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, type PosMenuDto, type PosTableDto, type Settings } from '@resto/shared';
import { cachedGet } from './api';

// Lecture « offline first » : le cache disque prend le relais si le réseau est coupé.
const offline = { networkMode: 'offlineFirst' as const };
export const useMenu = () => useQuery({ queryKey: ['pos-menu'], queryFn: () => cachedGet<PosMenuDto>('/pos/menu'), staleTime: 60_000, ...offline });
export const useTables = () => useQuery({ queryKey: ['pos-tables'], queryFn: () => cachedGet<PosTableDto[]>('/pos/tables'), ...offline });
export function useSettings() {
  const q = useQuery({ queryKey: ['settings'], queryFn: () => cachedGet<Settings>('/settings'), staleTime: 300_000, ...offline });
  return q.data ?? DEFAULT_SETTINGS;
}
