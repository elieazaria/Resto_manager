import { useState } from 'react';
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { PAYMENT_LABELS, type OrderDto } from '@resto/shared';
import { Btn, C, Card, Empty, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtDateTime, fmtTime, money } from '@/lib/format';
import { useSettings } from '@/lib/hooks';
import { printTicket } from '@/lib/print';

const STATUS = { open: { t: 'Ouverte', c: C.accent }, paid: { t: 'Payée', c: C.primary }, cancelled: { t: 'Annulée', c: C.danger } } as const;

export default function Orders() {
  const settings = useSettings();
  const q = useQuery({ queryKey: ['orders', 'list'], queryFn: () => api<OrderDto[]>('/orders?limit=100') });
  const [sel, setSel] = useState<OrderDto | null>(null);

  return (
    <>
      <FlatList
        data={q.data ?? []}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={async () => { await q.refetch(); }} />}
        ListEmptyComponent={q.isError ? <Empty text="Impossible de charger les commandes (réseau requis)." /> : q.isPending ? <Empty text="Chargement…" /> : <Empty text="Aucune commande aujourd'hui." />}
        renderItem={({ item: o }) => (
          <Pressable onPress={() => setSel(o)}>
            <Card style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ fontWeight: '800', fontSize: 16 }}>{o.table_name}{o.ticket_no ? `  ·  #${o.ticket_no}` : ''}</Text>
                <Text style={{ color: C.muted }}>{fmtTime(o.paid_at ?? o.created_at)} · {o.lines.reduce((s, l) => s + l.quantity, 0)} article(s)</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontWeight: '800', fontSize: 16 }}>{money(o.total)}</Text>
                <Text style={{ color: STATUS[o.status].c, fontWeight: '700' }}>{STATUS[o.status].t}</Text>
              </View>
            </Card>
          </Pressable>
        )}
      />
      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <Pressable style={{ flex: 1, backgroundColor: '#0008' }} onPress={() => setSel(null)} />
        {sel ? (
          <View style={{ backgroundColor: C.bg, padding: 16, gap: 10, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%' }}>
            <Text style={{ fontSize: 20, fontWeight: '800' }}>{sel.table_name} · {STATUS[sel.status].t}</Text>
            <Text style={{ color: C.muted }}>{fmtDateTime(sel.paid_at ?? sel.created_at)}{sel.paid_by_name ? ` · ${sel.paid_by_name}` : ''}</Text>
            <ScrollView style={{ flexGrow: 0 }}>
              {sel.lines.map((l) => (
                <View key={l.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                  <Text style={{ flex: 1 }}>{l.quantity} × {l.name}</Text>
                  <Text>{money(l.unit_price * l.quantity)}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '800', fontSize: 18 }}>Total</Text>
              <Text style={{ fontWeight: '800', fontSize: 18 }}>{money(sel.total)}</Text>
            </View>
            {sel.payment_method ? <Text style={{ color: C.muted }}>Paiement : {PAYMENT_LABELS[sel.payment_method]}</Text> : null}
            {sel.status !== 'cancelled' ? (
              <Btn title={sel.status === 'paid' ? 'Réimprimer le ticket' : "Imprimer l'addition"} onPress={async () => { const e = await printTicket(sel, settings); if (e) toast(e); }} />
            ) : null}
            <Btn title="Fermer" variant="ghost" onPress={() => setSel(null)} />
          </View>
        ) : null}
      </Modal>
    </>
  );
}
