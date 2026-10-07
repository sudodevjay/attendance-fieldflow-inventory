/** Expense claims (with a receipt photo) and advance / loan requests. ?type=Expense | Advance */
import { useLocalSearchParams } from '@/lib/nav';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Linking, Text, View } from 'react-native';
import { pickPhoto } from '@/lib/media';
import { api, inr, isoToday } from '@/lib/api';
import { Badge, Btn, C, Card, Choice, DateStep, Empty, Field, H, Muted, Pills, Row, Screen } from '@/lib/ui';

type Kind = 'Expense' | 'Advance';
const CATEGORIES: Record<Kind, string[]> = {
  Expense: ['Travel', 'Food', 'Fuel', 'Hotel', 'Phone / Internet', 'Office supplies', 'Other'],
  Advance: ['Salary Advance', 'Loan', 'Travel Advance', 'Other'],
};

export default function Claims() {
  const params = useLocalSearchParams<{ type?: Kind }>();
  const [kind, setKind] = useState<Kind>(params.type === 'Advance' ? 'Advance' : 'Expense');
  const [rows, setRows] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ Date: isoToday(), Category: CATEGORIES[kind][0], Amount: '', Installments: '1', Details: '', Attachment: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await api.get(`/requests?type=${kind}`)); } catch (e: any) { Alert.alert('Error', e.message); }
  }, [kind]);
  useEffect(() => { setRows(null); load(); setF((x) => ({ ...x, Category: CATEGORIES[kind][0] })); }, [load, kind]);

  const photo = async (camera: boolean) => {
    try {
      const r = await pickPhoto({ camera, base64: true, quality: 0.4 });
      if (r?.base64) setF((x) => ({ ...x, Attachment: r.base64! }));
    } catch (e: any) { Alert.alert('Photo', e.message); }
  };

  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post('/requests', { Type: kind, ...f, Amount: Number(f.Amount), Installments: Number(f.Installments) });
      Alert.alert(kind === 'Expense' ? 'Expense claim' : 'Advance', r.message);
      setOpen(false);
      setF({ ...f, Amount: '', Details: '', Attachment: '' });
      await load();
    } catch (e: any) { Alert.alert('Error', e.message); } finally { setBusy(false); }
  };
  const cancel = (id: number) => Alert.alert('Cancel', 'Cancel this request?', [
    { text: 'No', style: 'cancel' },
    { text: 'Yes', style: 'destructive', onPress: async () => { try { await api.del(`/requests/${id}`); await load(); } catch (e: any) { Alert.alert('Error', e.message); } } },
  ]);
  const sum = (st: string) => (rows ?? []).filter((r) => r.Status === st).reduce((a, r) => a + r.Amount, 0);

  return (
    <Screen onRefresh={load}>
      <Pills items={[{ key: 'Expense', label: 'Expense claims' }, { key: 'Advance', label: 'Advances & loans' }]} value={kind} onChange={(k) => { setKind(k); setOpen(false); }} />
      <Row style={{ gap: 8 }}>
        <Card style={{ flex: 1 }}><Muted>Pending</Muted><Text style={{ fontSize: 17, color: C.amber, fontWeight: '700' }}>{inr(sum('Pending'))}</Text></Card>
        <Card style={{ flex: 1 }}><Muted>Approved</Muted><Text style={{ fontSize: 17, color: C.green, fontWeight: '700' }}>{inr(sum('Approved'))}</Text></Card>
      </Row>

      {open ? (
        <Card style={{ gap: 12 }}>
          <H>{kind === 'Expense' ? 'New expense claim' : 'Advance / loan request'}</H>
          {kind === 'Expense' ? <DateStep label="Expense date" value={f.Date} max={isoToday()} onChange={(v) => setF({ ...f, Date: v })} /> : null}
          <Choice label="Category" value={f.Category} onChange={(v) => setF({ ...f, Category: v })} options={CATEGORIES[kind].map((c) => ({ value: c, label: c }))} />
          <Field label="Amount (₹)" value={f.Amount} onChangeText={(v) => setF({ ...f, Amount: v.replace(/[^0-9.]/g, '') })} keyboardType="decimal-pad" />
          {kind === 'Advance' ? <Field label="Recover in (months)" value={f.Installments} onChangeText={(v) => setF({ ...f, Installments: v.replace(/\D/g, '') })} keyboardType="number-pad" /> : null}
          <Field label={kind === 'Expense' ? 'What was it for' : 'Reason'} value={f.Details} onChangeText={(v) => setF({ ...f, Details: v })} multiline />
          {kind === 'Expense' ? (
            <View style={{ gap: 8 }}>
              <Row><Btn title="📷 Camera" kind="outline" onPress={() => photo(true)} style={{ flex: 1 }} /><Btn title="🖼 Gallery" kind="outline" onPress={() => photo(false)} style={{ flex: 1 }} /></Row>
              {f.Attachment ? <Image source={{ uri: `data:image/jpeg;base64,${f.Attachment}` }} style={{ height: 160, borderRadius: 8 }} resizeMode="contain" accessibilityLabel="Receipt" /> : <Muted>Receipt photo (optional)</Muted>}
            </View>
          ) : null}
          <Btn title="Send" onPress={send} busy={busy} />
        </Card>
      ) : <Btn title={kind === 'Expense' ? 'New expense claim' : 'Request advance / loan'} onPress={() => setOpen(true)} />}

      <Card style={{ padding: 0 }}>
        {rows && rows.length === 0 ? <Empty text="No requests yet." /> : null}
        {(rows ?? []).map((r, i) => (
          <View key={r.Id} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, gap: 3 }}>
            <Row><Text style={{ flex: 1, fontWeight: '600' }}>{r.Category} · {inr(r.Amount)}{r.Installments ? ` · ${r.Installments} mo` : ''}</Text><Badge value={r.Status} /></Row>
            <Muted>{r.Date} · {r.Details}</Muted>
            {r.DecidedBy ? <Muted>{r.Status} by {r.DecidedBy}{r.DecisionNote ? ` · "${r.DecisionNote}"` : ''}</Muted> : null}
            <Row>
              {r.HasAttachment ? <Btn title="Receipt" kind="outline" onPress={() => Linking.openURL(api.fileUrl(`/requests/${r.Id}/attachment`))} style={{ paddingVertical: 6 }} /> : null}
              {r.Status === 'Pending' ? <Btn title="Cancel" kind="danger" onPress={() => cancel(r.Id)} style={{ paddingVertical: 6 }} /> : null}
            </Row>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
