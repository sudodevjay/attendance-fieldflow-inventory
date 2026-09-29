/** HR pages of the employee portal: notifications, overtime and comp-off requests, profile change request, documents. */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../app';
import { Button, Check, Field, Icon, Input, Modal, Note, StatusBadge, TextArea } from '../ui';
import { papi, ptoken, two } from './papi';
import { useMe } from './PortalApp';
import { Loading, today, useLoad, Wrap } from './PortalPages';

/** Other parts of the portal (the bell) reload their count when this fires. */
export const notificationsChanged = () => window.dispatchEvent(new Event('portal:notifications'));

/** Where a notification's link leads. */
const LINKS: Record<string, string> = { team: '/me/team-requests', requests: '/me/requests', leave: '/me/leave-reports' };

export function BellIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

// ------------------------------------------------------------------ notifications

export function Notifications() {
  const app = useApp();
  const navigate = useNavigate();
  const [data, reload] = useLoad(() => papi.get('/notifications'), []);
  if (!data) return <Loading />;
  const read = async (body: object) => {
    if (await app.run(() => papi.post('/notifications/read', body))) { reload(); notificationsChanged(); }
  };
  const open = async (n: any) => {
    if (!n.IsRead) await read({ ids: [n.Id] });
    if (LINKS[n.Link]) navigate(LINKS[n.Link]);
  };
  return (
    <Wrap>
      <div className="flex items-center gap-3">
        <div className="flex-1 text-sm text-slate-600">{data.unread} unread</div>
        <Button icon="check" disabled={!data.unread} onClick={() => read({ all: true })}>Mark all read</Button>
      </div>
      <div className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm">
        {data.items.length === 0 && <div className="p-8 text-center text-sm text-slate-400">No notifications yet.</div>}
        {data.items.map((n: any) => (
          <button key={n.Id} type="button" onClick={() => open(n)} className={`flex w-full items-start gap-3 p-4 text-left hover:bg-slate-50 ${n.IsRead ? '' : 'bg-brand-50/60'}`}>
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.IsRead ? 'bg-transparent' : 'bg-brand-600'}`} />
            <div className="min-w-0 flex-1">
              <div className={n.IsRead ? 'text-slate-700' : 'font-semibold text-slate-900'}>{n.Title}</div>
              {n.Body && <div className="text-sm text-slate-600">{n.Body}</div>}
              <div className="mt-0.5 text-xs text-slate-400">{n.When}{n.Link === 'announcement' ? ' · Announcement' : ''}</div>
            </div>
          </button>
        ))}
      </div>
    </Wrap>
  );
}

// ------------------------------------------------------------------ overtime / comp-off requests

export function OvertimeDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const [f, setF] = useState({ Date: today(), Hours: '2', Details: '' });
  const save = async () => {
    const r = await app.run(() => papi.post('/requests', { Type: 'Overtime', Date: f.Date, Hours: +f.Hours, Details: f.Details }));
    if (r) { await app.alert(r.message); onSaved(); onClose(); }
  };
  return (
    <Modal title="Overtime Request" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Send</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date"><Input type="date" value={f.Date} onChange={(e) => setF({ ...f, Date: e.target.value })} /></Field>
        <Field label="Hours (0.5 – 16)"><Input type="number" min={0.5} max={16} step={0.5} value={f.Hours} onChange={(e) => setF({ ...f, Hours: e.target.value })} /></Field>
        <Field label="What is the overtime for" className="col-span-2"><TextArea rows={3} value={f.Details} onChange={(e) => setF({ ...f, Details: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><Note>Ask before or after the day (up to 30 days ahead). When overtime needs approval, only the approved hours are paid.</Note></div>
    </Modal>
  );
}

export function CompOffDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const [f, setF] = useState({ Date: today(), Half: false, Details: '' });
  const save = async () => {
    const r = await app.run(() => papi.post('/requests', { Type: 'CompOff', Date: f.Date, Details: f.Details, ...(f.Half ? { Amount: 0.5 } : {}) }));
    if (r) { await app.alert(r.message); onSaved(); onClose(); }
  };
  return (
    <Modal title="Claim Comp-off" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Send</Button></>}>
      <div className="grid gap-3">
        <Field label="Day you worked (holiday / weekly off)"><Input type="date" max={today()} value={f.Date} onChange={(e) => setF({ ...f, Date: e.target.value })} /></Field>
        <Check label="Half day only" checked={f.Half} onChange={(v) => setF({ ...f, Half: v })} />
        <Field label="Details (optional)"><TextArea rows={2} value={f.Details} onChange={(e) => setF({ ...f, Details: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><Note>The day must have punches and be a holiday or your weekly off. Once approved, take it as leave type CO from Apply Leave.</Note></div>
    </Modal>
  );
}

export function CompOff() {
  const navigate = useNavigate();
  const [data, reload] = useLoad(() => papi.get('/comp-off'), []);
  const [claims, reloadClaims] = useLoad(() => papi.get('/requests?type=CompOff'), []);
  const [open, setOpen] = useState(false);
  if (!data) return <Loading />;
  const cards: [string, number][] = [['Available', data.available], ['Earned', data.earned], ['Used', data.used], ['Pending leave', data.pending], ['Expired', data.expired]];
  return (
    <Wrap>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon="add" onClick={() => setOpen(true)}>Claim comp-off</Button>
        <Button icon="flag" onClick={() => navigate('/me/apply-leave')}>Take comp-off (Apply Leave → CO)</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map(([k, v]) => (
          <div key={k} className="rounded-xl bg-white p-4 shadow-sm"><div className="text-3xl text-brand-700">{two(v)}</div><div className="text-sm text-slate-600">{k}</div></div>
        ))}
      </div>
      <Note>Worked on a holiday or your weekly off? Claim a comp-off for that day. Credits are valid for {data.expiryDays} days{data.nextExpiry ? ` (next one expires ${data.nextExpiry})` : ''} and are used oldest first.</Note>
      <div className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm">
        {claims?.length === 0 && <div className="p-8 text-center text-sm text-slate-400">No comp-off claims yet.</div>}
        {claims?.map((r: any) => (
          <div key={r.Id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{r.Date} · {r.Amount} day</div>
              <div className="text-xs text-slate-500">{r.Details} · Applied on {r.Applied}{r.DecidedBy && ` · ${r.Status} by ${r.DecidedBy}`}</div>
            </div>
            <StatusBadge value={r.Status} />
          </div>
        ))}
      </div>
      {open && <CompOffDialog onClose={() => setOpen(false)} onSaved={() => { reload(); reloadClaims(); }} />}
    </Wrap>
  );
}

// ------------------------------------------------------------------ profile change

const FIELD_LABELS: Record<string, string> = {
  Phone: 'Mobile', Email: 'Email', HomeAddress: 'Address', EmergencyName: 'Emergency contact name', EmergencyRelation: 'Relation',
  EmergencyPhone: 'Emergency phone', BloodGroup: 'Blood group', MaritalStatus: 'Marital status', PersonalEmail: 'Personal email', Pan: 'PAN',
  Aadhaar: 'Aadhaar', Uan: 'UAN', PfNo: 'PF No', EsiNo: 'ESI No', BankName: 'Bank name', BankAccount: 'Bank account no.', BankIfsc: 'IFSC',
  AccountHolder: 'Account holder name',
};
export const fieldLabel = (k: string) => FIELD_LABELS[k] ?? k;

/** Masked on the server: the employee types the full new value or leaves it empty. */
const MASKED = ['BankAccount', 'Aadhaar'];

export function ProfileChangeDialog({ onClose }: { onClose: () => void }) {
  const { me, reload } = useMe();
  const app = useApp();
  const current = (k: string): string => ({ Phone: me.phone, Email: me.email, HomeAddress: me.address } as Record<string, string>)[k] ?? (me.hr as any)?.[k] ?? '';
  const fields = me.selfFields ?? [];
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((k) => [k, MASKED.includes(k) ? '' : current(k)])));
  const [details, setDetails] = useState('');
  const send = async () => {
    const changes = Object.fromEntries(fields.filter((k) => (MASKED.includes(k) ? f[k].trim() !== '' : f[k].trim() !== current(k))).map((k) => [k, f[k].trim()]));
    if (!Object.keys(changes).length) return app.alert('Nothing was changed.');
    const r = await app.run(() => papi.post('/requests', { Type: 'Profile', Changes: changes, Details: details }));
    if (r) { await app.alert(r.message); onClose(); reload(); }
  };
  return (
    <Modal title="Request a profile change" width="max-w-2xl" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={send}>Send to HR</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((k) => (
          <Field key={k} label={fieldLabel(k)} className={k === 'HomeAddress' ? 'sm:col-span-2' : ''}>
            <Input value={f[k] ?? ''} placeholder={MASKED.includes(k) ? (current(k) ? `${current(k)} (type the new number to change it)` : '') : ''}
              onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </Field>
        ))}
        <Field label="Note for HR (optional)" className="sm:col-span-2"><TextArea rows={2} value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
      </div>
      <div className="mt-3"><Note>Only the fields you change are sent. HR checks and approves the change; then it shows in your profile.</Note></div>
    </Modal>
  );
}

// ------------------------------------------------------------------ documents

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.txt';
const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function Documents() {
  const app = useApp();
  const [rows, reload] = useLoad(() => papi.get('/documents'), []);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const upload = async () => {
    const f = file.current?.files?.[0];
    if (!f) return app.alert('Choose a file.');
    if (f.size > 5 * 1024 * 1024) return app.alert('The file is larger than 5 MB.');
    setBusy(true);
    const r = await app.run(() => papi.upload('/documents', f, { title }));
    setBusy(false);
    if (r) { setTitle(''); if (file.current) file.current.value = ''; reload(); }
  };
  const remove = async (id: number) => {
    if (!(await app.confirm('Delete this document?'))) return;
    if (await app.run(() => papi.del(`/documents/${id}`))) reload();
  };
  const url = (id: number) => `/api/portal/documents/${id}?token=${ptoken()}&inline=1`;
  return (
    <Wrap>
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <div className="mb-3 font-semibold">Upload a document</div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
          <Field label="Title"><Input value={title} placeholder="e.g. Aadhaar card, degree certificate" onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="File (max 5 MB)">
            <input ref={file} type="file" accept={ACCEPT} className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-white" />
          </Field>
          <Button variant="primary" icon="upload" busy={busy} onClick={upload}>Upload</Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">PDF, pictures, Word, Excel or text. HR can see your uploads.</p>
      </div>
      <div className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm">
        {rows?.length === 0 && <div className="p-8 text-center text-sm text-slate-400">No documents yet.</div>}
        {!rows && <Loading />}
        {rows?.map((d: any) => (
          <div key={d.Id} className="flex flex-wrap items-center gap-3 p-4">
            <span className="grid size-10 place-items-center rounded-lg bg-brand-50 text-brand-700"><Icon name="report" className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{d.Title}</div>
              <div className="text-xs text-slate-500">{d.FileName} · {size(d.SizeBytes)} · {d.UploadedBy?.startsWith('Employee') ? 'uploaded by you' : `by ${d.UploadedBy || 'HR'}`} · {d.UploadedAt}</div>
            </div>
            <a className="text-sm text-brand-700 underline" href={url(d.Id)} target="_blank" rel="noreferrer">Open</a>
            {d.UploadedBy?.startsWith('Employee') && <Button variant="danger" onClick={() => remove(d.Id)}>Delete</Button>}
          </div>
        ))}
      </div>
    </Wrap>
  );
}
