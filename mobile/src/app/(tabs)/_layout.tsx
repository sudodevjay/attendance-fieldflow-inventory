import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { C } from '@/lib/ui';

type Name = React.ComponentProps<typeof Ionicons>['name'];
const icon = (name: Name) => ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: C.brand, headerTitleStyle: { fontWeight: '600' }, headerTintColor: C.brandDark }}>
      <Tabs.Screen name="index" options={{ title: 'Home', headerShown: false, tabBarIcon: icon('home') }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar', tabBarIcon: icon('calendar-outline') }} />
      <Tabs.Screen name="menu" options={{ title: 'Menu', tabBarIcon: icon('menu') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('settings-outline') }} />
    </Tabs>
  );
}
