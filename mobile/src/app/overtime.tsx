/** Overtime request: hours on a day, approved by the manager / HR (paid when overtime needs approval). */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { api, isoToday } from '@/lib/api';
import { Badge, Btn, C, Card, DateStep, Empty, Field, H, Muted, Row, Screen } from '@/lib/ui';

/** Today + 30 days (the server allows asking up to 30 days ahead). */
const maxDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function Overtime() {
  const [f, setF] = useState({ Date: isoToday(), Hours: '2', Details: '' });
  const [rows, setRows] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setRows(await api.get('/requests?type=Overtime')); } catch (e: any) { Alert.alert('Error', e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post('/requests', { Type: 'Overtime', Date: f.Date, Hours: Number(f.Hours), Details: f.Details });
      Alert.alert('Overtime', r.message);
      setF({ ...f, Details: '' });
      await load();
    } catch (e: any) { Alert.alert('Overtime', e.message); } finally { setBusy(false); }
  };
  const cancel = async (id: number) => {
    try { await api.del(`/requests/${id}`); await load(); } catch (e: any) { Alert.alert('Error', e.message); }
  };

  return (
    <Screen onRefresh={load}>
      <Card style={{ gap: 12 }}>
        <H>Ask for overtime</H>
        <DateStep label="Date" value={f.Date} max={maxDate()} onChange={(v) => setF({ ...f, Date: v })} />
        <Field label="Hours (0.5 to 16)" value={f.Hours} onChangeText={(v) => setF({ ...f, Hours: v.replace(/[^0-9.]/g, '') })} keyboardType="decimal-pad" />
        <Field label="What is the overtime for" value={f.Details} onChangeText={(v) => setF({ ...f, Details: v })} multiline placeholder="Month-end closing, urgent delivery …" />
        <Btn title="Send" onPress={send} busy={busy} />
        <Muted>Your manager or HR approves it. When the company pays only approved overtime, up to these hours are paid for that day.</Muted>
      </Card>
      <Card style={{ padding: 0 }}>
        {rows && rows.length === 0 ? <Empty text="No overtime requests yet." /> : null}
        {(rows ?? []).map((r, i) => (
          <View key={r.Id} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, gap: 3 }}>
            <Row><Text style={{ flex: 1, fontWeight: '600' }}>{r.Date} · {r.Amount} h</Text><Badge value={r.Status} /></Row>
            <Muted>{r.Details}</Muted>
            {r.DecidedBy ? <Muted>{r.Status} by {r.DecidedBy}{r.DecisionNote ? ` · "${r.DecisionNote}"` : ''}</Muted> : null}
            {r.Status === 'Pending' ? <Btn title="Cancel" kind="danger" onPress={() => cancel(r.Id)} style={{ paddingVertical: 6, alignSelf: 'flex-start' }} /> : null}
          </View>
        ))}
      </Card>
    </Screen>
  );
}
