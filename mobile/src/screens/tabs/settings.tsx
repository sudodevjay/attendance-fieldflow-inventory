import { router } from '@/lib/nav';
import { Alert, Text } from 'react-native';
import { session } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Btn, C, Card, H, Muted, Screen } from '@/lib/ui';

export default function Settings() {
  const { me, logout } = useAuth();
  if (!me) return null;
  return (
    <Screen>
      <Card style={{ gap: 4 }}>
        <H>{me.name}</H>
        <Muted>AC No {me.enrollNo}{me.department ? ` · ${me.department}` : ''}{me.role === 'TeamLead' ? ' · Team Lead' : me.isManager ? ' · Manager' : ''}</Muted>
        <Muted>{me.company}{me.office && me.office !== me.company ? ` · ${me.office}` : ''}</Muted>
      </Card>
      <Btn title="My profile" kind="outline" onPress={() => router.push('/profile')} />
      <Btn title="Change password" kind="outline" onPress={() => router.push('/password')} />
      <Card style={{ gap: 4 }}>
        <Text style={{ fontWeight: '600', color: C.text }}>Server</Text>
        <Muted>{session.server()}</Muted>
        <Muted>To use another server, log out and enter its address on the login screen.</Muted>
      </Card>
      <Btn title="Log out" kind="danger" onPress={() => Alert.alert('Log out', 'Log out of this phone?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Log out', style: 'destructive', onPress: logout }])} />
    </Screen>
  );
}
