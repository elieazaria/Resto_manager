import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import type { OrderDto, PaymentMethod } from '@resto/shared';
import { PayModal } from '@/components/PayModal';
import { Btn, Card, C, Stepper, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { mergeLines, useCheckout } from '@/lib/checkout';
import { money } from '@/lib/format';
import { useMenu, useTables } from '@/lib/hooks';
import { outbox } from '@/lib/outbox';
import { errorMessage, uuid } from '@/lib/utils';

interface Row { key: string; itemId: string; qty: number }
const newRow = (): Row => ({ key: uuid(), itemId: '', qty: 1 });

/** Saisie d'une vente façon formulaire : table, plats (liste déroulante) + quantités, paiement, impression. */
export default function QuickSale() {
  const menu = useMenu();
  const tables = useTables();
  const checkout = useCheckout();
  const [tableId, setTableId] = useState('');
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [orderId, setOrderId] = useState(uuid);
  const [reuse, setReuse] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<OrderDto | null>(null);

  const items = menu.data?.items ?? [];
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const total = rows.reduce((s, r) => s + (byId.get(r.itemId)?.price ?? 0) * r.qty, 0);
  const valid = rows.filter((r) => r.itemId);
  const chosen = new Set(rows.map((r) => r.itemId).filter(Boolean));

  // Table déjà occupée : on reprend ses plats (même identifiant de commande), sans doublon.
  useEffect(() => {
    setReuse(false);
    if (!tableId) return;
    const toRows = (ls: { menu_item_id: string; quantity: number }[]) => (ls.length ? ls.map((l) => ({ key: uuid(), itemId: l.menu_item_id, qty: l.quantity })) : [newRow()]);
    const pending = outbox.pendingOrderForTable(tableId);
    const t = tables.data?.find((x) => x.id === tableId);
    if (pending) { setOrderId(pending.id); setRows(toRows(pending.body.lines)); setReuse(true); }
    else if (t?.open_order_id) {
      api<OrderDto>(`/orders/${t.open_order_id}`)
        .then((o) => { setOrderId(o.id); setRows(toRows(o.lines)); setReuse(true); })
        .catch((e) => toast(errorMessage(e)));
    } else setOrderId(uuid());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);

  const setRow = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const run = async (pay?: { method: PaymentMethod; received: number | null }) => {
    if (!tableId) return toast('Choisissez une table');
    if (!valid.length) return toast('Choisissez au moins un plat');
    setBusy(true);
    try {
      const r = await checkout.submit({ orderId, tableId, lines: mergeLines(valid.map((x) => ({ menu_item_id: x.itemId, quantity: x.qty }))), pay, print: true });
      if (r.printError) toast(r.printError);
      if (r.queued) toast('Hors-ligne : gardé sur le téléphone, envoi automatique au retour du réseau');
      setPayOpen(false);
      setDone(r.order);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => { setTableId(''); setRows([newRow()]); setOrderId(uuid()); setDone(null); setReuse(false); };

  if (done) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Card style={{ alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: C.primary }}>{done.status === 'paid' ? 'Vente enregistrée ✓' : 'Commande enregistrée ✓'}</Text>
          <Text style={{ color: C.muted }}>{done.table_name} · {done.lines.reduce((s, l) => s + l.quantity, 0)} article(s)</Text>
          <Text style={{ fontSize: 34, fontWeight: '800', color: C.ink }}>{money(done.total)}</Text>
          {done.payment_method === 'cash' && done.amount_received != null && done.amount_received > done.total ? (
            <Text style={{ fontSize: 18, fontWeight: '700', color: C.primary }}>Rendu : {money(done.amount_received - done.total)}</Text>
          ) : null}
        </Card>
        <Btn title="Réimprimer le ticket" variant="outline" onPress={async () => { const e = await checkout.reprint(done); if (e) toast(e); }} />
        <Btn title="Nouvelle vente" onPress={reset} />
      </ScrollView>
    );
  }

  const groups = (menu.data?.categories ?? []).map((c) => ({ ...c, items: items.filter((i) => i.category_id === c.id) })).filter((g) => g.items.length);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={{ fontWeight: '700', marginBottom: 4 }}>Table</Text>
          <View style={{ borderWidth: 1, borderColor: C.border, borderRadius: 10, backgroundColor: '#fff' }}>
            <Picker selectedValue={tableId} onValueChange={setTableId}>
              <Picker.Item label="— Choisir une table —" value="" />
              {(tables.data ?? []).map((t) => <Picker.Item key={t.id} value={t.id} label={t.open_order_id ? `${t.name} (en cours : ${money(t.open_total)})` : t.name} />)}
            </Picker>
          </View>
          {reuse ? <Text style={{ color: C.muted, marginTop: 6 }}>Cette table a déjà une commande : ses plats sont repris, vous pouvez les modifier.</Text> : null}
        </Card>

        {rows.map((r, i) => {
          const it = byId.get(r.itemId);
          return (
            <Card key={r.key} style={{ gap: 8 }}>
              <Text style={{ fontWeight: '700' }}>Plat {i + 1}</Text>
              <View style={{ borderWidth: 1, borderColor: C.border, borderRadius: 10, backgroundColor: '#fff' }}>
                <Picker selectedValue={r.itemId} onValueChange={(v) => setRow(r.key, { itemId: v })}>
                  <Picker.Item label="— Choisir un plat —" value="" />
                  {groups.flatMap((g) => [
                    <Picker.Item key={`h-${g.id}`} label={`── ${g.name} ──`} value="__h" enabled={false} color="#888" />,
                    ...g.items.map((x) => <Picker.Item key={x.id} value={x.id} label={`${x.name} — ${money(x.price)}`} enabled={!chosen.has(x.id) || x.id === r.itemId} />),
                  ])}
                </Picker>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Stepper value={r.qty} min={1} onChange={(n) => setRow(r.key, { qty: n })} />
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: C.muted }}>{it ? `${r.qty} × ${money(it.price)}` : ''}</Text>
                  <Text style={{ fontSize: 18, fontWeight: '800' }}>{it ? money(it.price * r.qty) : ''}</Text>
                </View>
              </View>
              {rows.length > 1 ? <Btn small variant="ghost" title="Retirer ce plat" onPress={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} /> : null}
            </Card>
          );
        })}
        <Btn variant="outline" title="+ Ajouter un plat" onPress={() => setRows((rs) => [...rs, newRow()])} />
      </ScrollView>

      <View style={{ backgroundColor: '#fff', borderTopWidth: 1, borderColor: C.border, padding: 12, gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text style={{ color: C.muted }}>Total</Text>
          <Text style={{ fontSize: 26, fontWeight: '800', color: C.ink }}>{money(total)}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Btn style={{ flex: 1 }} variant="outline" title="Sans encaisser" disabled={busy} onPress={() => run()} />
          <Btn style={{ flex: 1.4 }} variant="accent" title="Encaisser et imprimer" disabled={busy || !valid.length || !tableId} onPress={() => setPayOpen(true)} />
        </View>
      </View>
      <PayModal visible={payOpen} total={total} busy={busy} onClose={() => setPayOpen(false)} onConfirm={(m, rec) => run({ method: m, received: rec })} />
    </View>
  );
}
