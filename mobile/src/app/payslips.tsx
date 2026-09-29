/** Payslip PDF of the last 12 months (opens in the browser, from where it can be saved or shared). */
import Ionicons from '@expo/vector-icons/Ionicons';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { C, Card, Muted, Screen } from '@/lib/ui';

export default function Payslips() {
  const d = new Date();
  const months = Array.from({ length: 12 }, (_, i) => new Date(d.getFullYear(), d.getMonth() - i, 1));
  return (
    <Screen>
      <Muted>The current month shows the days until today. Tap a month to open its salary slip (PDF).</Muted>
      <Card style={{ padding: 0 }}>
        {months.map((m, i) => {
          const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
          return (
            <Pressable key={key} accessibilityRole="button" onPress={() => WebBrowser.openBrowserAsync(api.fileUrl(`/payslip?month=${key}`))}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, opacity: pressed ? 0.6 : 1 })}>
              <View style={{ backgroundColor: C.brandLight, borderRadius: 8, padding: 7 }}><Ionicons name="document-text-outline" size={20} color={C.brand} /></View>
              <Text style={{ flex: 1, fontWeight: '600' }}>{m.toLocaleString('en-IN', { month: 'long', year: 'numeric' })}</Text>
              <Ionicons name="download-outline" size={20} color={C.brand} />
            </Pressable>
          );
        })}
      </Card>
    </Screen>
  );
}
