/** Database Option: company (profile, logo), auto-sync, ADMS, SQL Server connection, backup, Raspberry Pi link. */
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../app';
import { BackupDialog } from '../dialogs';
import { Button, Card, Check, Field, Input, Note, Page, TextArea } from '../ui';

export function Settings() {
  const app = useApp();
  const [f, setF] = useState<any>(null);
  const [cs, setCs] = useState('');
  const [pi, setPi] = useState<any>(null);
  const [backup, setBackup] = useState(false);

  useEffect(() => {
    api.get('/settings/company').then((r) => { setF(r); setCs(r.connectionString); });
    api.get('/settings/pi').then(setPi);
  }, []);
  if (!f) return <Page title="Settings" icon="settings"><div className="text-slate-500">Loading…</div></Page>;

  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  const say = async (p: Promise<any>) => { const r = await app.run(() => p); if (r?.message) await app.alert(r.message); return r; };
  const base = pi?.bases?.[0] ?? `http://<this PC's IP>:${pi?.port ?? 4000}/api/lx50`;
  const piConfig = `[cloud]\nurl = ${base}/punches\nusers_url = ${base}/users\ncommands_url = ${base}/commands\ntoken = ${pi?.token ?? ''}\nverify_tls = no`;

  return (
    <Page title="Settings" icon="settings">
      <div className="grid max-w-5xl gap-4 xl:grid-cols-2">
        <Card title="Company (shown in the report header)">
          <div className="space-y-3 p-4">
            <Field label="Company name"><Input value={f.companyName} onChange={(e) => set('companyName', e.target.value)} /></Field>
            <Field label="Address"><TextArea rows={3} value={f.companyAddress} onChange={(e) => set('companyAddress', e.target.value)} /></Field>
            <Check label="Auto-download attendance from the device when the Windows program starts" checked={f.autoDownload} onChange={(v) => set('autoDownload', v)} />
            <div className="flex items-center gap-2">
              Auto-sync: every <Input type="number" min={0} max={1440} value={f.autoSyncMinutes} onChange={(e) => set('autoSyncMinutes', +e.target.value)} className="w-20" />
              minutes (Windows program, 0 = off)
            </div>
            <Button variant="primary" icon="save" onClick={() => say(api.put('/settings/company', f))}>Save</Button>
          </div>
        </Card>

        <CompanyProfile value={f.profile} onChange={(p) => set('profile', p)} onSave={() => say(api.put('/settings/company', f))} />

        <Card title="Raspberry Pi (LX50 on USB)">
          <div className="space-y-3 p-4">
            <Note tone="info">{'The Pi reads the LX50 and sends punches and the user list here; it also runs Upload / Del(Device) commands from this program.\nPut these lines in /etc/lx50pi/config.ini on the Pi and run: sudo systemctl restart lx50pi'}</Note>
            <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-green-200">{piConfig}</pre>
            <div className="flex flex-wrap gap-2">
              <Button icon="check" onClick={() => navigator.clipboard?.writeText(piConfig).then(() => app.alert('Copied.'))}>Copy</Button>
              <Button icon="refresh" onClick={async () => {
                if (!(await app.confirm('Create a new token? The Pi stops working until its config.ini has the new token.'))) return;
                const r = await say(api.post('/settings/pi/new-token'));
                if (r) setPi({ ...pi, token: r.token });
              }}>New token</Button>
            </div>
            {pi?.bases?.length > 1 && <Note>{`This PC has several addresses: ${pi.bases.join(' , ')}\nUse the one on the Pi's network.`}</Note>}
            <Note>{`Windows Firewall must allow inbound TCP port ${pi?.port ?? 4000} for the Pi to reach this PC.`}</Note>
          </div>
        </Card>

        <Card title="ADMS Server (Push devices)">
          <div className="space-y-3 p-4">
            <Check label="Run the ADMS (Push / Cloud) server - newer ZKTeco devices send attendance to this PC automatically" checked={f.admsEnabled} onChange={(v) => set('admsEnabled', v)} />
            <div className="flex items-center gap-2">Port <Input type="number" min={1} max={65535} value={f.admsPort} onChange={(e) => set('admsPort', +e.target.value)} className="w-28" />
              <Button onClick={() => say(api.put('/settings/adms', { enabled: f.admsEnabled, port: f.admsPort }))}>Save</Button>
            </div>
            <Note>Device menu → Comm → Cloud Server Setting: Server = this PC's IP address, Port = the port above. The ADMS server runs inside the Windows program.</Note>
          </div>
        </Card>

        <Card title="Database (SQL Server)">
          <div className="space-y-3 p-4">
            <Field label="Connection string (web server, ODBC)"><Input value={cs} onChange={(e) => setCs(e.target.value)} className="font-mono text-xs" /></Field>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => say(api.post('/settings/test-connection', { connectionString: cs }))}>Test Connection</Button>
              <Button onClick={() => say(api.put('/settings/connection', { connectionString: cs }))}>Save (restart required)</Button>
              <Button icon="backup" onClick={() => setBackup(true)}>Backup Database</Button>
            </div>
            <Note>{'The web server and the Windows program use the same database. Example:\nDriver={ODBC Driver 18 for SQL Server};Server=.\\SQLEXPRESS;Database=ZkAttendance;Trusted_Connection=yes;TrustServerCertificate=yes;'}</Note>
          </div>
        </Card>
      </div>
      {backup && <BackupDialog onClose={() => setBackup(false)} />}
    </Page>
  );
}

const PROFILE_FIELDS: [string, string][] = [
  ['Phone', 'Phone'], ['Email', 'Email'], ['Website', 'Website'], ['Gstin', 'GSTIN'], ['Pan', 'PAN'], ['Tan', 'TAN'],
  ['PfCode', 'PF establishment code'], ['EsiCode', 'ESI employer code'],
];

/** Company profile (shown on salary slips) and logo. */
function CompanyProfile({ value, onChange, onSave }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void; onSave: () => void }) {
  const app = useApp();
  const [logo, setLogo] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { api.get('/settings/logo').then((r) => setLogo(r.logo)).catch(() => {}); }, []);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    // Shrink to at most 400 px wide so the logo stays small in the database and the PDF.
    const url = await app.run(() => new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 400 / img.width, 200 / img.height);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('This file could not be opened as a picture.'));
      img.src = URL.createObjectURL(file);
    }));
    if (ref.current) ref.current.value = '';
    if (!url) return;
    const r = await app.run(() => api.put('/settings/logo', { logo: url }));
    if (r) { setLogo(url); await app.alert(r.message); }
  };
  const remove = async () => {
    const r = await app.run(() => api.put('/settings/logo', { logo: '' }));
    if (r) setLogo('');
  };

  return (
    <Card title="Company profile (salary slip)">
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          {PROFILE_FIELDS.map(([k, label]) => (
            <Field key={k} label={label}><Input value={value?.[k] ?? ''} onChange={(e) => onChange({ ...value, [k]: e.target.value })} /></Field>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="grid h-16 w-32 place-items-center overflow-hidden rounded border border-slate-200 bg-slate-50">
            {logo ? <img src={logo} alt="Company logo" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-slate-400">No logo</span>}
          </div>
          <Button icon="folder" onClick={() => ref.current?.click()}>Logo…</Button>
          {logo && <Button icon="trash" variant="danger" onClick={remove}>Remove</Button>}
          <input ref={ref} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => pick(e.target.files?.[0])} />
        </div>
        <Button variant="primary" icon="save" onClick={onSave}>Save</Button>
      </div>
    </Card>
  );
}
