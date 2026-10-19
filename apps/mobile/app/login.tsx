import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, C, Chip, Field, toast } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { getServerUrl, normalizeUrl, setServerUrl } from '@/lib/config';
import { errorMessage } from '@/lib/utils';

export default function Login() {
  const { login } = useAuth();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'pin' | 'password'>('pin');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [server, setServer] = useState(getServerUrl());
  const [busy, setBusy] = useState(false);
  const [showServer, setShowServer] = useState(!getServerUrl() || getServerUrl().includes('example.com'));

  const submit = async () => {
    if (!username.trim() || !secret) return toast('Identifiant et ' + (mode === 'pin' ? 'PIN' : 'mot de passe') + ' requis');
    setBusy(true);
    try {
      if (normalizeUrl(server) !== getServerUrl()) await setServerUrl(server);
      await login(username.trim(), secret, mode);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.ink }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20, paddingTop: insets.top + 20 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: '#fff', fontSize: 32, fontWeight: '800' }}>Resto Manager</Text>
        <Text style={{ color: '#c9d3cc', marginBottom: 20 }}>Caisse et gestion du restaurant</Text>
        <View style={{ backgroundColor: C.bg, borderRadius: 16, padding: 16, gap: 14 }}>
          <View style={{ flexDirection: 'row' }}>
            <Chip label="Caissier (PIN)" active={mode === 'pin'} onPress={() => { setMode('pin'); setSecret(''); }} />
            <Chip label="Gérant" active={mode === 'password'} onPress={() => { setMode('password'); setSecret(''); }} />
          </View>
          <Field label="Identifiant" value={username} onChangeText={setUsername} textContentType="username" />
          <Field
            label={mode === 'pin' ? 'PIN (4 à 6 chiffres)' : 'Mot de passe'}
            value={secret} onChangeText={setSecret} secureTextEntry
            keyboardType={mode === 'pin' ? 'number-pad' : 'default'} maxLength={mode === 'pin' ? 6 : 200}
            onSubmitEditing={submit}
          />
          {showServer ? (
            <Field label="Adresse du serveur" value={server} onChangeText={setServer} keyboardType="url" placeholder="https://resto.exemple.mg" />
          ) : (
            <Text style={{ color: C.muted }} onPress={() => setShowServer(true)}>Serveur : {getServerUrl()} (modifier)</Text>
          )}
          <Btn title="Se connecter" onPress={submit} loading={busy} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
