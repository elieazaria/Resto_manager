import { type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, ToastAndroid, Alert, View, type TextInputProps, type ViewStyle } from 'react-native';

export const C = {
  ink: '#1f2a24',
  primary: '#2f6f4f',
  accent: '#d97a2b',
  bg: '#f6f4ef',
  card: '#ffffff',
  border: '#ded9cd',
  muted: '#6b7268',
  danger: '#b3261e',
  warn: '#b45309',
};

export function toast(msg: string) {
  if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.LONG);
  else Alert.alert(msg);
}

type Variant = 'primary' | 'accent' | 'outline' | 'ghost' | 'danger';
export function Btn({
  title, onPress, variant = 'primary', disabled, loading, style, small,
}: { title: string; onPress: () => void; variant?: Variant; disabled?: boolean; loading?: boolean; style?: ViewStyle; small?: boolean }) {
  const bg = variant === 'primary' ? C.primary : variant === 'accent' ? C.accent : variant === 'danger' ? C.danger : 'transparent';
  const fg = variant === 'outline' || variant === 'ghost' ? C.ink : '#fff';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn, small && { minHeight: 40, paddingHorizontal: 12 },
        { backgroundColor: bg, borderColor: variant === 'outline' ? C.border : bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }, small && { fontSize: 14 }]}>{title}</Text>}
    </Pressable>
  );
}

export const Card = ({ children, style }: { children: ReactNode; style?: ViewStyle }) => <View style={[s.card, style]}>{children}</View>;

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, active && { backgroundColor: C.ink, borderColor: C.ink }]}>
      <Text style={{ color: active ? '#fff' : C.ink, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Stepper({ value, onChange, min = 0, max = 99 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <View style={s.stepper}>
      <Pressable accessibilityLabel="Diminuer" style={s.stepBtn} onPress={() => onChange(Math.max(min, value - 1))}><Text style={s.stepTxt}>−</Text></Pressable>
      <Text style={s.stepVal}>{value}</Text>
      <Pressable accessibilityLabel="Augmenter" style={s.stepBtn} onPress={() => onChange(Math.min(max, value + 1))}><Text style={s.stepTxt}>+</Text></Pressable>
    </View>
  );
}

export function Field({ label, error, ...p }: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor="#9a9a90" autoCapitalize="none" autoCorrect={false} {...p} style={[s.input, p.style]} />
      {error ? <Text style={{ color: C.danger }}>{error}</Text> : null}
    </View>
  );
}

export const Empty = ({ text }: { text: string }) => <Text style={{ color: C.muted, textAlign: 'center', padding: 24 }}>{text}</Text>;

const s = StyleSheet.create({
  btn: { minHeight: 52, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  btnText: { fontSize: 16, fontWeight: '700' },
  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', marginRight: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  stepTxt: { fontSize: 22, fontWeight: '700', color: C.ink },
  stepVal: { minWidth: 34, textAlign: 'center', fontSize: 18, fontWeight: '700', color: C.ink },
  label: { fontSize: 13, fontWeight: '600', color: C.muted },
  input: { minHeight: 50, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, fontSize: 16, backgroundColor: '#fff', color: C.ink },
});
