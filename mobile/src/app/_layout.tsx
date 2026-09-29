import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { C, Loading } from '@/lib/ui';

function Gate() {
  const { ready, me } = useAuth();
  const segments = useSegments();
  if (!ready) return <Loading />;
  const inLogin = segments[0] === 'login';
  const inPassword = segments[0] === 'password';
  if (!me && !inLogin) return <Redirect href="/login" />;
  if (me && me.mustChange && !inPassword) return <Redirect href="/password?first=1" />;
  if (me && !me.mustChange && inLogin) return <Redirect href="/" />;
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: '#fff' }, headerTintColor: C.brandDark, headerTitleStyle: { fontWeight: '600' }, contentStyle: { backgroundColor: C.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="password" options={{ title: 'Password' }} />
      <Stack.Screen name="leave" options={{ title: 'Leave' }} />
      <Stack.Screen name="requests" options={{ title: 'My Requests' }} />
      <Stack.Screen name="regularise" options={{ title: 'Attendance Regularisation' }} />
      <Stack.Screen name="claims" options={{ title: 'Expense & Advances' }} />
      <Stack.Screen name="payslips" options={{ title: 'Payslips' }} />
      <Stack.Screen name="yearly" options={{ title: 'Yearly Report' }} />
      <Stack.Screen name="holidays" options={{ title: 'Holidays' }} />
      <Stack.Screen name="team" options={{ title: 'Team' }} />
      <Stack.Screen name="profile" options={{ title: 'My Profile' }} />
      <Stack.Screen name="profile-change" options={{ title: 'Request a Change' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="overtime" options={{ title: 'Overtime Request' }} />
      <Stack.Screen name="compoff" options={{ title: 'Comp-off' }} />
      <Stack.Screen name="documents" options={{ title: 'My Documents' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
