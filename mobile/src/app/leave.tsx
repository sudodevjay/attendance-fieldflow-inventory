/** Leave: balance per type, apply form (?apply=1 opens it), own requests with cancel. */
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { api, isoToday, two } from '@/lib/api';
import { Badge, Btn, C, Card, Choice, DateStep, Empty, Field, H, Loading, Muted, Row, Screen } from '@/lib/ui';

export default function Leave() {
  const params = useLocalSearchParams<{ apply?: string }>();
  const [data, setData] = useState<any>(null);
  const [apply, setApply] = useState(params.apply === '1');
  const [f, setF] = useState({ LeaveTypeId: 0, FromDate: isoToday(), ToDate: isoToday(), IsHalfDay: false, Reason: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData(await api.get('/leave')); } catch (e: any) { Alert.alert('Error', e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post('/leave', f);
      Alert.alert('Leave', r.message);
      setApply(false);
      setF({ ...f, Reason: '' });
      await load();
    } catch (e: any) { Alert.alert('Leave', e.message); } finally { setBusy(false); }
  };
  const cancel = (id: number) => Alert.alert('Cancel leave', 'Cancel this leave request?', [
    { text: 'No', style: 'cancel' },
    { text: 'Yes', style: 'destructive', onPress: async () => { try { await api.del(`/leave/${id}`); await load(); } catch (e: any) { Alert.alert('Error', e.message); } } },
  ]);

  if (!data) return <Screen><Loading /></Screen>;
  return (
    <Screen onRefresh={load}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {data.types.map((t: any) => (
          <Card key={t.Id} style={{ width: '48%' }}>
            <Text style={{ fontWeight: '600' }}>{t.Name}</Text>
            <Text style={{ fontSize: 26, color: C.brand }}>{t.Remaining === null ? '∞' : two(t.Remaining)}</Text>
            <Muted>{t.Remaining === null ? 'no limit' : `left of ${t.Quota}`} · taken {t.Taken}{t.Pending ? ` · pending ${t.Pending}` : ''}</Muted>
          </Card>
        ))}
      </View>

      {apply ? (
        <Card style={{ gap: 12 }}>
          <H>Apply Leave</H>
          <Choice label="Leave type" value={f.LeaveTypeId} onChange={(v) => setF({ ...f, LeaveTypeId: v })}
            options={data.types.map((t: any) => ({ value: t.Id, label: `${t.Code} - ${t.Name}` }))} />
          <DateStep label="From" value={f.FromDate} onChange={(v) => setF({ ...f, FromDate: v, ToDate: v > f.ToDate || f.IsHalfDay ? v : f.ToDate })} />
          {!f.IsHalfDay ? <DateStep label="To" value={f.ToDate} onChange={(v) => setF({ ...f, ToDate: v < f.FromDate ? f.FromDate : v })} /> : null}
          <Choice label="Duration" value={f.IsHalfDay ? 'half' : 'full'} onChange={(v) => setF({ ...f, IsHalfDay: v === 'half', ToDate: v === 'half' ? f.FromDate : f.ToDate })}
            options={[{ value: 'full', label: 'Full day(s)' }, { value: 'half', label: 'Half day (single date)' }]} />
          <Field label="Reason" value={f.Reason} onChangeText={(v) => setF({ ...f, Reason: v })} multiline />
          <Btn title="Apply" onPress={send} busy={busy} disabled={!f.LeaveTypeId} />
          <Muted>Your manager / HR approves it. Holidays and your weekly off inside the dates are not counted.</Muted>
        </Card>
      ) : <Btn title="Apply Leave" onPress={() => setApply(true)} />}

      <H>My leave requests</H>
      <Card style={{ padding: 0 }}>
        {data.entries.length === 0 ? <Empty text="No leave requests this year." /> : null}
        {data.entries.map((l: any, i: number) => (
          <View key={l.Id} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, gap: 3 }}>
            <Row><Text style={{ flex: 1, fontWeight: '600' }}>{l.TypeName} · {l.Days} day(s)</Text><Badge value={l.Status} /></Row>
            <Muted>{l.From} → {l.To}{l.HalfDay ? ' (half day)' : ''}</Muted>
            <Muted>{l.Reason}</Muted>
            {l.DecidedBy ? <Muted>{l.Status} by {l.DecidedBy} on {l.DecidedOn}</Muted> : null}
            {l.Status === 'Pending' ? <Btn title="Cancel" kind="danger" onPress={() => cancel(l.Id)} style={{ alignSelf: 'flex-start', paddingVertical: 6, marginTop: 4 }} /> : null}
          </View>
        ))}
      </Card>
    </Screen>
  );
}
