import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from '@resto/shared';
import { money } from '@/lib/format';
import { Btn, C, Chip, Field } from './ui';

/** Fenêtre d'encaissement : mode de paiement, montant reçu et rendu monnaie. */
export function PayModal({
  visible, total, busy, onClose, onConfirm,
}: { visible: boolean; total: number; busy?: boolean; onClose: () => void; onConfirm: (method: PaymentMethod, received: number | null) => void }) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [received, setReceived] = useState('');
  useEffect(() => { if (visible) { setMethod('cash'); setReceived(''); } }, [visible]);

  const rec = received === '' ? null : Number(received.replace(/\s/g, ''));
  const change = method === 'cash' && rec != null ? rec - total : null;
  const short = change != null && change < 0;
  const quick = [...new Set([total, Math.ceil(total / 5000) * 5000, Math.ceil(total / 10000) * 10000, Math.ceil(total / 50000) * 50000])].filter((v) => v >= total);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: '#0008' }} onPress={onClose} />
      <View style={{ backgroundColor: C.bg, padding: 16, gap: 14, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%' }}>
        <ScrollView contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled">
          <View style={{ backgroundColor: C.ink, borderRadius: 12, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={{ color: '#fff' }}>Total à payer</Text>
            <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800' }}>{money(total)}</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }}>
            {PAYMENT_METHODS.map((m) => <Chip key={m} label={PAYMENT_LABELS[m]} active={m === method} onPress={() => setMethod(m)} />)}
          </View>
          {method === 'cash' && (
            <View style={{ gap: 10 }}>
              <Field label="Montant reçu (Ar)" keyboardType="number-pad" value={received} onChangeText={setReceived} placeholder={String(total)} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }}>
                {quick.map((q) => <Chip key={q} label={money(q)} onPress={() => setReceived(String(q))} />)}
              </View>
              {change != null && (
                <Text style={{ fontSize: 18, fontWeight: '700', color: short ? C.danger : C.primary }}>
                  {short ? `Il manque ${money(-change)}` : `Rendu : ${money(change)}`}
                </Text>
              )}
            </View>
          )}
          <Btn title="Encaisser et imprimer" variant="accent" loading={busy} disabled={short} onPress={() => onConfirm(method, method === 'cash' ? (rec ?? total) : null)} />
          <Btn title="Annuler" variant="ghost" onPress={onClose} />
        </ScrollView>
      </View>
    </Modal>
  );
}
