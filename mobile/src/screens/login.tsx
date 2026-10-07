import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { session } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Btn, C, Card, Field, Muted } from '@/lib/ui';

export default function Login() {
  const { login } = useAuth();
  const [server, setServer] = useState('');
  const [enrollNo, setEnrollNo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setServer(session.server()); }, []);

  const go = async () => {
    setBusy(true);
    setError('');
    try { await login(server, enrollNo, password); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.brandDark }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
        <View style={{ alignItems: 'center', marginBottom: 24 }}>
          <Text style={{ color: '#fff', fontSize: 30, fontWeight: '800', fontStyle: 'italic' }}>Housys</Text>
          <Text style={{ color: '#bfdbfe', marginTop: 4 }}>Employee attendance & leave</Text>
        </View>
        <Card style={{ gap: 12, padding: 20 }}>
          <Field label="Server address" value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://zk-attendance.onrender.com" />
          <Field label="AC No (employee ID)" value={enrollNo} onChangeText={setEnrollNo} keyboardType="number-pad" placeholder="e.g. 12" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          {error ? <Text style={{ color: C.red, fontSize: 13 }} accessibilityRole="alert">{error}</Text> : null}
          <Btn title="Log in" onPress={go} busy={busy} />
          <Muted style={{ textAlign: 'center' }}>No password yet? Ask HR to create your login. The server address is filled in already (https://zk-attendance.onrender.com).</Muted>
        </Card>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
