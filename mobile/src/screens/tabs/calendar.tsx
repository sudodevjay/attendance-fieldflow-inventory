/** Attendance calendar of a month; tap a day for its punches and to regularise it. */
import { router } from '@/lib/nav';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { api, isoToday } from '@/lib/api';
import { Badge, Btn, C, Card, H, Loading, Muted, Row, Screen } from '@/lib/ui';

const DOT: Record<string, string> = { P: C.green, A: C.red, HD: C.amber, H: '#4f46e5', WO: '#a1a1aa' };
const WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function addMonth(ym: string, n: number) {
  const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function Calendar() {
  const [month, setMonth] = useState(isoToday().slice(0, 7));
  const [data, setData] = useState<any>(null);
  const [pick, setPick] = useState<any>(null);
  const load = useCallback(async () => {
    setData(null);
    try { setData(await api.get(`/attendance?month=${month}`)); } catch (e: any) { Alert.alert('Error', e.message); }
  }, [month]);
  useEffect(() => { load(); setPick(null); }, [load]);
  const first = new Date(+month.slice(0, 4), +month.slice(5, 7) - 1, 1).getDay();

  return (
    <Screen onRefresh={load}>
      <Row>
        <Btn title="‹" kind="outline" onPress={() => setMonth(addMonth(month, -1))} style={{ paddingVertical: 6 }} />
        <H style={{ flex: 1, textAlign: 'center' }}>{data?.month ?? month}</H>
        <Btn title="›" kind="outline" onPress={() => setMonth(addMonth(month, 1))} style={{ paddingVertical: 6 }} />
      </Row>
      {!data ? <Loading /> : (
        <>
          <Row style={{ gap: 8 }}>
            {[['Attendance', `${data.stats.attendancePct}%`], ['Punctuality', `${data.stats.punctualityPct}%`], ['Late days', String(data.stats.lateDays)]].map(([k, v]) => (
              <Card key={k} style={{ flex: 1, alignItems: 'center' }}><Text style={{ fontSize: 20, color: C.brand }}>{v}</Text><Muted>{k}</Muted></Card>
            ))}
          </Row>
          <Card>
            <View style={{ flexDirection: 'row' }}>{WEEK.map((w, i) => <Text key={i} style={{ width: '14.28%', textAlign: 'center', color: C.muted, fontSize: 12 }}>{w}</Text>)}</View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
              {Array.from({ length: first }, (_, i) => <View key={`e${i}`} style={{ width: '14.28%', height: 52 }} />)}
              {data.days.map((d: any) => (
                <Pressable key={d.date} onPress={() => setPick(d)} accessibilityLabel={`${d.date} ${d.status}`} style={{ width: '14.28%', height: 52, padding: 2 }}>
                  <View style={{ flex: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: pick?.date === d.date ? C.brandLight : d.date === isoToday() ? '#f8fafc' : 'transparent', borderWidth: d.date === isoToday() ? 1 : 0, borderColor: C.brand }}>
                    <Text style={{ fontWeight: '600', color: C.text }}>{+d.date.slice(8)}</Text>
                    {d.status ? <View style={{ width: 7, height: 7, borderRadius: 4, marginTop: 4, backgroundColor: DOT[d.status] ?? '#9333ea' }} /> : null}
                  </View>
                </Pressable>
              ))}
            </View>
            <Row style={{ flexWrap: 'wrap', marginTop: 8, gap: 10 }}>
              {[['P', 'Present'], ['A', 'Absent'], ['HD', 'Half day'], ['H', 'Holiday'], ['WO', 'Week off']].map(([k, l]) => (
                <Row key={k} style={{ gap: 4 }}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: DOT[k] }} /><Muted>{l}</Muted></Row>
              ))}
            </Row>
          </Card>
          {pick ? (
            <Card style={{ gap: 6 }}>
              <Row><H style={{ flex: 1 }}>{pick.date} ({pick.day})</H><Badge value={pick.status} /></Row>
              <Text>In <Text style={{ fontWeight: '700' }}>{pick.in || '-'}</Text>   Out <Text style={{ fontWeight: '700' }}>{pick.out || '-'}</Text>   Worked <Text style={{ fontWeight: '700' }}>{pick.worked || '-'}</Text></Text>
              <Text>Late <Text style={{ fontWeight: '700' }}>{pick.late || '-'}</Text>   Early <Text style={{ fontWeight: '700' }}>{pick.early || '-'}</Text>   OT <Text style={{ fontWeight: '700' }}>{pick.ot || '-'}</Text></Text>
              <Muted>Punches: {pick.punches.join('  ') || '-'}</Muted>
              {pick.remark ? <Muted>{pick.remark}</Muted> : null}
              {pick.date <= isoToday() ? <Btn title="Regularise this day" kind="outline" onPress={() => router.push(`/regularise?date=${pick.date}`)} /> : null}
            </Card>
          ) : <Muted style={{ textAlign: 'center' }}>Tap a day to see its punches.</Muted>}
        </>
      )}
    </Screen>
  );
}
