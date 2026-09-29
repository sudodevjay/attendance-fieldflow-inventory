/** Home, as in the design: check-in card, stats, leave requests, quick links, leaves, birthdays, me / us. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, two } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Btn, C, Card, Empty, H, Loading, Muted, Row } from '@/lib/ui';

export default function Home() {
  const { me } = useAuth();
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<'me' | 'us'>('me');

  const load = useCallback(async () => {
    try { setData(await api.get('/home')); } catch (e: any) { Alert.alert('Error', e.message); }
  }, []);
  // Reload when coming back (e.g. from Notifications) so the unread count is right.
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const checkin = async () => {
    setBusy(true);
    try {
      const r = await api.post('/checkin', { checkOut: data.today.checkedIn, source: 'app' });
      Alert.alert(r.message);
      await load();
    } catch (e: any) { Alert.alert('Check-in', e.message); } finally { setBusy(false); }
  };

  if (!me) return null;
  const t = data?.today;
  const leaveCount = data?.requests.leave.length ?? 0;
  const last = data?.lastLeave;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'left', 'right']}>
      <Row style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff' }}>
        <Text style={{ flex: 1, color: C.red, fontSize: 24, fontWeight: '800', fontStyle: 'italic' }} numberOfLines={1}>{me.company || 'Housys'}</Text>
        <Pressable accessibilityLabel={`Notifications${data?.unreadNotifications ? `, ${data.unreadNotifications} unread` : ''}`} onPress={() => router.push('/notifications')} hitSlop={8}>
          <Ionicons name="notifications-outline" size={24} color={C.brand} />
          {data?.unreadNotifications ? (
            <View style={{ position: 'absolute', top: -4, right: -6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{data.unreadNotifications > 99 ? '99+' : data.unreadNotifications}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable accessibilityLabel="My profile" onPress={() => router.push('/profile')} hitSlop={8} style={{ marginLeft: 12 }}>
          {me.photo ? <Image source={{ uri: `data:image/jpeg;base64,${me.photo}` }} style={{ width: 30, height: 30, borderRadius: 15 }} />
            : <Ionicons name="person-circle" size={30} color={C.brand} />}
        </Pressable>
      </Row>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 90 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        {!data ? <Loading /> : view === 'me' ? (
          <>
            <Row style={{ alignItems: 'stretch' }}>
              <View style={{ flex: 1.15, backgroundColor: C.brand, borderRadius: 14, padding: 14, justifyContent: 'space-between' }}>
                <View>
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{t.checkedIn ? `Checked in ${t.in}` : t.punches.length ? 'Checked out' : 'Check-In Required'}</Text>
                  <Text style={{ color: '#dbeafe', fontSize: 12, marginTop: 2 }}>{t.checkedIn ? 'Have a good day' : t.punches.length ? `Worked ${t.worked || '—'} today` : 'Check-In to start your day'}</Text>
                  <Text style={{ color: '#dbeafe', fontSize: 11, marginTop: 6 }}>{t.date}</Text>
                </View>
                {me.allowCheckIn
                  ? <Btn title={t.checkedIn ? 'Checkout' : 'Checkin'} kind="light" onPress={checkin} busy={busy} style={{ marginTop: 12, paddingVertical: 8 }} />
                  : <Text style={{ color: '#fff', fontSize: 11, marginTop: 12 }}>Punch on the fingerprint device</Text>}
              </View>
              <View style={{ flex: 1, gap: 8 }}>
                <Row style={{ gap: 8 }}>
                  <Stat big={t.punches.length ? '😀' : '🙂'} label={t.punches.length ? 'Present' : 'Not in'} />
                  <Stat big={`${data.stats.attendancePct}%`} label="Attendance" />
                </Row>
                <Row style={{ gap: 8 }}>
                  <Stat big={`${data.stats.punctualityPct}%`} label="Punctuality" />
                  <Stat big={String(data.stats.offsites)} label="Regularised" />
                </Row>
              </View>
            </Row>

            <Card onPress={() => router.push('/leave')}>
              <Row><H style={{ flex: 1, fontSize: 14 }}>Total Leave Requests <Text style={{ color: C.brand }}>{leaveCount}</Text></H>{last ? <Badge value={last.Status} /> : null}</Row>
              <Muted style={{ marginTop: 4, color: C.text }}>{last ? `You sent a ${last.Type} request on ${last.AppliedOn || last.From}` : 'No leave requests this year'}</Muted>
              <Text style={{ color: C.brand, textDecorationLine: 'underline', fontSize: 12, marginTop: 4 }}>View Details</Text>
            </Card>

            <Row><H style={{ flex: 1 }}>Quick Links</H><Pressable onPress={() => router.push('/menu')}><Text style={{ color: C.brand, textDecorationLine: 'underline' }}>View all</Text></Pressable></Row>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <Quick icon="cash-outline" label={'Expense &\nAdvances'} onPress={() => router.push('/claims')} />
              <Quick icon="document-text-outline" label={'Payslips, salary\nbreakups & more'} onPress={() => router.push('/payslips')} />
              <Quick icon="clipboard-outline" label={'Attendance\nRegularisation'} onPress={() => router.push('/regularise')} />
              <Quick icon="sunny-outline" label={'Holidays'} onPress={() => router.push('/holidays')} />
              <Quick icon="hourglass-outline" label={'Overtime\nRequest'} onPress={() => router.push('/overtime')} />
              <Quick icon="swap-horizontal-outline" label={'Comp-off'} onPress={() => router.push('/compoff')} />
            </View>

            <Row style={{ alignItems: 'stretch' }}>
              <Card style={{ flex: 1 }}>
                <H style={{ fontSize: 14 }}>Leaves</H>
                <Row style={{ marginTop: 6 }}><Text style={{ fontSize: 22, color: C.brand, width: 36 }}>{two(data.leaves.availed)}</Text><Muted>Availed</Muted></Row>
                <Row><Text style={{ fontSize: 22, color: C.brand, width: 36 }}>{data.leaves.remaining === null ? '∞' : two(data.leaves.remaining)}</Text><Muted>Remaining</Muted></Row>
                {data.compOff ? <Pressable onPress={() => router.push('/compoff')}><Row><Text style={{ fontSize: 22, color: C.green, width: 36 }}>{two(data.compOff)}</Text><Muted>Comp-off</Muted></Row></Pressable> : null}
                <Btn title="Apply" onPress={() => router.push('/leave?apply=1')} style={{ marginTop: 8, paddingVertical: 8 }} />
              </Card>
              <View style={{ flex: 1, backgroundColor: C.brandLight, borderRadius: 14, padding: 14, alignItems: 'center', justifyContent: 'center' }}>
                {data.birthdays.length ? <>
                  <Text style={{ color: C.brandDark, fontSize: 12 }}>Happy Birthday to</Text>
                  <Text style={{ fontSize: 34, marginVertical: 4 }}>🎂</Text>
                  <Text style={{ color: C.brandDark, fontWeight: '700', textAlign: 'center' }}>{data.birthdays[0]}</Text>
                  {data.birthdays.length > 1 ? <Muted>+{data.birthdays.length - 1} more</Muted> : null}
                </> : <>
                  <Text style={{ color: C.brandDark, fontSize: 12 }}>Next holiday</Text>
                  <Text style={{ fontSize: 30, marginVertical: 4 }}>🌴</Text>
                  <Text style={{ color: C.brandDark, fontWeight: '700', textAlign: 'center' }}>{data.holidays[0]?.name ?? 'None planned'}</Text>
                  {data.holidays[0] ? <Muted>{data.holidays[0].date}</Muted> : null}
                </>}
              </View>
            </Row>

            {data.requests.late.length > 0 && (
              <Card>
                <H style={{ fontSize: 14 }}>Late this month ({data.requests.late.length})</H>
                {data.requests.late.slice(0, 3).map((l: any) => (
                  <Row key={l.DateIso} style={{ marginTop: 8 }}>
                    <View style={{ flex: 1 }}><Text style={{ fontWeight: '600' }}>Late by {l.LateBy}</Text><Muted>{l.Date} · in at {l.CheckIn}</Muted></View>
                    <Btn title="Regularise" kind="outline" onPress={() => router.push(`/regularise?date=${l.DateIso}`)} style={{ paddingVertical: 6, paddingHorizontal: 10 }} />
                  </Row>
                ))}
              </Card>
            )}
          </>
        ) : (
          <TeamView data={data} />
        )}
      </ScrollView>

      <View style={{ position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', backgroundColor: '#fff', borderRadius: 999, padding: 3, elevation: 4, shadowOpacity: 0.12, shadowRadius: 6 }}>
        {(['me', 'us'] as const).map((k) => (
          <Pressable key={k} onPress={() => setView(k)} accessibilityRole="tab" accessibilityState={{ selected: view === k }}
            style={{ paddingHorizontal: 22, paddingVertical: 7, borderRadius: 999, backgroundColor: view === k ? C.brand : 'transparent' }}>
            <Text style={{ color: view === k ? '#fff' : C.brand, fontWeight: '700' }}>{k === 'me' ? 'me' : 'US'}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

function Stat({ big, label }: { big: string; label: string }) {
  return (
    <Card style={{ flex: 1, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 6 }}>
      <Text style={{ fontSize: 22, color: C.brand }}>{big}</Text>
      <Text style={{ fontSize: 11, color: C.text, marginTop: 2 }} numberOfLines={1}>{label}</Text>
    </Card>
  );
}

function Quick({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ width: '48%', opacity: pressed ? 0.7 : 1 })}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 }}>
        <View style={{ backgroundColor: C.brandLight, borderRadius: 8, padding: 8 }}><Ionicons name={icon} size={20} color={C.brand} /></View>
        <Text style={{ fontSize: 11, color: C.text, flex: 1 }}>{label}</Text>
      </Card>
    </Pressable>
  );
}

/** "US": the team today for managers; the company's holidays for everybody. */
function TeamView({ data }: { data: any }) {
  const team = data.team;
  return (
    <>
      {team ? (
        <>
          <H>Todays Statistics</H>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {[['All Employees', team.total], ['Present', team.present], ['People Absent', team.absent], ['Late', team.late], ['On Leave', team.onLeave]].map(([k, v]) => (
              <Card key={k} style={{ width: '48%' }}><Text style={{ fontSize: 26, color: C.brand }}>{v}</Text><Muted>{k}</Muted></Card>
            ))}
          </View>
          <Row><H style={{ flex: 1 }}>Team Requests</H><Pressable onPress={() => router.push('/team')}><Text style={{ color: C.brand, textDecorationLine: 'underline' }}>Open</Text></Pressable></Row>
          <Card>
            {team.leaveRequests.length + team.otherRequests.length === 0 ? <Empty text="No pending requests." /> : null}
            {team.leaveRequests.slice(0, 4).map((r: any) => (
              <View key={`l${r.Id}`} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line }}>
                <Text style={{ fontWeight: '600' }}>{r.Name}</Text><Muted>From {r.From} to {r.To} · {r.TypeName}</Muted>
              </View>
            ))}
            {team.otherRequests.slice(0, 4).map((r: any) => (
              <View key={`r${r.Id}`} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line }}>
                <Text style={{ fontWeight: '600' }}>{r.Name}</Text><Muted>{r.TypeName ?? r.Type}{r.Category ? ` · ${r.Category}` : ''} · {r.Date}{r.AmountText && r.Type !== 'Overtime' && r.Type !== 'CompOff' ? ` · ₹ ${r.AmountText}` : ''}</Muted>
              </View>
            ))}
          </Card>
        </>
      ) : null}
      <H>Upcoming Holidays</H>
      <Card>
        {data.holidays.length === 0 ? <Empty text="No holidays in the next months." /> : null}
        {data.holidays.map((h: any) => (
          <Row key={h.date} style={{ paddingVertical: 8 }}><Ionicons name="calendar-outline" size={18} color={C.brand} /><Text style={{ flex: 1 }}>{h.name}</Text><Muted>{h.date}</Muted></Row>
        ))}
      </Card>
      {data.birthdays.length ? <Card><Text>🎂  Birthdays today: <Text style={{ fontWeight: '700' }}>{data.birthdays.join(', ')}</Text></Text></Card> : null}
    </>
  );
}
