/** Building blocks of the app: colors, cards, buttons, inputs, status badges, a date stepper. */
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const C = {
  brand: '#1d4ed8', brandDark: '#1e3a8a', brandLight: '#dbeafe', bg: '#f1f5f9', card: '#ffffff', text: '#0f172a', muted: '#64748b',
  line: '#e2e8f0', red: '#dc2626', green: '#16a34a', amber: '#d97706', yellow: '#fcd34d', pink: '#fce7f3',
};

export function Screen({ children, refreshing, onRefresh, padded = true }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void; padded?: boolean }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={padded ? { padding: 16, gap: 12, paddingBottom: 32 } : undefined}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) {
  const body = <View style={[s.card, style]}>{children}</View>;
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>{body}</Pressable> : body;
}

export function H({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[{ fontSize: 16, fontWeight: '600', color: C.text }, style]}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[{ fontSize: 12, color: C.muted }, style]}>{children}</Text>;
}

export function Btn({ title, onPress, kind = 'primary', busy, disabled, style }:
  { title: string; onPress: () => void; kind?: 'primary' | 'light' | 'danger' | 'outline'; busy?: boolean; disabled?: boolean; style?: ViewStyle }) {
  const bg = kind === 'primary' ? C.brand : kind === 'light' ? '#fff' : kind === 'danger' ? '#fff' : 'transparent';
  const fg = kind === 'primary' ? '#fff' : kind === 'danger' ? C.red : C.text;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || busy}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, borderColor: kind === 'danger' ? '#fca5a5' : kind === 'primary' ? C.brand : C.line, opacity: pressed || disabled ? 0.6 : 1 }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: '600', fontSize: 14 }}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor="#94a3b8" {...props} style={[s.input, props.multiline && { minHeight: 80, textAlignVertical: 'top' }, props.style]} />
    </View>
  );
}

const BADGE: Record<string, [string, string]> = {
  P: ['#dcfce7', '#166534'], Approved: ['#dcfce7', '#166534'], done: ['#dcfce7', '#166534'],
  A: ['#fee2e2', '#991b1b'], Rejected: ['#fee2e2', '#991b1b'],
  HD: ['#fef3c7', '#92400e'], Pending: ['#fef3c7', '#92400e'],
  H: ['#e0e7ff', '#3730a3'], WO: ['#e4e4e7', '#3f3f46'],
};

export function Badge({ value }: { value: string }) {
  if (!value || value === '-') return null;
  const [bg, fg] = BADGE[value] ?? ['#f3e8ff', '#6b21a8'];
  return <Text style={{ backgroundColor: bg, color: fg, fontSize: 11, fontWeight: '700', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, overflow: 'hidden', alignSelf: 'flex-start' }}>{value}</Text>;
}

export function Pills<T extends string>({ items, value, onChange }: { items: { key: T; label: string; count?: number }[]; value: T; onChange: (k: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {items.map((i) => (
        <Pressable key={i.key} onPress={() => onChange(i.key)} accessibilityRole="tab" accessibilityState={{ selected: value === i.key }}
          style={[s.pill, value === i.key && { backgroundColor: C.brand, borderColor: C.brand }]}>
          <Text style={{ color: value === i.key ? '#fff' : C.text, fontWeight: '500' }}>{i.label}{i.count !== undefined ? `  ${i.count}` : ''}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>{children}</View>;
}

export function Loading() {
  return <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={C.brand} /></View>;
}

export function Empty({ text }: { text: string }) {
  return <Text style={{ textAlign: 'center', color: '#94a3b8', padding: 24 }}>{text}</Text>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const niceDate = (iso: string) => `${iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;

function shift(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Date field with − / + buttons (a day, or a month with the long press) and the date shown in words. */
export function DateStep({ label, value, onChange, max }: { label: string; value: string; onChange: (v: string) => void; max?: string }) {
  const set = (v: string) => onChange(max && v > max ? max : v);
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <Row style={[s.input, { justifyContent: 'space-between', paddingVertical: 4 }]}>
        <Pressable accessibilityLabel="Previous day" onPress={() => set(shift(value, -1))} onLongPress={() => set(shift(value, -30))} style={s.step}><Text style={s.stepText}>−</Text></Pressable>
        <Text style={{ fontSize: 15, fontWeight: '600', color: C.text }}>{niceDate(value)}</Text>
        <Pressable accessibilityLabel="Next day" onPress={() => set(shift(value, 1))} onLongPress={() => set(shift(value, 30))} style={s.step}><Text style={s.stepText}>+</Text></Pressable>
      </Row>
    </View>
  );
}

/** Time field HH:mm with hour / minute steppers. */
export function TimeStep({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [h, m] = value.split(':').map(Number);
  const set = (hh: number, mm: number) => onChange(`${String((hh + 24) % 24).padStart(2, '0')}:${String((mm + 60) % 60).padStart(2, '0')}`);
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <Row style={[s.input, { justifyContent: 'space-between', paddingVertical: 4 }]}>
        <Pressable accessibilityLabel="Hour down" onPress={() => set(h - 1, m)} style={s.step}><Text style={s.stepText}>−h</Text></Pressable>
        <Pressable accessibilityLabel="Minutes down" onPress={() => set(h, m - 5)} style={s.step}><Text style={s.stepText}>−m</Text></Pressable>
        <Text style={{ fontSize: 17, fontWeight: '700', color: C.text }}>{value}</Text>
        <Pressable accessibilityLabel="Minutes up" onPress={() => set(h, m + 5)} style={s.step}><Text style={s.stepText}>+m</Text></Pressable>
        <Pressable accessibilityLabel="Hour up" onPress={() => set(h + 1, m)} style={s.step}><Text style={s.stepText}>+h</Text></Pressable>
      </Row>
    </View>
  );
}

export function Choice<T extends string | number>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.value === value);
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <Pressable onPress={() => setOpen((o) => !o)} style={s.input} accessibilityRole="button">
        <Text style={{ color: cur ? C.text : '#94a3b8', fontSize: 15 }}>{cur?.label ?? 'Select…'}</Text>
      </Pressable>
      {open && (
        <View style={[s.card, { padding: 4 }]}>
          {options.map((o) => (
            <Pressable key={String(o.value)} onPress={() => { onChange(o.value); setOpen(false); }} style={{ padding: 10, borderRadius: 6, backgroundColor: o.value === value ? C.brandLight : 'transparent' }}>
              <Text style={{ color: C.text }}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

export const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 14, padding: 14, shadowColor: '#0f172a', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  btn: { borderRadius: 8, borderWidth: 1, paddingVertical: 11, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12, fontWeight: '600', color: '#475569' },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 8, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.text },
  pill: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#fff' },
  step: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: C.brandLight },
  stepText: { color: C.brandDark, fontWeight: '700', fontSize: 15 },
});
