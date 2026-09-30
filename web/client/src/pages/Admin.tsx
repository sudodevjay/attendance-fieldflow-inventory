/** Users with roles, audit log, notifications / announcements (administrator program). */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, isoDate, qs } from '../api';
import { useApp } from '../app';
import { DataTable } from '../DataTable';
import { Button, Card, Check, Field, Input, Modal, Note, Page, Select, TextArea } from '../ui';

// ------------------------------------------------------------------ users

interface User {
  Id: number; UserName: string; FullName: string; Role: string; IsActive: boolean; LastLogin: string; CreatedAt: string;
  DepartmentId: number | null; Department: string;
}

const ROLE_TEXT: Record<string, string> = {
  SuperAdmin: 'Everything, also users & roles, audit log, database / backup, Raspberry Pi and the Supervisor password.',
  Admin: 'Everything else: employees, attendance, leave, payroll, devices, portal and company settings. No users or system settings.',
  HOD: 'Head of department: only their department and its sub-departments. Sees employees, attendance and reports, approves leave and requests. No salaries or settings.',
  HR: 'Employees, holidays, shifts / roster, attendance, leave, portal requests, reports, announcements. Reads the rest; no users.',
  Payroll: 'Salary structure, statutory rules, salary rule and reports. Reads the rest; no users.',
  Viewer: 'Opens every screen and report but cannot change anything; no users or audit log.',
};

export function Users() {
  const app = useApp();
  const [data, setData] = useState<{ users: User[]; roles: string[] }>({ users: [], roles: [] });
  const [sel, setSel] = useState<number[]>([]);
  const [edit, setEdit] = useState<(Partial<User> & { Password?: string }) | null>(null);
  const load = useCallback(() => api.get('/users').then(setData), []);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = data.users.find((u) => u.Id === sel[0]);
  const del = async () => {
    if (!current || !(await app.confirm(`Delete the user ${current.UserName}?`))) return;
    if (await app.run(() => api.del(`/users/${current.Id}`))) { setSel([]); await load(); }
  };
  return (
    <Page title="Users & Roles" icon="lock" toolbar={
      <>
        <Button variant="primary" icon="add" onClick={() => setEdit({ Role: 'HR', IsActive: true, Password: '' })}>Add User</Button>
        <Button icon="edit" disabled={!current} onClick={() => current && setEdit({ ...current, Password: '' })}>Edit</Button>
        <Button icon="trash" variant="danger" disabled={!current} onClick={del}>Delete</Button>
      </>
    } bodyClass="flex flex-col gap-3">
      <div className="flex min-h-48 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <DataTable rows={data.users} rowKey={(u) => u.Id} selected={sel} onSelect={(k) => setSel(k as number[])} onDoubleClick={(u) => setEdit({ ...u, Password: '' })}
          empty="No users yet. The Supervisor password (Administrator) always logs in as SuperAdmin."
          columns={[
            { key: 'UserName', header: 'User name' }, { key: 'FullName', header: 'Full name' }, { key: 'Role', header: 'Role' },
            { key: 'Department', header: 'Department (HOD)' },
            { key: 'IsActive', header: 'Active', render: (u) => (u.IsActive ? 'Yes' : <span className="text-red-600">Disabled</span>) },
            { key: 'LastLogin', header: 'Last login' }, { key: 'CreatedAt', header: 'Created' },
          ]} />
      </div>
      <Card title="Roles">
        <ul className="space-y-1 p-3 text-[13px]">
          {Object.entries(ROLE_TEXT).map(([r, t]) => <li key={r} className="flex gap-2"><b className="w-24 shrink-0">{r}</b><span>{t}</span></li>)}
          <li className="flex gap-2 pt-1 text-slate-500"><b className="w-24 shrink-0">Team Lead, Manager</b>
            <span>are employees: set them in Employee Portal → Employee Logins (Role). They work in the portal (/me) and the app.</span></li>
        </ul>
      </Card>
      {edit && <UserDialog value={edit} roles={data.roles} onClose={() => setEdit(null)} onSaved={load} />}
    </Page>
  );
}

function UserDialog({ value, roles, onClose, onSaved }: { value: Partial<User> & { Password?: string }; roles: string[]; onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const [f, setF] = useState(value);
  const [depts, setDepts] = useState<{ Id: number; Name: string; ParentId: number | null }[]>([]);
  useEffect(() => { api.get('/departments').then((r) => setDepts(r.departments)).catch(() => {}); }, []);
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => { if (await app.run(() => (f.Id ? api.put(`/users/${f.Id}`, f) : api.post('/users', f)))) { onSaved(); onClose(); } };
  const deptName = (d: { Name: string; ParentId: number | null }): string => {
    const parent = depts.find((x) => x.Id === d.ParentId);
    return parent ? `${deptName(parent)} › ${d.Name}` : d.Name;
  };
  return (
    <Modal title={f.Id ? `Edit ${value.UserName}` : 'Add User'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>OK</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="User name *"><Input value={f.UserName ?? ''} autoComplete="off" onChange={(e) => set('UserName', e.target.value)} /></Field>
        <Field label="Full name"><Input value={f.FullName ?? ''} onChange={(e) => set('FullName', e.target.value)} /></Field>
        <Field label="Role"><Select value={f.Role} onChange={(e) => set('Role', e.target.value)}>{roles.map((r) => <option key={r}>{r}</option>)}</Select></Field>
        <Field label={f.Id ? 'New password (empty = keep)' : 'Password * (min. 6)'}>
          <Input type="password" autoComplete="new-password" value={f.Password ?? ''} onChange={(e) => set('Password', e.target.value)} />
        </Field>
        {f.Role === 'HOD' && (
          <Field label="Department * (with its sub-departments)" className="col-span-2">
            <Select value={f.DepartmentId ?? ''} onChange={(e) => set('DepartmentId', e.target.value ? Number(e.target.value) : null)}>
              <option value="">— choose —</option>
              {depts.map((d) => ({ id: d.Id, name: deptName(d) })).sort((a, b) => a.name.localeCompare(b.name))
                .map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
        )}
        <div className="col-span-2"><Check label="Active (may log in)" checked={f.IsActive !== false} onChange={(v) => set('IsActive', v)} /></div>
        <div className="col-span-2"><Note>{ROLE_TEXT[f.Role ?? ''] ?? ''}</Note></div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ audit log

interface AuditRow { Id: number; When: string; UserName: string; Role: string; Action: string; Path: string; Details: string; Ip: string }

export function AuditLog() {
  const app = useApp();
  const [f, setF] = useState({ from: isoDate(), to: isoDate(), user: '', q: '' });
  const [rows, setRows] = useState<AuditRow[]>([]);
  const load = useCallback(() => api.get('/audit' + qs(f)).then(setRows), [f]);
  useEffect(() => { app.run(load); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Page title="Audit Log" icon="search" toolbar={
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); app.run(load); }}>
        <label className="flex items-center gap-1.5">From<Input type="date" value={f.from} className="w-36" onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="flex items-center gap-1.5">To<Input type="date" value={f.to} className="w-36" onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <Input placeholder="User" value={f.user} className="w-32" onChange={(e) => setF({ ...f, user: e.target.value })} />
        <Input placeholder="Search action / details" value={f.q} className="w-48" onChange={(e) => setF({ ...f, q: e.target.value })} />
        <Button type="submit" icon="search">Show</Button>
        <Button icon="export" onClick={() => app.run(() => api.download('/audit/export' + qs(f)))}>Excel</Button>
      </form>
    } bodyClass="flex flex-col gap-2">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <DataTable rows={rows} rowKey={(r) => r.Id} compact empty="No entries."
          columns={[
            { key: 'When', header: 'When' }, { key: 'UserName', header: 'User' }, { key: 'Role', header: 'Role' }, { key: 'Action', header: 'Action' },
            { key: 'Path', header: 'Call', className: 'font-mono text-[11px]' },
            { key: 'Details', header: 'Details', render: (r) => <span className={`block max-w-[40rem] truncate ${r.Details.startsWith('FAILED') ? 'text-red-700' : ''}`} title={r.Details}>{r.Details}</span> },
            { key: 'Ip', header: 'IP' },
          ]} />
      </div>
      <div className="text-xs text-slate-500">{rows.length} entr{rows.length === 1 ? 'y' : 'ies'} (max. 5000). Every change in this program and the employee portal / app is logged, and administrator logins (failed ones too). Passwords and pictures are never logged.</div>
    </Page>
  );
}

// ------------------------------------------------------------------ notifications and announcements

interface Note_ { Id: number; Title: string; Body: string | null; Link: string | null; IsRead: boolean; When: string }

const LINKS: Record<string, string> = { leave: '/leave', requests: '/portal-admin', team: '/portal-admin' };

export function Notifications() {
  const app = useApp();
  const navigate = useNavigate();
  const [data, setData] = useState<{ unread: number; items: Note_[] }>({ unread: 0, items: [] });
  const [depts, setDepts] = useState<any[]>([]);
  const [msg, setMsg] = useState({ title: '', body: '', departmentId: '' });
  const load = useCallback(() => api.get('/notifications').then(setData), []);
  useEffect(() => {
    app.run(load);
    api.get('/departments').then((r) => setDepts([...r.departments].sort((a: any, b: any) => a.Name.localeCompare(b.Name)))).catch(() => {});
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (n: Note_) => {
    if (!n.IsRead) await api.post('/notifications/read', { ids: [n.Id] }).catch(() => {});
    window.dispatchEvent(new Event('zk:notifications'));
    if (n.Link && LINKS[n.Link]) navigate(LINKS[n.Link]); else load();
  };
  const readAll = async () => { if (await app.run(() => api.post('/notifications/read', { all: true }))) { window.dispatchEvent(new Event('zk:notifications')); load(); } };
  const send = async () => {
    const r = await app.run(() => api.post('/notifications/broadcast', { ...msg, departmentId: msg.departmentId || null }));
    if (r) { setMsg({ title: '', body: '', departmentId: '' }); await app.alert(r.message); }
  };

  return (
    <Page title="Notifications" icon="info" toolbar={<Button icon="check" disabled={!data.unread} onClick={readAll}>Mark all read ({data.unread})</Button>}>
      <div className="grid max-w-6xl gap-4 xl:grid-cols-3">
        <Card title="For HR (new requests)" className="xl:col-span-2">
          <ul className="max-h-[65vh] divide-y divide-slate-100 overflow-auto scroll-thin">
            {data.items.map((n) => (
              <li key={n.Id}>
                <button type="button" onClick={() => open(n)} className={`flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-brand-50 ${n.IsRead ? '' : 'bg-amber-50/60'}`}>
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.IsRead ? 'bg-transparent' : 'bg-amber-500'}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13px] ${n.IsRead ? '' : 'font-semibold'}`}>{n.Title}</span>
                    {n.Body && <span className="block text-xs text-slate-500">{n.Body}</span>}
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-400">{n.When}</span>
                </button>
              </li>
            ))}
            {!data.items.length && <li className="px-3 py-8 text-center text-slate-400">No notifications.</li>}
          </ul>
        </Card>
        <Card title="Send an announcement">
          <div className="space-y-3 p-4">
            <Field label="To">
              <Select value={msg.departmentId} onChange={(e) => setMsg({ ...msg, departmentId: e.target.value })}>
                <option value="">All active employees</option>
                {depts.map((d) => <option key={d.Id} value={d.Id}>{d.Name} (with sub-departments)</option>)}
              </Select>
            </Field>
            <Field label="Title *"><Input value={msg.title} maxLength={150} onChange={(e) => setMsg({ ...msg, title: e.target.value })} /></Field>
            <Field label="Message"><TextArea rows={4} maxLength={500} value={msg.body} onChange={(e) => setMsg({ ...msg, body: e.target.value })} /></Field>
            <Button variant="primary" icon="upload" disabled={!msg.title.trim()} onClick={send}>Send</Button>
            <Note>Employees see it under the bell in the portal (/me) and in the mobile app.</Note>
          </div>
        </Card>
      </div>
    </Page>
  );
}
