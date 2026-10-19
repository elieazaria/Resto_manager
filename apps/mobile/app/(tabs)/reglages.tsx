import { useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { ROLE_LABELS, type OrderDto } from '@resto/shared';
import { Btn, C, Card, Chip, Field, toast } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { getServerUrl, normalizeUrl, setServerUrl } from '@/lib/config';
import { fmtDateTime } from '@/lib/format';
import { useSettings } from '@/lib/hooks';
import { outbox, useOutbox } from '@/lib/outbox';
import { getPrefs, printTicket, setPrefs, type PrintMode } from '@/lib/print';
import { Alert } from 'react-native';

export default function Reglages() {
  const { user, logout } = useAuth();
  const settings = useSettings();
  const pending = useOutbox();
  const [prefs, setLocal] = useState(getPrefs());
  const [server, setServer] = useState(getServerUrl());
  const update = (p: Partial<typeof prefs>) => { setLocal({ ...prefs, ...p }); void setPrefs(p); };

  const testOrder = (): OrderDto => ({
    id: 'test', ticket_no: 0, table_id: 't', table_name: 'TEST', status: 'open', note: null, total: 12000, payment_method: null, amount_received: null,
    business_date: null, created_at: new Date().toISOString(), paid_at: null, opened_by_name: user?.full_name ?? null, paid_by_name: null, void_reason: null,
    lines: [{ id: '1', menu_item_id: '1', name: 'Test impression', unit_price: 6000, quantity: 2, note: null }],
  });

  const flush = async () => {
    const r = await outbox.flush();
    toast(r.sent || r.failed ? `${r.sent} envoyée(s), ${r.failed} refusée(s)` : 'Rien à envoyer ou serveur injoignable');
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '800' }}>{user?.full_name}</Text>
        <Text style={{ color: C.muted }}>{user ? ROLE_LABELS[user.role] : ''} · {user?.username}</Text>
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={{ fontWeight: '800' }}>Impression des tickets</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }}>
          <Chip label="RawBT (thermique)" active={prefs.mode === 'rawbt'} onPress={() => update({ mode: 'rawbt' as PrintMode })} />
          <Chip label="Impression Android" active={prefs.mode === 'system'} onPress={() => update({ mode: 'system' as PrintMode })} />
        </View>
        <Text style={{ color: C.muted }}>
          {prefs.mode === 'rawbt'
            ? "Imprimante thermique Bluetooth/USB via l'application gratuite RawBT (Play Store) : impression directe, sans fenêtre."
            : "Utilise le service d'impression d'Android (Wi-Fi, PDF, plugin du fabricant)."}
        </Text>
        <Text style={{ color: C.muted }}>Largeur du papier : {settings.paper_width} colonnes (réglée par le gérant sur le web).</Text>
        <Btn variant="outline" title="Imprimer un ticket de test" onPress={async () => { const e = await printTicket(testOrder(), settings); if (e) toast(e); }} />
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={{ fontWeight: '800' }}>Serveur</Text>
        <Field label="Adresse" value={server} onChangeText={setServer} keyboardType="url" />
        <Btn variant="outline" title="Enregistrer l'adresse" onPress={async () => { await setServerUrl(normalizeUrl(server)); toast('Adresse enregistrée'); }} />
      </Card>

      <Card style={{ gap: 8 }}>
        <Text style={{ fontWeight: '800' }}>Envois en attente ({pending.length})</Text>
        {pending.length === 0 ? <Text style={{ color: C.muted }}>Tout est synchronisé.</Text> : pending.map((p) => (
          <View key={p.id} style={{ borderTopWidth: 1, borderColor: C.border, paddingTop: 6 }}>
            <Text style={{ fontWeight: '700' }}>{p.label}</Text>
            <Text style={{ color: p.error ? C.danger : C.muted }}>{p.error ?? `Créé le ${fmtDateTime(new Date(p.createdAt))}`}</Text>
            {p.error ? <Btn small variant="ghost" title="Supprimer" onPress={() => outbox.dismiss(p.id)} /> : null}
          </View>
        ))}
        {pending.length ? <Btn variant="outline" title="Envoyer maintenant" onPress={flush} /> : null}
      </Card>

      <Btn variant="danger" title="Se déconnecter" onPress={() => {
        if (pending.some((p) => !p.error)) {
          Alert.alert('Envois en attente', 'Des commandes ne sont pas encore envoyées. Se déconnecter quand même ?', [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Se déconnecter', style: 'destructive', onPress: () => void logout() },
          ]);
        } else void logout();
      }} />
    </ScrollView>
  );
}
