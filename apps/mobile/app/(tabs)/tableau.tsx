import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { PAYMENT_LABELS, type DashboardDto } from '@resto/shared';
import { C, Card, Empty } from '@/components/ui';
import { api } from '@/lib/api';
import { group, money } from '@/lib/format';

const Kpi = ({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }) => (
  <Card style={{ flexBasis: '47%', flexGrow: 1 }}>
    <Text style={{ color: C.muted, fontSize: 13 }}>{label}</Text>
    <Text style={{ fontSize: 20, fontWeight: '800', color: tone === 'bad' && value < 0 ? C.danger : tone === 'good' ? C.primary : C.ink }}>{money(value)}</Text>
  </Card>
);

/** Tableau de bord du gérant (mêmes chiffres que la version web). */
export default function Dashboard() {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardDto>('/dashboard') });
  const d = q.data;
  if (!d) return <Empty text={q.isError ? 'Impossible de charger le tableau de bord (réseau requis).' : 'Chargement…'} />;
  const k = d.kpis;
  const max = Math.max(1, ...d.series.map((s) => s.total));

  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={async () => { await q.refetch(); }} />}>
      <Text style={{ color: C.muted }}>{d.date} · {d.open_orders} commande(s) ouverte(s)</Text>
      <Text style={{ fontWeight: '800', fontSize: 16 }}>Aujourd'hui</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Kpi label={`Ventes (${k.orders_day})`} value={k.sales_day} tone="good" />
        <Kpi label="Achats" value={k.purchases_day} />
        <Kpi label="Dépenses" value={k.expenses_day} />
        <Kpi label="Bénéfice" value={k.profit_day} tone="bad" />
      </View>
      <Text style={{ fontWeight: '800', fontSize: 16 }}>Ce mois</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Kpi label={`Ventes (${k.orders_month})`} value={k.sales_month} tone="good" />
        <Kpi label="Achats" value={k.purchases_month} />
        <Kpi label="Dépenses" value={k.expenses_month} />
        <Kpi label="Bénéfice" value={k.profit_month} tone="bad" />
      </View>

      <Card>
        <Text style={{ fontWeight: '800', marginBottom: 6 }}>Trésorerie du jour</Text>
        <Text>Solde initial : {money(d.cash.opening)}</Text>
        <Text>Entrées : {money(d.cash.inflow)}   ·   Sorties : {money(d.cash.outflow)}</Text>
        <Text style={{ fontWeight: '800', marginTop: 4 }}>Reste en caisse : {money(d.cash.remaining)}</Text>
      </Card>

      <Card>
        <Text style={{ fontWeight: '800', marginBottom: 8 }}>Ventes sur {d.series.length} jours</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 90, gap: 2 }}>
          {d.series.map((s) => <View key={s.date} style={{ flex: 1, height: Math.max(2, (s.total / max) * 90), backgroundColor: C.primary, borderRadius: 2 }} />)}
        </View>
      </Card>

      <Card>
        <Text style={{ fontWeight: '800', marginBottom: 6 }}>Plats les plus vendus</Text>
        {d.top_items.length ? d.top_items.map((t) => (
          <View key={t.name} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
            <Text style={{ flex: 1 }}>{t.name}</Text><Text>{group(t.quantity)} · {money(t.revenue)}</Text>
          </View>
        )) : <Text style={{ color: C.muted }}>Aucune vente</Text>}
      </Card>

      <Card>
        <Text style={{ fontWeight: '800', marginBottom: 6 }}>Modes de paiement</Text>
        {d.by_method.map((m) => (
          <View key={m.method} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
            <Text>{PAYMENT_LABELS[m.method]} ({m.count})</Text><Text>{money(m.total)}</Text>
          </View>
        ))}
      </Card>

      <Card>
        <Text style={{ fontWeight: '800', marginBottom: 6 }}>Stock à commander ({d.low_stock.length})</Text>
        {d.low_stock.length ? d.low_stock.map((s) => (
          <View key={s.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
            <Text style={{ flex: 1 }}>{s.name}</Text>
            <Text style={{ color: s.qty < 0 ? C.danger : C.warn }}>{group(s.qty)} {s.unit} (min {group(s.min_qty)})</Text>
          </View>
        )) : <Text style={{ color: C.muted }}>Tout est en stock</Text>}
      </Card>
    </ScrollView>
  );
}
