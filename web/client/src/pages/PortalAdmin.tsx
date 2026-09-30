/** Employee Portal (administrator): requests from employees, employee logins / managers, portal settings. */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, getToken, qs } from '../api';
import { useApp } from '../app';
import { DataTable } from '../DataTable';
import { Button, Card, Check, Field, Input, Modal, Note, Page, Select, StatusBadge, Tabs } from '../ui';

type Tab = 'requests' | 'accounts' | 'settings';

export function PortalAdmin() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'requests');
  useEffect(() => { const t = params.get('tab') as Tab | null; if (t) setTab(t); }, [params]);
  return (
    <Page title="Employee Portal" icon="people" bodyClass="flex flex-col">
      <Tabs tabs={[{ key: 'requests', label: 'Employee Requests' }, { key: 'accounts', label: 'Employee Logins' }, { key: 'settings', label: 'Portal Settings' }]}
        value={tab} onChange={setTab} />
      {tab === 'requests' && <Requests initialType={params.get('type') ?? ''} />}
      {tab === 'accounts' && <Accounts />}
      {tab === 'settings' && <Settings />}
      <div className="mt-3 text-xs text-slate-500">
        Employees open <a className="text-brand-700 underline" href="/me" target="_blank" rel="noreferrer">{location.origin}/me</a> (or the mobile app) and log in with their AC No.
        Their leave requests appear in Leave / Holidays.
      </div>
    </Page>
  );
}

/** Labels of the profile fields an employee may ask to change. */
const FIELD_NAMES: Record<string, string> = {
  Phone: 'Mobile', Email: 'Email', HomeAddress: 'Address', EmergencyName: 'Emergency contact', EmergencyRelation: 'Relation', EmergencyPhone: 'Emergency phone',
  BloodGroup: 'Blood group', MaritalStatus: 'Marital status', PersonalEmail: 'Personal email', Pan: 'PAN', Aadhaar: 'Aadhaar', Uan: 'UAN',
  BankName: 'Bank', BankAccount: 'Account no', BankIfsc: 'IFSC', AccountHolder: 'Account holder',
};

function Requests({ initialType }: { initialType: string }) {
  const app = useApp();
  const [status, setStatus] = useState('Pending');
  const [type, setType] = useState(initialType);
  useEffect(() => setType(initialType), [initialType]);
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<number[]>([]);
  const [receipt, setReceipt] = useState<number | null>(null);
  const load = useCallback(() => api.get('/portal-admin/requests' + qs({ status, type })).then(setRows), [status, type]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (decision: 'Approved' | 'Rejected') => {
    if (!sel.length) return app.alert('Select requests first.');
    const last = (await api.get('/leave/last-approver')).name;
    const by = await app.prompt(`${decision === 'Approved' ? 'Approve' : 'Reject'} ${sel.length} request(s).\nBy (name)?`, last || app.user);
    if (!by) return;
    const r = await app.run(() => api.post('/portal-admin/requests/decide', { ids: sel, decision, by }));
    if (r) { await app.alert(r.message + (decision === 'Approved' ? '\n\nApproved regularisations were added to the AC Log, profile changes to the employee, comp-offs to the balance.' : '')); setSel([]); await load(); app.dataChanged(); }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 py-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36" aria-label="Status">
          <option value="">All</option><option>Pending</option><option>Approved</option><option>Rejected</option>
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value)} className="w-48" aria-label="Type">
          <option value="">All types</option><option value="Regularisation">Attendance regularisation</option><option value="Overtime">Overtime</option>
          <option value="CompOff">Comp-off</option><option value="Profile">Profile change</option><option value="Expense">Expense / reimbursement</option><option value="Advance">Advance / loan</option>
        </Select>
        <Button variant="success" icon="check" onClick={() => decide('Approved')}>Approve</Button>
        <Button icon="close" onClick={() => decide('Rejected')}>Reject</Button>
        <span className="text-xs text-slate-500">{rows.length} request(s)</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <DataTable rows={rows} rowKey={(r) => r.Id} selected={sel} onSelect={(k) => setSel(k as number[])} empty="No requests."
          columns={[
            { key: 'Status', header: 'Status', align: 'center', render: (r) => <StatusBadge value={r.Status} /> },
            { key: 'Type', header: 'Type', render: (r) => r.TypeName ?? r.Type }, { key: 'EnrollNo', header: 'Emp ID' }, { key: 'Name', header: 'Name' },
            { key: 'Date', header: 'Date', value: (r) => r.RequestDate }, { key: 'Time', header: 'Time' }, { key: 'Category', header: 'Category' },
            { key: 'AmountText', header: 'Amount', align: 'right', value: (r) => r.Amount,
              render: (r) => (r.Type === 'Overtime' ? `${r.Amount} h` : r.Type === 'CompOff' ? `${r.Amount} day` : r.AmountText) },
            { key: 'Installments', header: 'Months', align: 'right' },
            { key: 'Details', header: 'Details', render: (r) => (r.Changes
              ? <span className="text-xs">{Object.entries(r.Changes as Record<string, string>).map(([k, v]) => <span key={k} className="mr-2 inline-block"><b>{FIELD_NAMES[k] ?? k}:</b> {v || '(empty)'}</span>)}</span>
              : r.Details) },
            { key: 'HasAttachment', header: 'Receipt', render: (r) => (r.HasAttachment ? <button type="button" className="text-brand-700 underline" onClick={(e) => { e.stopPropagation(); setReceipt(r.Id); }}>View</button> : '') },
            { key: 'Applied', header: 'Applied', value: (r) => r.CreatedAt }, { key: 'FirstApprovedBy', header: 'Team Lead' }, { key: 'DecidedBy', header: 'Decided By' }, { key: 'DecidedOn', header: 'Decided On' },
          ]} />
      </div>
      {receipt !== null && (
        <Modal title="Receipt" onClose={() => setReceipt(null)} width="max-w-2xl">
          <img src={`/api/portal-admin/requests/${receipt}/attachment?token=${getToken()}`} alt="Receipt" className="mx-auto max-h-[60vh]" />
        </Modal>
      )}
    </>
  );
}

function Accounts() {
  const app = useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<number[]>([]);
  const [made, setMade] = useState<any[] | null>(null);
  const load = useCallback(() => api.get('/portal-admin/accounts').then(setRows), []);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async (own: boolean) => {
    if (!sel.length) return app.alert('Select employees first.');
    let password = '';
    if (own) {
      const p = await app.prompt('Password for the selected employee(s) (at least 6 characters). They must change it at the first login.', '', 'Set password');
      if (!p) return;
      password = p;
    }
    const r = await app.run(() => api.post('/portal-admin/accounts', { ids: sel, password }));
    if (r) { setMade(r.accounts); await load(); }
  };
  const remove = async () => {
    if (!sel.length || !(await app.confirm(`Remove the portal login of ${sel.length} employee(s)? They can no longer log in.`))) return;
    if (await app.run(() => api.post('/portal-admin/accounts/delete', { ids: sel }))) await load();
  };
  const setRole = async (r: any, role: string) => {
    if (await app.run(() => api.put(`/portal-admin/accounts/${r.Id}`, { role }))) await load();
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 py-2">
        <Button variant="primary" icon="lock" onClick={() => create(false)}>Create / reset login (random password)</Button>
        <Button icon="edit" onClick={() => create(true)}>Set password…</Button>
        <Button variant="danger" icon="trash" onClick={remove}>Remove login</Button>
        <span className="text-xs text-slate-500">Select employees (Ctrl / Shift for several). Role: a Team Lead sees everybody below them (Employees → HR Profile → Reporting Manager) and approves first; a Manager sees everybody below them (team leads' teams too) and decides. A manager nobody reports to looks after their department and its sub-departments.</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <DataTable rows={rows} rowKey={(r) => r.Id} selected={sel} onSelect={(k) => setSel(k as number[])}
          columns={[
            { key: 'EnrollNo', header: 'AC No (login)' }, { key: 'Name', header: 'Name' }, { key: 'Department', header: 'Department' },
            { key: 'HasAccount', header: 'Login', render: (r) => (r.HasAccount ? <StatusBadge value="Approved" /> : <span className="text-slate-400">none</span>) },
            {
              key: 'Role', header: 'Role', render: (r) => r.HasAccount && (
                <span onClick={(e) => e.stopPropagation()}>
                  <Select value={r.Role || (r.IsManager ? 'Manager' : 'Employee')} disabled={!app.can('portal', true) || app.role === 'HOD'} onChange={(e) => setRole(r, e.target.value)} className="py-0.5 text-xs">
                    <option value="Employee">Employee</option><option value="TeamLead">Team Lead</option><option value="Manager">Manager</option>
                  </Select>
                </span>
              ),
            },
            { key: 'MustChange', header: 'Password', render: (r) => (r.HasAccount ? (r.MustChange ? 'temporary (must change)' : 'set by employee') : '') },
            { key: 'LastLogin', header: 'Last login' },
            { key: 'IsActive', header: 'Active', render: (r) => (r.IsActive ? '' : <span className="text-red-600">Inactive</span>) },
          ]} />
      </div>
      {made && (
        <Modal title="Employee logins" onClose={() => setMade(null)} width="max-w-xl" footer={<Button variant="primary" onClick={() => setMade(null)}>Done</Button>}>
          <Note tone="warn">Give each employee their password now: it is not shown again. They log in with the AC No and must choose a new password.</Note>
          <table className="mt-3 w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">AC No</th><th>Name</th><th>Password</th></tr></thead>
            <tbody>{made.map((a) => <tr key={a.EnrollNo} className="border-t border-slate-100"><td className="py-1.5">{a.EnrollNo}</td><td>{a.Name}</td><td className="font-mono font-semibold">{a.Password}</td></tr>)}</tbody>
          </table>
          <Button className="mt-3" icon="check" onClick={() => navigator.clipboard?.writeText(made.map((a) => `${a.EnrollNo}\t${a.Name}\t${a.Password}`).join('\n')).then(() => app.alert('Copied.'))}>Copy</Button>
        </Modal>
      )}
    </>
  );
}

function Settings() {
  const app = useApp();
  const [f, setF] = useState<any>(null);
  useEffect(() => { api.get('/portal-admin/settings').then(setF); }, []);
  if (!f) return null;
  return (
    <div className="max-w-xl py-3">
      <Card title="Portal Settings">
        <div className="space-y-3 p-4">
          <Field label="Office name (shown at the bottom of the employee sidebar)"><Input value={f.officeName} placeholder="e.g. Head Office" onChange={(e) => setF({ ...f, officeName: e.target.value })} /></Field>
          <Check label="Employees may check in / out from the portal and the mobile app" checked={f.allowCheckIn} onChange={(v) => setF({ ...f, allowCheckIn: v })} />
          <Note>A portal check-in is saved as a manual punch with the remark "Self check-in (web / app)", so it is visible in the AC Log and can be deleted there.</Note>
          <Button variant="primary" icon="save" onClick={async () => { const r = await app.run(() => api.put('/portal-admin/settings', f)); if (r) await app.alert(r.message); }}>Save</Button>
        </div>
      </Card>
    </div>
  );
}
