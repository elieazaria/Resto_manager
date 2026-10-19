import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'resto.server';
let current: string = (Constants.expoConfig?.extra?.defaultApiUrl as string | undefined) ?? '';

export const normalizeUrl = (u: string) => u.trim().replace(/\/+$/, '').replace(/\/api$/, '');
export const getServerUrl = () => current;
export async function loadServerUrl() {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    if (saved) current = saved;
  } catch {
    /* garde la valeur par défaut */
  }
  return current;
}
export async function setServerUrl(url: string) {
  current = normalizeUrl(url);
  await AsyncStorage.setItem(KEY, current);
}
