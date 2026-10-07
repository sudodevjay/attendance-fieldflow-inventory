/** Notifications: decisions on requests, requests waiting for a manager, HR announcements. */
import { router, useFocusEffect, type Href } from '@/lib/nav';
import { useCallback, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { Btn, C, Card, Empty, Loading, Muted, Row, Screen } from '@/lib/ui';

interface Item { Id: number; Title: string; Body: string | null; Link: string | null; IsRead: boolean; When: string }

/** Where a notification's link opens in the app. */
const TARGET: Record<string, Href> = { leave: '/leave', requests: '/requests', team: '/team' };

export default function Notifications() {
  const [data, setData] = useState<{ unread: number; items: Item[] } | null>(null);
  const load = useCallback(async () => {
    try { setData(await api.get('/notifications')); } catch (e: any) { Alert.alert('Notifications', e.message); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = async (n: Item) => {
    if (!n.IsRead) {
      api.post('/notifications/read', { ids: [n.Id] }).catch(() => {});
      setData((d) => d && { unread: Math.max(0, d.unread - 1), items: d.items.map((x) => (x.Id === n.Id ? { ...x, IsRead: true } : x)) });
    }
    const to = n.Link ? TARGET[n.Link] : undefined;
    if (to) router.push(to);
  };
  const readAll = async () => {
    try { await api.post('/notifications/read', { all: true }); await load(); } catch (e: any) { Alert.alert('Error', e.message); }
  };

  if (!data) return <Screen><Loading /></Screen>;
  return (
    <Screen onRefresh={load}>
      <Row>
        <Muted style={{ flex: 1 }}>{data.unread ? `${data.unread} unread` : 'All read'}</Muted>
        {data.unread ? <Btn title="Mark all read" kind="outline" onPress={readAll} style={{ paddingVertical: 6 }} /> : null}
      </Row>
      <Card style={{ padding: 0 }}>
        {data.items.length === 0 ? <Empty text="No notifications yet." /> : null}
        {data.items.map((n, i) => (
          <Pressable key={n.Id} onPress={() => open(n)} accessibilityRole="button"
            style={({ pressed }) => ({ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, opacity: pressed ? 0.6 : 1, backgroundColor: n.IsRead ? '#fff' : '#eff6ff' })}>
            <Row>
              {!n.IsRead ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.brand }} /> : null}
              <Text style={{ flex: 1, fontWeight: n.IsRead ? '500' : '700', color: C.text }}>{n.Title}</Text>
            </Row>
            {n.Body ? <Muted style={{ marginTop: 2 }}>{n.Body}</Muted> : null}
            <Muted style={{ marginTop: 2, fontSize: 11 }}>{n.When}</Muted>
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}
