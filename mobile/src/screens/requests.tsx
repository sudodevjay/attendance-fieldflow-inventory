/** All own requests: leave, regularisation, overtime, comp-off, expense, advance, profile changes. */
import { router } from '@/lib/nav';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { requestDetails, requestTitle } from '@/lib/requests';
import { Badge, Btn, C, Card, Empty, Loading, Muted, Pills, Row, Screen } from '@/lib/ui';

type Tab = 'leave' | 'Regularisation' | 'Overtime' | 'CompOff' | 'Expense' | 'Advance' | 'Profile';

export default function Requests() {
  const [tab, setTab] = useState<Tab>('leave');
  const [leave, setLeave] = useState<any>(null);
  const [reqs, setReqs] = useState<any[] | null>(null);
  const load = useCallback(async () => {
    try {
      const [l, r] = await Promise.all([api.get('/leave'), api.get('/requests')]);
      setLeave(l); setReqs(r);
    } catch (e: any) { Alert.alert('Error', e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!leave || !reqs) return <Screen><Loading /></Screen>;
  const count = (t: string) => reqs.filter((r) => r.Type === t).length;
  const rows = tab === 'leave' ? leave.entries : reqs.filter((r) => r.Type === tab);
  return (
    <Screen onRefresh={load}>
      <Pills items={[{ key: 'leave', label: 'Leave', count: leave.entries.length }, { key: 'Regularisation', label: 'Checkin', count: count('Regularisation') },
        { key: 'Overtime', label: 'Overtime', count: count('Overtime') }, { key: 'CompOff', label: 'Comp-off', count: count('CompOff') },
        { key: 'Expense', label: 'Expense', count: count('Expense') }, { key: 'Advance', label: 'Advance', count: count('Advance') },
        { key: 'Profile', label: 'Profile', count: count('Profile') }]} value={tab} onChange={setTab} />
      <Row>
        {tab === 'leave' ? <Btn title="Apply Leave" onPress={() => router.push('/leave?apply=1')} style={{ flex: 1 }} /> : null}
        {tab === 'Regularisation' ? <Btn title="New regularisation" onPress={() => router.push('/regularise')} style={{ flex: 1 }} /> : null}
        {tab === 'Expense' || tab === 'Advance' ? <Btn title="New request" onPress={() => router.push(`/claims?type=${tab}`)} style={{ flex: 1 }} /> : null}
        {tab === 'Overtime' ? <Btn title="New overtime request" onPress={() => router.push('/overtime')} style={{ flex: 1 }} /> : null}
        {tab === 'CompOff' ? <Btn title="Claim comp-off" onPress={() => router.push('/compoff')} style={{ flex: 1 }} /> : null}
        {tab === 'Profile' ? <Btn title="Request a change" onPress={() => router.push('/profile-change')} style={{ flex: 1 }} /> : null}
      </Row>
      <Card style={{ padding: 0 }}>
        {rows.length === 0 ? <Empty text="Nothing here." /> : null}
        {rows.map((r: any, i: number) => (
          <View key={r.Id} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, gap: 3 }}>
            <Row>
              <Text style={{ flex: 1, fontWeight: '600' }}>
                {tab === 'leave' ? `${r.TypeName} · ${r.Days} day(s)` : requestTitle(r)}
              </Text>
              <Badge value={r.Status} />
            </Row>
            <Muted>{tab === 'leave' ? `${r.From} → ${r.To} · ${r.Reason}` : `${r.Date} · ${requestDetails(r)}`}</Muted>
            <Muted>Applied on {r.AppliedOn ?? r.Applied}{r.DecidedBy ? ` · ${r.Status} by ${r.DecidedBy}` : ''}</Muted>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
