/** Comp-off: balance, and claiming a credit for work on a holiday / weekly off (used later as CO leave). */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { api, isoToday, two } from '@/lib/api';
import { Badge, Btn, C, Card, Choice, DateStep, Empty, Field, H, Loading, Muted, Row, Screen } from '@/lib/ui';

interface Balance { earned: number; used: number; pending: number; available: number; expired: number; expiryDays: number; nextExpiry: string }

export default function CompOff() {
  const [bal, setBal] = useState<Balance | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [f, setF] = useState({ Date: isoToday(), half: false, Details: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const [b, r] = await Promise.all([api.get<Balance>('/comp-off'), api.get('/requests?type=CompOff')]);
      setBal(b); setRows(r);
    } catch (e: any) { Alert.alert('Comp-off', e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post('/requests', { Type: 'CompOff', Date: f.Date, ...(f.half ? { Amount: 0.5 } : {}), Details: f.Details });
      Alert.alert('Comp-off', r.message);
      setF({ ...f, Details: '' });
      await load();
    } catch (e: any) { Alert.alert('Comp-off', e.message); } finally { setBusy(false); }
  };

  if (!bal) return <Screen><Loading /></Screen>;
  return (
    <Screen onRefresh={load}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {([['Available', bal.available, C.green], ['Earned', bal.earned, C.brand], ['Used', bal.used, C.brand], ['Pending leave', bal.pending, C.amber]] as const).map(([k, v, color]) => (
          <Card key={k} style={{ width: '48%' }}><Text style={{ fontSize: 24, color }}>{two(v)}</Text><Muted>{k}</Muted></Card>
        ))}
      </View>
      <Muted>
        Credits are valid for {bal.expiryDays} days{bal.nextExpiry ? `; the next one expires on ${bal.nextExpiry}` : ''}.
        {bal.expired ? ` ${bal.expired} day(s) expired unused.` : ''}
      </Muted>
      {bal.available > 0 ? <Btn title="Use comp-off (apply CO leave)" kind="outline" onPress={() => router.push('/leave?apply=1')} /> : null}

      <Card style={{ gap: 12 }}>
        <H>Claim a comp-off</H>
        <DateStep label="Day you worked (holiday / weekly off)" value={f.Date} max={isoToday()} onChange={(v) => setF({ ...f, Date: v })} />
        <Choice label="Days" value={f.half ? 'half' : 'full'} onChange={(v) => setF({ ...f, half: v === 'half' })}
          options={[{ value: 'full', label: 'As worked (full day, or half for a half day)' }, { value: 'half', label: 'Half day' }]} />
        <Field label="Details (optional)" value={f.Details} onChangeText={(v) => setF({ ...f, Details: v })} multiline />
        <Btn title="Send" onPress={send} busy={busy} />
        <Muted>Only a day with your punches that was a holiday or weekly off can be claimed. Your manager or HR approves it.</Muted>
      </Card>

      <Card style={{ padding: 0 }}>
        {rows.length === 0 ? <Empty text="No comp-off claims yet." /> : null}
        {rows.map((r, i) => (
          <View key={r.Id} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, gap: 3 }}>
            <Row><Text style={{ flex: 1, fontWeight: '600' }}>{r.Date} · {r.Amount} day</Text><Badge value={r.Status} /></Row>
            <Muted>{r.Details}</Muted>
            {r.DecidedBy ? <Muted>{r.Status} by {r.DecidedBy}</Muted> : null}
          </View>
        ))}
      </Card>
    </Screen>
  );
}
