/** The app: login gate, the four tabs and every screen opened from them (React Navigation). */
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar, type ColorValue } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/lib/auth';
import { navigationRef } from '@/lib/nav';
import { C, Loading } from '@/lib/ui';
import Claims from '@/screens/claims';
import CompOff from '@/screens/compoff';
import Documents from '@/screens/documents';
import Holidays from '@/screens/holidays';
import Leave from '@/screens/leave';
import Login from '@/screens/login';
import Notifications from '@/screens/notifications';
import Overtime from '@/screens/overtime';
import Password from '@/screens/password';
import Payslips from '@/screens/payslips';
import Profile from '@/screens/profile';
import ProfileChange from '@/screens/profile-change';
import Regularise from '@/screens/regularise';
import Requests from '@/screens/requests';
import Calendar from '@/screens/tabs/calendar';
import Home from '@/screens/tabs/index';
import Menu from '@/screens/tabs/menu';
import Settings from '@/screens/tabs/settings';
import Team from '@/screens/team';
import Yearly from '@/screens/yearly';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

type Name = React.ComponentProps<typeof Ionicons>['name'];
const icon = (name: Name) => ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

function Tabs() {
  return (
    <Tab.Navigator screenOptions={{ tabBarActiveTintColor: C.brand, headerTitleStyle: { fontWeight: '600' }, headerTintColor: C.brandDark }}>
      <Tab.Screen name="index" component={Home} options={{ title: 'Home', headerShown: false, tabBarIcon: icon('home') }} />
      <Tab.Screen name="calendar" component={Calendar} options={{ title: 'Calendar', tabBarIcon: icon('calendar-outline') }} />
      <Tab.Screen name="menu" component={Menu} options={{ title: 'Menu', tabBarIcon: icon('menu') }} />
      <Tab.Screen name="settings" component={Settings} options={{ title: 'Settings', tabBarIcon: icon('settings-outline') }} />
    </Tab.Navigator>
  );
}

/** Not logged in: only the login screen. First login: the new password. Otherwise the app. */
function Gate() {
  const { ready, me } = useAuth();
  if (!ready) return <Loading />;
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: '#fff' }, headerTintColor: C.brandDark, headerTitleStyle: { fontWeight: '600' }, contentStyle: { backgroundColor: C.bg } }}>
      {!me ? (
        <Stack.Screen name="login" component={Login} options={{ headerShown: false }} />
      ) : me.mustChange ? (
        <Stack.Screen name="first-password" component={Password} options={{ title: 'Password' }} initialParams={{ first: '1' }} />
      ) : (
        <>
          <Stack.Screen name="tabs" component={Tabs} options={{ headerShown: false }} />
          <Stack.Screen name="password" component={Password} options={{ title: 'Password' }} />
          <Stack.Screen name="leave" component={Leave} options={{ title: 'Leave' }} />
          <Stack.Screen name="requests" component={Requests} options={{ title: 'My Requests' }} />
          <Stack.Screen name="regularise" component={Regularise} options={{ title: 'Attendance Regularisation' }} />
          <Stack.Screen name="claims" component={Claims} options={{ title: 'Expense & Advances' }} />
          <Stack.Screen name="payslips" component={Payslips} options={{ title: 'Payslips' }} />
          <Stack.Screen name="yearly" component={Yearly} options={{ title: 'Yearly Report' }} />
          <Stack.Screen name="holidays" component={Holidays} options={{ title: 'Holidays' }} />
          <Stack.Screen name="team" component={Team} options={{ title: 'Team' }} />
          <Stack.Screen name="profile" component={Profile} options={{ title: 'My Profile' }} />
          <Stack.Screen name="profile-change" component={ProfileChange} options={{ title: 'Request a Change' }} />
          <Stack.Screen name="notifications" component={Notifications} options={{ title: 'Notifications' }} />
          <Stack.Screen name="overtime" component={Overtime} options={{ title: 'Overtime Request' }} />
          <Stack.Screen name="compoff" component={CompOff} options={{ title: 'Comp-off' }} />
          <Stack.Screen name="documents" component={Documents} options={{ title: 'My Documents' }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar barStyle="dark-content" backgroundColor="#fff" />
        <NavigationContainer ref={navigationRef}>
          <Gate />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
