import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { can } from '@resto/shared';
import { C } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useOutbox } from '@/lib/outbox';

export default function TabsLayout() {
  const { user } = useAuth();
  const pending = useOutbox().length;
  const admin = can(user?.role, 'admin');
  const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, size }: { color: any; size: number }) => <Ionicons name={name} color={color as string} size={size} />;
  return (
    <Tabs screenOptions={{ headerStyle: { backgroundColor: C.ink }, headerTintColor: '#fff', tabBarActiveTintColor: C.primary }}>
      <Tabs.Screen name="index" options={{ title: 'Caisse', tabBarIcon: icon('restaurant') }} />
      <Tabs.Screen name="vente" options={{ title: 'Nouvelle vente', tabBarIcon: icon('cart') }} />
      <Tabs.Screen name="commandes" options={{ title: 'Commandes', tabBarIcon: icon('receipt') }} />
      <Tabs.Screen name="tableau" options={{ title: 'Tableau de bord', tabBarLabel: 'Tableau', tabBarIcon: icon('stats-chart'), href: admin ? undefined : null }} />
      <Tabs.Screen name="reglages" options={{ title: 'Réglages', tabBarIcon: icon('settings'), tabBarBadge: pending || undefined }} />
    </Tabs>
  );
}
