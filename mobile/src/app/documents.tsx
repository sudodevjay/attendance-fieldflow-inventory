/** My documents: files HR keeps for me (offer letter, ID proofs …) and photos of documents I upload. */
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { Btn, C, Card, Empty, Field, H, Loading, Muted, Row, Screen } from '@/lib/ui';

interface Doc { Id: number; Title: string; FileName: string; SizeBytes: number; UploadedBy: string | null; UploadedAt: string }

const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const mine = (d: Doc) => (d.UploadedBy ?? '').startsWith('Employee');

export default function Documents() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setDocs(await api.get('/documents')); } catch (e: any) { Alert.alert('Documents', e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  /** Photo of a document from the camera / gallery, sent as a .jpg file. */
  const upload = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission needed', 'Allow access to add the photo of the document.');
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6 };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets[0]) return;
    const name = `${(title.trim() || 'document').replace(/[^\w-]+/g, '_').slice(0, 40)}.jpg`;
    const form = new FormData();
    form.append('title', title.trim() || 'Document');
    // Native fetch sends { uri, name, type } as a file; in the browser the picked image is a blob URL.
    if (Platform.OS === 'web') form.append('file', await (await fetch(r.assets[0].uri)).blob(), name);
    else form.append('file', { uri: r.assets[0].uri, name, type: 'image/jpeg' } as any);
    setBusy(true);
    try {
      await api.upload('/documents', form);
      setTitle('');
      await load();
    } catch (e: any) { Alert.alert('Upload', e.message); } finally { setBusy(false); }
  };

  const remove = (d: Doc) => Alert.alert('Delete', `Delete "${d.Title}"?`, [
    { text: 'No', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => { try { await api.del(`/documents/${d.Id}`); await load(); } catch (e: any) { Alert.alert('Error', e.message); } } },
  ]);

  if (!docs) return <Screen><Loading /></Screen>;
  return (
    <Screen onRefresh={load}>
      <Card style={{ padding: 0 }}>
        {docs.length === 0 ? <Empty text="No documents yet." /> : null}
        {docs.map((d, i) => (
          <View key={d.Id} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, gap: 3 }}>
            <Text style={{ fontWeight: '600' }}>{d.Title}</Text>
            <Muted>{d.FileName} · {size(d.SizeBytes)} · {d.UploadedAt.slice(0, 10)} · {mine(d) ? 'uploaded by you' : `by ${d.UploadedBy ?? 'HR'}`}</Muted>
            <Row>
              <Btn title="Open" kind="outline" onPress={() => WebBrowser.openBrowserAsync(api.fileUrl(`/documents/${d.Id}?inline=1`))} style={{ paddingVertical: 6 }} />
              {mine(d) ? <Btn title="Delete" kind="danger" onPress={() => remove(d)} style={{ paddingVertical: 6 }} /> : null}
            </Row>
          </View>
        ))}
      </Card>
      <Card style={{ gap: 12 }}>
        <H>Upload a document</H>
        <Field label="Title" value={title} onChangeText={setTitle} placeholder="Aadhaar card, PAN card, certificate …" />
        <Row><Btn title="📷 Camera" kind="outline" busy={busy} onPress={() => upload(true)} style={{ flex: 1 }} /><Btn title="🖼 Gallery" kind="outline" busy={busy} onPress={() => upload(false)} style={{ flex: 1 }} /></Row>
        <Muted>A photo of the document is sent to HR (max. 5 MB). HR can also add PDF files for you.</Muted>
      </Card>
    </Screen>
  );
}
