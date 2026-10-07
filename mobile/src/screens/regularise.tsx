/** Attendance regularisation: a missed / wrong punch, added to attendance when approved. */
import { router, useLocalSearchParams } from '@/lib/nav';
import { useState } from 'react';
import { Alert } from 'react-native';
import { api, isoToday } from '@/lib/api';
import { Btn, Card, Choice, DateStep, Field, Muted, Screen, TimeStep } from '@/lib/ui';

export default function Regularise() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  const [f, setF] = useState({ Date: date || isoToday(), Time: '09:00', CheckOut: false, Details: '' });
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post('/requests', { Type: 'Regularisation', ...f });
      Alert.alert('Regularisation', r.message);
      router.back();
    } catch (e: any) { Alert.alert('Regularisation', e.message); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <Card style={{ gap: 12 }}>
        <DateStep label="Date" value={f.Date} max={isoToday()} onChange={(v) => setF({ ...f, Date: v })} />
        <TimeStep label="Actual time" value={f.Time} onChange={(v) => setF({ ...f, Time: v })} />
        <Choice label="Punch" value={f.CheckOut ? 'out' : 'in'} onChange={(v) => setF({ ...f, CheckOut: v === 'out' })}
          options={[{ value: 'in', label: 'Check-In' }, { value: 'out', label: 'Check-Out' }]} />
        <Field label="Reason" value={f.Details} onChangeText={(v) => setF({ ...f, Details: v })} multiline placeholder="Forgot to punch / at a client site / device not working" />
        <Btn title="Send" onPress={send} busy={busy} />
        <Muted>When your manager or HR approves it, this punch is added to your attendance.</Muted>
      </Card>
    </Screen>
  );
}
