import { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { Btn, C, Card, Empty, H, Loading, Muted, Row, Screen } from '@/lib/ui';

export default function Holidays() {
  const [y, setY] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<any[] | null>(null);
  const load = useCallback(async () => {
    setRows(null);
    try { setRows(await api.get(`/holidays?year=${y}`)); } catch (e: any) { Alert.alert('Error', e.message); }
  }, [y]);
  useEffect(() => { load(); }, [load]);
  return (
    <Screen onRefresh={load}>
      <Row>
        <Btn title="‹" kind="outline" onPress={() => setY(y - 1)} style={{ paddingVertical: 6 }} />
        <H style={{ flex: 1, textAlign: 'center' }}>{y}</H>
        <Btn title="›" kind="outline" onPress={() => setY(y + 1)} style={{ paddingVertical: 6 }} />
      </Row>
      {!rows ? <Loading /> : (
        <Card style={{ padding: 0 }}>
          {rows.length === 0 ? <Empty text={`No holidays entered for ${y}.`} /> : null}
          {rows.map((h, i) => (
            <Row key={h.iso} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, opacity: h.past ? 0.5 : 1 }}>
              <View style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: C.brandLight, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 17, fontWeight: '700', color: C.brandDark }}>{h.iso.slice(8)}</Text>
              </View>
              <View style={{ flex: 1 }}><Text style={{ fontWeight: '600' }}>{h.name}</Text><Muted>{h.day}, {h.date}</Muted></View>
            </Row>
          ))}
        </Card>
      )}
    </Screen>
  );
}
