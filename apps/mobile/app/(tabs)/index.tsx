import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Empty, C } from '@/components/ui';
import { money, since } from '@/lib/format';
import { useTables } from '@/lib/hooks';
import { outbox, useOutbox } from '@/lib/outbox';

export default function Tables() {
  const router = useRouter();
  const q = useTables();
  useOutbox(); // re-rend quand la file change (badge « en attente »)
  const data = q.data ?? [];
  const busy = data.filter((t) => t.open_order_id || outbox.pendingOrderForTable(t.id)).length;

  return (
    <FlatList
      data={data}
      keyExtractor={(t) => t.id}
      numColumns={2}
      contentContainerStyle={{ padding: 12, gap: 12 }}
      columnWrapperStyle={{ gap: 12 }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={async () => { await q.refetch(); }} />}
      ListHeaderComponent={<Text style={{ color: C.muted, marginBottom: 4 }}>{q.data ? `${busy} table(s) en cours sur ${data.length}` : ''}</Text>}
      ListEmptyComponent={q.isError ? <Empty text="Impossible de charger les tables. Connectez-vous une première fois au réseau." /> : q.isPending ? <Empty text="Chargement…" /> : <Empty text="Aucune table. Le gérant doit en créer." />}
      renderItem={({ item: t }) => {
        const pending = outbox.pendingOrderForTable(t.id);
        const open = !!t.open_order_id || !!pending;
        return (
          <Pressable
            onPress={() => router.push({ pathname: '/table/[id]', params: { id: t.id } })}
            style={{ flex: 1, minHeight: 96, borderRadius: 14, padding: 14, justifyContent: 'space-between', backgroundColor: open ? C.accent : '#fff', borderWidth: 1, borderColor: open ? C.accent : C.border }}
          >
            <Text style={{ fontSize: 20, fontWeight: '800', color: open ? '#fff' : C.ink }}>{t.name}</Text>
            <View>
              <Text style={{ color: open ? '#fff' : C.muted }}>
                {open ? (t.open_total != null ? money(t.open_total) : 'À envoyer') : 'Libre'}
              </Text>
              {t.open_since ? <Text style={{ color: '#fff', fontSize: 12 }}>depuis {since(t.open_since)}</Text> : null}
              {pending ? <Text style={{ color: open ? '#fff' : C.warn, fontSize: 12 }}>⏳ en attente d'envoi</Text> : null}
            </View>
          </Pressable>
        );
      }}
    />
  );
}
