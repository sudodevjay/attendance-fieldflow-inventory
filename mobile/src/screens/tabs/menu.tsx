import { Ionicons } from '@react-native-vector-icons/ionicons';
import { router, type Href } from '@/lib/nav';
import { Pressable, Text, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { C, Card, Muted, Screen } from '@/lib/ui';

type Icon = React.ComponentProps<typeof Ionicons>['name'];
const ITEMS: { title: string; items: [Icon, string, string, Href][] }[] = [
  {
    title: 'Leave Management', items: [
      ['airplane-outline', 'Apply Leave', 'Casual, sick, earned leave', '/leave?apply=1'],
      ['list-outline', 'Leave Reports', 'Balance and your requests', '/leave'],
      ['sunny-outline', 'See Holidays', 'Company holidays of the year', '/holidays'],
      ['swap-horizontal-outline', 'Comp-off', 'Balance, claim for work on a holiday / weekly off', '/compoff'],
    ],
  },
  {
    title: 'Requests', items: [
      ['time-outline', 'My Requests', 'Leave, regularisation, overtime, expenses …', '/requests'],
      ['clipboard-outline', 'Attendance Regularisation', 'Missed or wrong punch', '/regularise'],
      ['hourglass-outline', 'Overtime Request', 'Extra hours for approval', '/overtime'],
      ['notifications-outline', 'Notifications', 'Decisions and announcements', '/notifications'],
    ],
  },
  {
    title: 'My Profile', items: [
      ['person-outline', 'Profile', 'Personal, emergency, bank details', '/profile'],
      ['create-outline', 'Request a Change', 'Phone, address, bank … (HR approves)', '/profile-change'],
      ['folder-open-outline', 'My Documents', 'Offer letter, ID proofs, uploads', '/documents'],
    ],
  },
  {
    title: 'Payroll', items: [
      ['document-text-outline', 'Payslips Download', 'Monthly salary slip (PDF)', '/payslips'],
      ['bar-chart-outline', 'Yearly Report', 'Salary month by month', '/yearly'],
      ['cash-outline', 'Reimbursement', 'Expense claims with receipts', '/claims?type=Expense'],
      ['wallet-outline', 'Loans & Advances', 'Salary advance, loan', '/claims?type=Advance'],
    ],
  },
];

export default function Menu() {
  const { me } = useAuth();
  const groups = me?.isManager
    ? [...ITEMS, { title: 'Team', items: [['people-outline', 'Team Requests & Stats', 'Approve leave, regularisation, overtime, comp-off', '/team']] as [Icon, string, string, Href][] }]
    : ITEMS;
  return (
    <Screen>
      {groups.map((g) => (
        <View key={g.title} style={{ gap: 8 }}>
          <Text style={{ fontWeight: '700', color: C.brandDark, marginTop: 4 }}>{g.title}</Text>
          <Card style={{ padding: 0 }}>
            {g.items.map(([icon, label, hint, to], i) => (
              <Pressable key={label} onPress={() => router.push(to)} accessibilityRole="button"
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, opacity: pressed ? 0.6 : 1 })}>
                <View style={{ backgroundColor: C.brandLight, borderRadius: 8, padding: 7 }}><Ionicons name={icon} size={20} color={C.brand} /></View>
                <View style={{ flex: 1 }}><Text style={{ fontWeight: '600', color: C.text }}>{label}</Text><Muted>{hint}</Muted></View>
                <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
              </Pressable>
            ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}
