/** Salary month by month for a year. */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { api, inr } from '@/lib/api';
import { Btn, C, Card, Empty, H, Loading, Muted, Row, Screen } from '@/lib/ui';

export default function Yearly() {
  const [y, setY] = useState(new Date().getFullYear());
  const [data, setData] = useState<any>(null);
  const load = useCallback(async () => {
    setData(null);
    try { setData(await api.get(`/payroll/yearly?year=${y}`)); } catch (e: any) { Alert.alert('Error', e.message); }
  }, [y]);
  useEffect(() => { load(); }, [load]);
  return (
    <Screen onRefresh={load}>
      <Row>
        <Btn title="‹" kind="outline" onPress={() => setY(y - 1)} style={{ paddingVertical: 6 }} />
        <H style={{ flex: 1, textAlign: 'center' }}>{y}</H>
        <Btn title="›" kind="outline" onPress={() => setY(y + 1)} style={{ paddingVertical: 6 }} />
      </Row>
      {!data ? <Loading /> : (
        <>
          <Card><Muted>Net pay {y}</Muted><Text style={{ fontSize: 24, color: C.brand, fontWeight: '700' }}>{inr(data.total.net)}</Text><Muted>OT {inr(data.total.ot)} · deductions {inr(data.total.deductions)}</Muted></Card>
          <Card style={{ padding: 0 }}>
            {data.rows.length === 0 ? <Empty text="No salary data for this year." /> : null}
            {data.rows.map((r: any, i: number) => (
              <View key={r.key} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
                <Row><Text style={{ flex: 1, fontWeight: '600' }}>{r.month}</Text><Text style={{ fontWeight: '700' }}>{inr(r.net)}</Text></Row>
                <Muted>Paid days {r.paidDays}/{r.days} · present {r.present} · absent {r.absent} · leave {r.leave} · late {r.late}</Muted>
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
