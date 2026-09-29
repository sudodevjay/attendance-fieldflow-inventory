/** Employee window tabs of the web HR data: HR Profile (reporting manager, emergency, bank, statutory), Salary Structure, Documents. */
import { useEffect, useRef, useState } from 'react';
import { api, getToken } from '../api';
import { useApp } from '../app';
import { DataTable } from '../DataTable';
import { Button, Check, Field, Input, Note, Select } from '../ui';

export interface Profile {
  ReportingManagerId: number | null; ReportingManager?: string;
  EmergencyName: string; EmergencyRelation: string; EmergencyPhone: string; BloodGroup: string; MaritalStatus: string; PersonalEmail: string;
  Pan: string; Aadhaar: string; Uan: string; PfNo: string; EsiNo: string; BankName: string; BankAccount: string; BankIfsc: string; AccountHolder: string;
  PfApplicable: boolean; EsiApplicable: boolean; PtApplicable: boolean; TdsMonthly: number;
}

export const EMPTY_PROFILE: Profile = {
  ReportingManagerId: null, EmergencyName: '', EmergencyRelation: '', EmergencyPhone: '', BloodGroup: '', MaritalStatus: '', PersonalEmail: '',
  Pan: '', Aadhaar: '', Uan: '', PfNo: '', EsiNo: '', BankName: '', BankAccount: '', BankIfsc: '', AccountHolder: '',
  PfApplicable: false, EsiApplicable: false, PtApplicable: false, TdsMonthly: 0,
};

export interface SalaryRow { ComponentId: number; Name: string; Kind: string; Calc: string; Value: number; Amount: number | null; Calculated: number }
export interface Doc { Id: number; Title: string; FileName: string; SizeBytes: number; UploadedBy: string | null; UploadedAt: string }

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <fieldset className="rounded-md border border-slate-200 p-3">
    <legend className="px-1 text-xs font-semibold text-brand-900">{title}</legend>
    <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 md:grid-cols-3">{children}</div>
  </fieldset>
);

export function HrProfileTab({ employeeId, value, onChange }: { employeeId: number; value: Profile; onChange: (p: Profile) => void }) {
  const [people, setPeople] = useState<{ Id: number; EnrollNo: string; Name: string }[]>([]);
  useEffect(() => { api.get('/employees/options?active=1').then(setPeople).catch(() => {}); }, []);
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => onChange({ ...value, [k]: v });
  const text = (k: keyof Profile, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field label={label}><Input value={String(value[k] ?? '')} onChange={(e) => set(k, e.target.value as never)} {...props} /></Field>
  );
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Section title="Reporting">
        <Field label="Reporting Manager" className="col-span-2" hint="Approves this employee's leave and requests in the portal / app.">
          <Select value={value.ReportingManagerId ?? 0} onChange={(e) => set('ReportingManagerId', +e.target.value || null)}>
            <option value={0}>(none — department manager)</option>
            {people.filter((p) => p.Id !== employeeId).map((p) => <option key={p.Id} value={p.Id}>{p.EnrollNo} - {p.Name}</option>)}
          </Select>
        </Field>
        <Field label="Marital Status">
          <Select value={value.MaritalStatus} onChange={(e) => set('MaritalStatus', e.target.value)}>
            <option value="" /><option>Single</option><option>Married</option><option>Divorced</option><option>Widowed</option>
          </Select>
        </Field>
        <Field label="Blood Group">
          <Select value={value.BloodGroup} onChange={(e) => set('BloodGroup', e.target.value)}>
            <option value="" />{['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => <option key={b}>{b}</option>)}
          </Select>
        </Field>
        {text('PersonalEmail', 'Personal Email', { type: 'email' })}
      </Section>
      <Section title="Emergency Contact">
        {text('EmergencyName', 'Name')}
        {text('EmergencyRelation', 'Relation')}
        {text('EmergencyPhone', 'Phone', { inputMode: 'tel' })}
      </Section>
      <Section title="Bank Account (salary transfer)">
        {text('AccountHolder', 'Account Holder')}
        {text('BankName', 'Bank')}
        {text('BankAccount', 'Account No', { inputMode: 'numeric' })}
        {text('BankIfsc', 'IFSC', { placeholder: 'SBIN0001234' })}
      </Section>
      <Section title="Statutory">
        {text('Pan', 'PAN', { placeholder: 'ABCDE1234F' })}
        {text('Aadhaar', 'Aadhaar', { inputMode: 'numeric', maxLength: 12 })}
        {text('Uan', 'UAN', { inputMode: 'numeric', maxLength: 12 })}
        {text('PfNo', 'PF No')}
        {text('EsiNo', 'ESI No')}
        <Field label="Monthly TDS (₹)"><Input type="number" min={0} step={100} value={value.TdsMonthly} onChange={(e) => set('TdsMonthly', +e.target.value)} /></Field>
        <div className="col-span-2 flex flex-wrap gap-4 md:col-span-3">
          <Check label="PF applicable" checked={value.PfApplicable} onChange={(v) => set('PfApplicable', v)} />
          <Check label="ESI applicable" checked={value.EsiApplicable} onChange={(v) => set('EsiApplicable', v)} />
          <Check label="Professional Tax" checked={value.PtApplicable} onChange={(v) => set('PtApplicable', v)} />
        </div>
      </Section>
      <div className="xl:col-span-2"><Note>PF / ESI / PT are deducted only when they are also turned on in Payroll Setup. Saved with the employee (Save button).</Note></div>
    </div>
  );
}

const inr = (v: number) => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rule = (r: SalaryRow) => (r.Calc === 'PctGross' ? `${r.Value}% of salary` : r.Calc === 'PctBasic' ? `${r.Value}% of Basic` : r.Calc === 'Fixed' ? `₹ ${inr(r.Value)} fixed` : 'rest of the salary');

export function SalaryTab({ rows, salary, onChange }: { rows: SalaryRow[]; salary: number; onChange: (rows: SalaryRow[]) => void }) {
  const set = (id: number, v: string) => onChange(rows.map((r) => (r.ComponentId === id ? { ...r, Amount: v === '' ? null : +v } : r)));
  const earn = rows.filter((r) => r.Kind === 'Earning');
  return (
    <div className="max-w-3xl space-y-3">
      <div className="overflow-hidden rounded-md border border-slate-200">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-100 text-xs text-slate-600">
            <tr><th className="px-2 py-1.5 text-left">Component</th><th className="px-2 text-left">Type</th><th className="px-2 text-left">Company rule</th>
              <th className="px-2 text-right">Calculated / month</th><th className="w-40 px-2 text-left">Own amount</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ComponentId} className="border-t border-slate-100">
                <td className="px-2 py-1 font-medium">{r.Name}</td>
                <td className={`px-2 ${r.Kind === 'Deduction' ? 'text-red-700' : 'text-emerald-700'}`}>{r.Kind}</td>
                <td className="px-2 text-slate-600">{rule(r)}</td>
                <td className="px-2 text-right tabular-nums">{inr(r.Calculated)}</td>
                <td className="px-2 py-1"><Input type="number" min={0} step={100} placeholder="(rule)" value={r.Amount ?? ''} onChange={(e) => set(r.ComponentId, e.target.value)} /></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="px-2 py-4 text-center text-slate-400">No salary components. Add them in Payroll Setup.</td></tr>}
          </tbody>
        </table>
      </div>
      <Note>
        {`Monthly salary ₹ ${inr(salary)} is split into ${earn.map((r) => r.Name).join(', ') || 'one line'}. ` +
          'Leave "Own amount" empty to use the company rule; the "rest of the salary" component takes what is left so the earnings add up to the salary. ' +
          'Calculated amounts are shown for the saved salary; absent / late days reduce all earnings in the same ratio.'}
      </Note>
    </div>
  );
}

const size = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);

export function DocumentsTab({ employeeId }: { employeeId: number }) {
  const app = useApp();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [title, setTitle] = useState('');
  const [sel, setSel] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const load = () => api.get(`/employees/${employeeId}/documents`).then(setDocs);
  useEffect(() => { if (employeeId) app.run(load); }, [employeeId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!employeeId) return <Note>Save the employee first, then add documents.</Note>;

  const add = async (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('title', title);
    fd.append('file', file);
    setBusy(true);
    const r = await app.run(async () => {
      const res = await fetch(`/api/employees/${employeeId}/documents`, { method: 'POST', body: fd, headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
      return res.json();
    });
    setBusy(false);
    if (ref.current) ref.current.value = '';
    if (r) { setTitle(''); await load(); }
  };
  const open = (d: Doc) => window.open(`/api/documents/${d.Id}?inline=1&token=${encodeURIComponent(getToken())}`, '_blank', 'noopener');
  const del = async () => {
    const d = docs.find((x) => x.Id === sel[0]);
    if (!d || !(await app.confirm(`Delete the document "${d.Title}"?`))) return;
    if (await app.run(() => api.del(`/documents/${d.Id}`))) { setSel([]); await load(); }
  };

  return (
    <div className="max-w-4xl space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Title (e.g. Aadhaar, Offer Letter)" className="w-72"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Button icon="upload" variant="primary" busy={busy} onClick={() => ref.current?.click()}>Upload file…</Button>
        <Button icon="search" disabled={!sel.length} onClick={() => open(docs.find((x) => x.Id === sel[0])!)}>Open</Button>
        <Button icon="trash" variant="danger" disabled={!sel.length} onClick={del}>Delete</Button>
        <input ref={ref} type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.txt" onChange={(e) => add(e.target.files?.[0])} />
      </div>
      <div className="flex h-56 flex-col overflow-hidden rounded-md border border-slate-200">
        <DataTable rows={docs} rowKey={(d) => d.Id} selected={sel} onSelect={(k) => setSel(k as number[])} onDoubleClick={open} compact empty="No documents."
          columns={[
            { key: 'Title', header: 'Title' }, { key: 'FileName', header: 'File' }, { key: 'SizeBytes', header: 'Size', align: 'right', render: (d) => size(d.SizeBytes) },
            { key: 'UploadedBy', header: 'Uploaded by' }, { key: 'UploadedAt', header: 'Uploaded' },
          ]} />
      </div>
      <p className="text-xs text-slate-500">PDF, pictures, Word, Excel or text, up to 5 MB. The employee sees these in the portal / app (Documents) and can add their own.</p>
    </div>
  );
}
