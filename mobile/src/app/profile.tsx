import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Image, Text, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { FIELD_LABELS } from '@/lib/profileFields';
import { Btn, C, Card, H, Muted, Row, Screen } from '@/lib/ui';

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <Card style={{ padding: 0 }}>
      {rows.map(([k, v], i) => (
        <Row key={k} style={{ padding: 12, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
          <Text style={{ width: 130, color: C.muted }}>{k}</Text><Text style={{ flex: 1, fontWeight: '500' }}>{v || '-'}</Text>
        </Row>
      ))}
    </Card>
  );
}

export default function Profile() {
  const { me, reload } = useAuth();
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  if (!me) return null;
  const hr = me.hr ?? {};
  const f = (k: keyof typeof hr) => [FIELD_LABELS[k], hr[k]] as [string, string];
  const rows: [string, string][] = [['AC No', me.enrollNo], ['No.', me.badgeNo], ['Department', me.department], ['Designation', me.designation],
    ['Reporting manager', me.reportingManager], ['Shift', me.shift], ['Date of joining', me.joinDate], ['Date of birth', me.birthDate],
    ['Gender', me.gender], ['Mobile', me.phone], ['Email', me.email], ['Address', me.address], f('PersonalEmail'), f('BloodGroup'), f('MaritalStatus')];
  return (
    <Screen>
      <Card style={{ alignItems: 'center', gap: 6 }}>
        {me.photo ? <Image source={{ uri: `data:image/jpeg;base64,${me.photo}` }} style={{ width: 96, height: 96, borderRadius: 48 }} accessibilityLabel="Photo" />
          : <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: C.brandLight, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 36, color: C.brandDark }}>{me.name.slice(0, 1)}</Text></View>}
        <Text style={{ fontSize: 20, fontWeight: '700' }}>{me.name}</Text>
        <Muted>{me.designation || 'Employee'}{me.isManager ? ' · Manager' : ''}</Muted>
      </Card>
      <Rows rows={rows} />
      <H style={{ fontSize: 14 }}>Emergency contact</H>
      <Rows rows={[f('EmergencyName'), f('EmergencyRelation'), f('EmergencyPhone')]} />
      <H style={{ fontSize: 14 }}>Bank & statutory</H>
      <Rows rows={[f('BankName'), f('AccountHolder'), f('BankAccount'), f('BankIfsc'), f('Pan'), f('Aadhaar'), f('Uan'), f('PfNo'), f('EsiNo')]} />
      {me.pendingProfileChange
        ? <Muted style={{ textAlign: 'center' }}>Your change request is waiting for HR.</Muted>
        : <Btn title="Request a change" kind="outline" onPress={() => router.push('/profile-change')} />}
      <Muted style={{ textAlign: 'center' }}>Changes are applied when HR approves them.</Muted>
    </Screen>
  );
}
