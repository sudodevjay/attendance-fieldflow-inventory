/** Ask HR to change own details: only the changed fields are sent; HR approves and they are applied. */
import { router } from '@/lib/nav';
import { useState } from 'react';
import { Alert } from 'react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { FIELD_LABELS, MASKED } from '@/lib/profileFields';
import { Btn, Card, Field, Muted, Screen } from '@/lib/ui';

export default function ProfileChange() {
  const { me, reload } = useAuth();
  const current = (k: string): string => {
    if (!me) return '';
    if (k === 'Phone') return me.phone;
    if (k === 'Email') return me.email;
    if (k === 'HomeAddress') return me.address;
    return MASKED.includes(k) ? '' : (me.hr as Record<string, string>)?.[k] ?? '';
  };
  const fields = (me?.selfFields ?? []).filter((k) => FIELD_LABELS[k]);
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((k) => [k, current(k)])));
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  const send = async () => {
    const changes = Object.fromEntries(fields.filter((k) => (v[k] ?? '').trim() !== current(k).trim()).map((k) => [k, v[k].trim()]));
    if (!Object.keys(changes).length) return Alert.alert('Profile', 'Nothing was changed.');
    setBusy(true);
    try {
      const r = await api.post('/requests', { Type: 'Profile', Changes: changes, Details: details });
      await reload();
      Alert.alert('Profile', r.message);
      router.back();
    } catch (e: any) { Alert.alert('Profile', e.message); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <Card style={{ gap: 12 }}>
        {fields.map((k) => (
          <Field key={k} label={FIELD_LABELS[k]} value={v[k] ?? ''} onChangeText={(t) => setV({ ...v, [k]: t })}
            placeholder={MASKED.includes(k) ? (me.hr as Record<string, string>)?.[k] || 'Type the new number' : undefined}
            autoCapitalize={['Pan', 'BankIfsc'].includes(k) ? 'characters' : k.includes('Email') ? 'none' : 'sentences'}
            keyboardType={['Phone', 'EmergencyPhone', 'Aadhaar', 'Uan', 'BankAccount'].includes(k) ? 'number-pad' : k.includes('Email') ? 'email-address' : 'default'}
            multiline={k === 'HomeAddress'} />
        ))}
        <Field label="Note for HR (optional)" value={details} onChangeText={setDetails} multiline />
        <Btn title="Send to HR" onPress={send} busy={busy} />
        <Muted>Only the fields you change are sent. Aadhaar and bank account are hidden: type them only to change them.</Muted>
      </Card>
    </Screen>
  );
}
