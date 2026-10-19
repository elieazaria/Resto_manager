import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { FlatList, ScrollView, Text, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { OrderDto, PaymentMethod } from '@resto/shared';
import { PayModal } from '@/components/PayModal';
import { Btn, C, Chip, Empty, Stepper, toast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useCheckout } from '@/lib/checkout';
import { money } from '@/lib/format';
import { useMenu, useTables } from '@/lib/hooks';
import { outbox } from '@/lib/outbox';
import { errorMessage, uuid } from '@/lib/utils';

/** Prise de commande d'une table : on touche un plat pour l'ajouter, +/− pour la quantité. */
export default function TableOrder() {
  const { id: tableId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const menu = useMenu();
  const tables = useTables();
  const checkout = useCheckout();
  const table = tables.data?.find((t) => t.id === tableId);

  const [orderId, setOrderId] = useState(uuid);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [cat, setCat] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Reprise de la commande déjà ouverte sur cette table (ou en attente d'envoi), une seule fois.
  const openId = table?.open_order_id ?? null;
  const existing = useQuery({
    queryKey: ['order', openId],
    queryFn: () => api<OrderDto>(`/orders/${openId}`),
    enabled: !!openId && !outbox.pendingOrderForTable(tableId),
  });
  useEffect(() => {
    if (loaded) return;
    const pending = outbox.pendingOrderForTable(tableId);
    if (pending) {
      setOrderId(pending.id);
      setQty(Object.fromEntries(pending.body.lines.map((l) => [l.menu_item_id, l.quantity])));
      setLoaded(true);
    } else if (existing.data) {
      setOrderId(existing.data.id);
      setQty(Object.fromEntries(existing.data.lines.map((l) => [l.menu_item_id, l.quantity])));
      setLoaded(true);
    } else if (tables.data && !openId) {
      setLoaded(true);
    }
  }, [loaded, existing.data, tables.data, openId, tableId]);

  const items = menu.data?.items ?? [];
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const shown = items.filter((i) => (!cat || i.category_id === cat) && i.name.toLowerCase().includes(search.trim().toLowerCase()));
  const lines = Object.entries(qty).filter(([, q]) => q > 0).map(([menu_item_id, quantity]) => ({ menu_item_id, quantity }));
  const count = lines.reduce((s, l) => s + l.quantity, 0);
  const total = lines.reduce((s, l) => s + (byId.get(l.menu_item_id)?.price ?? 0) * l.quantity, 0);
  const set = (itemId: string, n: number) => setQty((q) => ({ ...q, [itemId]: n }));

  const run = async (pay?: { method: PaymentMethod; received: number | null }, print = false) => {
    if (!lines.length) return toast('Ajoutez au moins un plat');
    setBusy(true);
    try {
      const r = await checkout.submit({ orderId, tableId, lines, pay, print });
      if (r.printError) toast(r.printError);
      if (r.queued) toast('Hors-ligne : gardé sur le téléphone, envoi automatique au retour du réseau');
      else toast(pay ? 'Vente encaissée' : 'Commande enregistrée');
      setPayOpen(false);
      if (pay || !print) router.back();
    } catch (e) {
      toast(errorMessage(e));
      if (e instanceof ApiError && (e.code === 'TABLE_BUSY' || e.code === 'ORDER_CLOSED')) router.back();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: table?.name ?? 'Commande' }} />
      <View style={{ padding: 12, gap: 10 }}>
        <TextInput value={search} onChangeText={setSearch} placeholder="Rechercher un plat…" style={{ minHeight: 46, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, backgroundColor: '#fff', fontSize: 16 }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Chip label="Tout" active={!cat} onPress={() => setCat(null)} />
          {menu.data?.categories.map((c) => <Chip key={c.id} label={c.name} active={cat === c.id} onPress={() => setCat(c.id)} />)}
        </ScrollView>
      </View>

      <FlatList
        data={shown}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Empty text={menu.isPending ? 'Chargement du menu…' : 'Aucun plat'} />}
        renderItem={({ item }) => {
          const n = qty[item.id] ?? 0;
          return (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: n ? '#fff3e6' : '#fff', borderRadius: 12, borderWidth: 1, borderColor: n ? C.accent : C.border, padding: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: C.ink }}>{item.name}</Text>
                <Text style={{ color: C.muted }}>{money(item.price)}</Text>
              </View>
              {n === 0 ? <Btn small title="Ajouter" variant="outline" onPress={() => set(item.id, 1)} /> : <Stepper value={n} onChange={(v) => set(item.id, v)} />}
            </View>
          );
        }}
      />

      <View style={{ backgroundColor: '#fff', borderTopWidth: 1, borderColor: C.border, padding: 12, gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text style={{ color: C.muted }}>{count} article(s)</Text>
          <Text style={{ fontSize: 24, fontWeight: '800', color: C.ink }}>{money(total)}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Btn style={{ flex: 1 }} variant="outline" title="Enregistrer" disabled={busy || !loaded || !count} onPress={() => run()} />
          <Btn style={{ flex: 1 }} variant="outline" title="Addition" disabled={busy || !loaded || !count} onPress={() => run(undefined, true)} />
          <Btn style={{ flex: 1.2 }} variant="accent" title="Encaisser" disabled={busy || !loaded || !count} onPress={() => setPayOpen(true)} />
        </View>
      </View>

      <PayModal visible={payOpen} total={total} busy={busy} onClose={() => setPayOpen(false)} onConfirm={(m, r) => run({ method: m, received: r }, true)} />
    </View>
  );
}
