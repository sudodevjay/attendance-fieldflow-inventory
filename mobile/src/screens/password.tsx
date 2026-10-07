import { router, useLocalSearchParams } from '@/lib/nav';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Btn, C, Card, Field, Muted, Screen } from '@/lib/ui';

export default function Password() {
  const { first } = useLocalSearchParams<{ first?: string }>();
  const { reload, logout } = useAuth();
  const [f, setF] = useState({ current: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/password', f);
      await reload();
      Alert.alert('Password changed');
      if (!first) router.back();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <Card style={{ gap: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>{first ? 'Choose your password' : 'Change password'}</Text>
        {first ? <Muted>You logged in with a temporary password. Choose your own (at least 6 characters).</Muted> : null}
        <Field label={first ? 'Temporary password' : 'Current password'} secureTextEntry value={f.current} onChangeText={(v) => setF({ ...f, current: v })} />
        <Field label="New password" secureTextEntry value={f.password} onChangeText={(v) => setF({ ...f, password: v })} />
        <Field label="Confirm new password" secureTextEntry value={f.confirm} onChangeText={(v) => setF({ ...f, confirm: v })} />
        {error ? <Text style={{ color: C.red }}>{error}</Text> : null}
        <Btn title="Save" onPress={save} busy={busy} />
        {first ? <Btn title="Log out" kind="outline" onPress={logout} /> : null}
      </Card>
    </Screen>
  );
}
