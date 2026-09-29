/** Payroll Setup: salary structure components, statutory deductions (PF / ESI / PT), advance recovery, comp-off validity. */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../app';
import { DataTable } from '../DataTable';
import { runAction } from '../nav';
import { Button, Card, Check, Field, Input, Modal, Note, Page, Select } from '../ui';

interface Component { Id: number; Name: string; Kind: 'Earning' | 'Deduction'; Calc: string; Value: number; IsBasic: boolean; SortOrder: number; IsActive: boolean }

const CALC: Record<string, string> = { PctGross: '% of monthly salary', PctBasic: '% of Basic', Fixed: 'Fixed amount (₹)', Balance: 'Rest of the salary' };
const NEW: Component = { Id: 0, Name: '', Kind: 'Earning', Calc: 'Fixed', Value: 0, IsBasic: false, SortOrder: 5, IsActive: true };

export function PayrollSetup() {
  const app = useApp();
  const [rows, setRows] = useState<Component[]>([]);
  const [sel, setSel] = useState<number[]>([]);
  const [edit, setEdit] = useState<Component | null>(null);
  const [stat, setStat] = useState<any>(null);
  const [co, setCo] = useState<number>(90);

  const load = useCallback(async () => {
    setRows(await api.get('/payroll/components'));
    setStat(await api.get('/payroll/statutory'));
    setCo((await api.get('/leave/comp-off-settings')).expiryDays);
  }, []);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = rows.find((r) => r.Id === sel[0]);
  const del = async () => {
    if (!current || !(await app.confirm(`Delete the component "${current.Name}"? Employees' own amounts for it are removed too.`))) return;
    if (await app.run(() => api.del(`/payroll/components/${current.Id}`))) { setSel([]); await load(); }
  };
  const say = async (p: () => Promise<any>) => { const r = await app.run(p); if (r?.message) await app.alert(r.message); };
  const s = (k: string, v: unknown) => setStat((x: any) => ({ ...x, [k]: v }));
  const num = (k: string, label: string, step = 1) => (
    <Field label={label}><Input type="number" min={0} step={step} value={stat[k]} onChange={(e) => s(k, +e.target.value)} /></Field>
  );

  return (
    <Page title="Payroll Setup" icon="rule" toolbar={
      <>
        <Button icon="rule" onClick={() => runAction('salaryRule')}>Salary Rule (late cut, OT)…</Button>
        <span className="text-xs text-slate-500">Employee-wise amounts, PF / ESI applicable, TDS, bank: Employees → HR Profile / Salary Structure.</span>
      </>
    }>
      <div className="grid max-w-6xl gap-4 xl:grid-cols-2">
        <Card title="Salary structure (components)" className="xl:col-span-2" actions={
          <div className="flex gap-1.5">
            <Button icon="add" variant="primary" onClick={() => setEdit({ ...NEW })}>Add</Button>
            <Button icon="edit" disabled={!current} onClick={() => current && setEdit({ ...current })}>Edit</Button>
            <Button icon="trash" variant="danger" disabled={!current} onClick={del}>Delete</Button>
          </div>
        }>
          <div className="flex h-64 flex-col">
            <DataTable rows={rows} rowKey={(r) => r.Id} selected={sel} onSelect={(k) => setSel(k as number[])} onDoubleClick={(r) => setEdit({ ...r })} compact
              columns={[
                { key: 'SortOrder', header: '#', align: 'right' }, { key: 'Name', header: 'Component', render: (r) => <>{r.Name}{r.IsBasic && <b className="ml-1 text-[11px] text-brand-700">(Basic)</b>}</> },
                { key: 'Kind', header: 'Type', render: (r) => <span className={r.Kind === 'Deduction' ? 'text-red-700' : 'text-emerald-700'}>{r.Kind}</span> },
                { key: 'Calc', header: 'Calculated as', render: (r) => CALC[r.Calc] ?? r.Calc },
                { key: 'Value', header: 'Value', align: 'right', render: (r) => (r.Calc === 'Balance' ? '' : r.Calc === 'Fixed' ? r.Value.toLocaleString('en-IN') : `${r.Value}%`) },
                { key: 'IsActive', header: 'Active', render: (r) => (r.IsActive ? 'Yes' : <span className="text-red-600">No</span>) },
              ]} />
          </div>
          <div className="border-t border-slate-200 p-3">
            <Note>{'Earnings split the monthly salary: e.g. Basic 50% of salary, HRA 40% of Basic, Conveyance ₹1,600 fixed, Special Allowance = rest of the salary. ' +
              'The component marked Basic is the PF wage. Deductions (e.g. canteen, uniform) are taken every month. Absent / late days reduce the earnings in the same ratio.'}</Note>
          </div>
        </Card>

        {stat && (
          <Card title="Statutory deductions">
            <div className="space-y-4 p-4">
              <fieldset className="grid grid-cols-3 gap-3 rounded-md border border-slate-200 p-3">
                <legend className="px-1"><Check label="Provident Fund (PF)" checked={stat.pfEnabled} onChange={(v) => s('pfEnabled', v)} /></legend>
                {num('pfPct', 'Employee %', 0.5)}{num('pfEmployerPct', 'Employer %', 0.5)}{num('pfWageCap', 'Wage ceiling ₹ (0 = none)', 500)}
              </fieldset>
              <fieldset className="grid grid-cols-3 gap-3 rounded-md border border-slate-200 p-3">
                <legend className="px-1"><Check label="ESI" checked={stat.esiEnabled} onChange={(v) => s('esiEnabled', v)} /></legend>
                {num('esiPct', 'Employee %', 0.25)}{num('esiEmployerPct', 'Employer %', 0.25)}{num('esiCeiling', 'Salary up to ₹', 500)}
              </fieldset>
              <fieldset className="grid grid-cols-2 gap-3 rounded-md border border-slate-200 p-3">
                <legend className="px-1"><Check label="Professional Tax (PT)" checked={stat.ptEnabled} onChange={(v) => s('ptEnabled', v)} /></legend>
                {num('ptAmount', 'Amount per month ₹', 50)}{num('ptThreshold', 'When earned more than ₹', 500)}
              </fieldset>
              <Check label="Recover approved advances / loans from salary (installments from the month after approval)" checked={stat.advanceRecovery} onChange={(v) => s('advanceRecovery', v)} />
              <Note>{'PF = % of the earned Basic (up to the ceiling). ESI = % of earned salary + OT when the monthly salary is within the limit. ' +
                'Each employee needs "PF / ESI / Professional Tax applicable" ticked in HR Profile. TDS is a fixed monthly amount per employee.'}</Note>
              <Button variant="primary" icon="save" onClick={() => say(() => api.put('/payroll/statutory', stat))}>Save</Button>
            </div>
          </Card>
        )}

        <Card title="Comp-off">
          <div className="space-y-3 p-4">
            <Field label="A comp-off can be used within (days)" hint="Employees claim a comp-off for work on a holiday / weekly off (portal or app); once approved they apply leave of type CO.">
              <Input type="number" min={1} max={730} value={co} onChange={(e) => setCo(+e.target.value)} className="w-32" />
            </Field>
            <Button variant="primary" icon="save" onClick={() => say(() => api.put('/leave/comp-off-settings', { expiryDays: co }))}>Save</Button>
          </div>
        </Card>
      </div>
      {edit && <ComponentDialog value={edit} onClose={() => setEdit(null)} onSaved={load} />}
    </Page>
  );
}

function ComponentDialog({ value, onClose, onSaved }: { value: Component; onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const [f, setF] = useState(value);
  const set = <K extends keyof Component>(k: K, v: Component[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => { if (await app.run(() => api.post('/payroll/components', f))) { onSaved(); onClose(); } };
  return (
    <Modal title={f.Id ? 'Edit Component' : 'Add Component'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>OK</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name *" className="col-span-2"><Input value={f.Name} onChange={(e) => set('Name', e.target.value)} /></Field>
        <Field label="Type">
          <Select value={f.Kind} onChange={(e) => set('Kind', e.target.value as Component['Kind'])}><option>Earning</option><option>Deduction</option></Select>
        </Field>
        <Field label="Calculated as">
          <Select value={f.Calc} onChange={(e) => set('Calc', e.target.value)}>
            {Object.entries(CALC).filter(([k]) => f.Kind === 'Earning' || k !== 'Balance').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        {f.Calc !== 'Balance' && <Field label={f.Calc === 'Fixed' ? 'Amount (₹ per month)' : 'Percent'}><Input type="number" min={0} step={f.Calc === 'Fixed' ? 100 : 1} value={f.Value} onChange={(e) => set('Value', +e.target.value)} /></Field>}
        <Field label="Order on the slip"><Input type="number" value={f.SortOrder} onChange={(e) => set('SortOrder', +e.target.value)} /></Field>
        {f.Kind === 'Earning' && <div className="col-span-2"><Check label="This is the Basic (PF wage, base of '% of Basic')" checked={f.IsBasic} onChange={(v) => set('IsBasic', v)} /></div>}
        <div className="col-span-2"><Check label="Active" checked={f.IsActive} onChange={(v) => set('IsActive', v)} /></div>
      </div>
    </Modal>
  );
}
