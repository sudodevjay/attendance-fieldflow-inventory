/** Managers: the team today and its requests (approve / reject). */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { requestDetails, requestTitle } from '@/lib/requests';
import { Badge, Btn, C, Card, Empty, H, Loading, Muted, Pills, Row, Screen } from '@/lib/ui';

export default function Team() {
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<'requests' | 'members'>('requests');
  const load = useCallback(async () => {
    try { setData(await api.get('/team')); } catch (e: any) { Alert.alert('Team', e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (kind: string, id: number, decision: 'Approved' | 'Rejected') => {
    try { await api.post('/team/decide', { kind, id, decision }); await load(); } catch (e: any) { Alert.alert('Error', e.message); }
  };
  const ask = (kind: string, id: number, name: string, decision: 'Approved' | 'Rejected') =>
    Alert.alert(decision === 'Approved' ? 'Approve' : 'Reject', `${decision === 'Approved' ? 'Approve' : 'Reject'} the request of ${name}?`, [
      { text: 'Cancel', style: 'cancel' }, { text: 'Yes', onPress: () => decide(kind, id, decision) },
    ]);

  if (!data) return <Screen><Loading /></Screen>;
  const pending = [
    ...data.leaves.filter((l: any) => l.Status === 'Pending').map((l: any) => ({ ...l, kind: 'leave' })),
    ...data.requests.filter((r: any) => r.Status === 'Pending').map((r: any) => ({ ...r, kind: 'request' })),
  ];
  return (
    <Screen onRefresh={load}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {[['All Employees', data.total], ['Present', data.present], ['Absent', data.absent], ['Late', data.late]].map(([k, v]) => (
          <Card key={k} style={{ width: '48%' }}><Text style={{ fontSize: 24, color: C.brand }}>{v}</Text><Muted>{k}</Muted></Card>
        ))}
      </View>
      <Pills items={[{ key: 'requests', label: 'Pending requests', count: pending.length }, { key: 'members', label: 'Team today', count: data.members.length }]} value={tab} onChange={setTab} />
      {tab === 'requests' ? (
        <Card style={{ padding: 0 }}>
          {pending.length === 0 ? <Empty text="No pending requests." /> : null}
          {pending.map((r: any, i: number) => (
            <View key={`${r.kind}${r.Id}`} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, gap: 4 }}>
              <Text style={{ fontWeight: '600' }}>{r.Name} ({r.EnrollNo})</Text>
              <Muted>{r.kind === 'leave' ? `${r.TypeName} · ${r.From} → ${r.To} (${r.Days} day(s)) · ${r.Reason}` : `${r.TypeName ?? r.Type} · ${requestTitle(r)} · ${r.Date} · ${requestDetails(r)}`}</Muted>
              {r.Stage ? <Text style={{ fontSize: 12, color: '#b45309' }}>{r.Stage}</Text> : null}
              {r.Type === 'Profile' ? <Muted>Profile changes are approved by HR.</Muted> : r.CanDecide === false ? (
                <Muted>{r.FirstApprovedBy ? 'With the manager.' : 'With the team lead.'}</Muted>
              ) : (
                <Row>
                  <Btn title={r.Step === 'first' ? 'Approve (to manager)' : 'Approve'} onPress={() => ask(r.kind, r.Id, r.Name, 'Approved')} style={{ flex: 1, paddingVertical: 8 }} />
                  <Btn title="Reject" kind="danger" onPress={() => ask(r.kind, r.Id, r.Name, 'Rejected')} style={{ flex: 1, paddingVertical: 8 }} />
                </Row>
              )}
            </View>
          ))}
        </Card>
      ) : (
        <Card style={{ padding: 0 }}>
          {data.members.map((m: any, i: number) => (
            <Row key={m.Id} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
              <View style={{ flex: 1 }}><Text style={{ fontWeight: '600' }}>{m.Name}</Text><Muted>{m.In ? `In ${m.In}${m.Out ? ` · out ${m.Out}` : ''}` : 'No punch today'} · month {m.attendancePct}%</Muted></View>
              <Badge value={m.Status} />
            </Row>
          ))}
          {data.members.length === 0 ? <Empty text="Nobody in your team." /> : null}
        </Card>
      )}
      <H style={{ fontSize: 13, color: C.muted }}>Your team = the people who report to you, or else your department and its sub-departments.</H>
    </Screen>
  );
}
