/** Leave & Holidays: leave entries (approve / reject with quota warning), leave balance, holidays, leave types. */
import { useCallback, useEffect, useState } from 'react';
import { api, isoDate } from '../api';
import { useApp } from '../app';
import { DataTable } from '../DataTable';
import { Button, Check, Field, Input, Modal, Note, Page, Select, StatusBadge, Tabs, TextArea } from '../ui';

type Tab = 'entries' | 'balance' | 'holidays' | 'types';

export function Leave() {
  const app = useApp();
  const [year, setYear] = useState(new Date().getFullYear());
  const [tab, setTab] = useState<Tab>('entries');
  const [entries, setEntries] = useState<any[]>([]);
  const [balance, setBalance] = useState<any>(null);
  const [holidays, setHolidays] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [emps, setEmps] = useState<any[]>([]);
  const [sel, setSel] = useState<number[]>([]);
  const [dialog, setDialog] = useState<{ kind: 'leave' | 'holiday' | 'type'; row: any } | null>(null);

  const load = useCallback(async () => {
    const [e, b, h, t, o] = await Promise.all([
      api.get(`/leave/entries?year=${year}`), api.get(`/leave/balance?year=${year}`), api.get(`/leave/holidays?year=${year}`),
      api.get('/leave/types'), api.get('/employees/options'),
    ]);
    setEntries(e); setBalance(b); setHolidays(h); setTypes(t); setEmps(o);
  }, [year]);
  useEffect(() => { app.run(load); }, [load, app.dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSel([]); }, [tab]);

  const decide = async (decision: 'Approved' | 'Rejected') => {
    if (!sel.length) return app.alert('Select a leave request first.');
    const word = decision === 'Approved' ? 'Approve' : 'Reject';
    const last = (await api.get('/leave/last-approver')).name;
    const by = await app.prompt(`${word} ${sel.length} leave request(s).\n${decision} by (name)?`, last, `${word} leave`);
    if (!by) return;
    let r = await app.run(() => api.post('/leave/decide', { ids: sel, decision, by }));
    // Quota warnings: ask for each, then approve the confirmed ones.
    const confirmed: number[] = [];
    for (const w of r?.warnings ?? []) if (await app.confirm(`${w.text}\n\nSave anyway?`)) confirmed.push(w.id);
    if (confirmed.length) r = await app.run(() => api.post('/leave/decide', { ids: confirmed, decision, by, confirmed }));
    await load();
    app.dataChanged();
  };

  const del = async (what: 'entries' | 'holidays') => {
    if (!sel.length || !(await app.confirm(`Delete ${sel.length} record(s)?`))) return;
    if (await app.run(() => api.post(`/leave/${what === 'entries' ? 'entries' : 'holidays'}/delete`, { ids: sel }))) { setSel([]); await load(); app.dataChanged(); }
  };

  const pick = (rows: any[]) => rows.find((r) => r.Id === sel[0]);
  const bar = (children: React.ReactNode) => <div className="flex flex-wrap items-center gap-2 py-2">{children}</div>;

  return (
    <Page title="Leave & Holidays" icon="flag" bodyClass="flex flex-col"
      toolbar={<label className="flex items-center gap-1.5">Year <Input type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(+e.target.value)} className="w-24" /></label>}>
      <Tabs tabs={[{ key: 'entries', label: 'Leave Entries' }, { key: 'balance', label: 'Leave Balance' }, { key: 'holidays', label: 'Holidays' }, { key: 'types', label: 'Leave Types' }]}
        value={tab} onChange={setTab} />

      {tab === 'entries' && <>
        {bar(<>
          <Button variant="primary" icon="add" onClick={() => setDialog({ kind: 'leave', row: null })}>Add Leave</Button>
          <Button icon="edit" disabled={!pick(entries)} onClick={() => setDialog({ kind: 'leave', row: pick(entries) })}>Edit</Button>
          <Button variant="success" icon="check" onClick={() => decide('Approved')}>Approve</Button>
          <Button icon="close" onClick={() => decide('Rejected')}>Reject</Button>
          <Button variant="danger" icon="trash" onClick={() => del('entries')}>Delete</Button>
        </>)}
        <Grid>
          <DataTable rows={entries} rowKey={(r) => r.Id} selected={sel} onSelect={(k) => setSel(k as number[])} onDoubleClick={(r) => setDialog({ kind: 'leave', row: r })}
            empty="No leave in this year."
            columns={[
              { key: 'Status', header: 'Status', align: 'center', render: (r) => <StatusBadge value={r.Status} /> },
              { key: 'EnrollNo', header: 'Emp ID' }, { key: 'Name', header: 'Name' }, { key: 'Type', header: 'Type' },
              { key: 'From', header: 'From', value: (r) => r.FromIso }, { key: 'To', header: 'To', value: (r) => r.ToIso }, { key: 'Days', header: 'Days', align: 'right' },
              { key: 'HalfDay', header: 'Half Day', render: (r) => (r.HalfDay ? 'Yes' : '') }, { key: 'AppliedOn', header: 'Applied On' },
              { key: 'ApprovedBy', header: 'Approved By' }, { key: 'DecidedOn', header: 'Decided On' }, { key: 'Reason', header: 'Reason' },
            ]} />
        </Grid>
      </>}

      {tab === 'balance' && <>
        {bar(<Button variant="success" icon="download" onClick={() => app.run(() => api.download(`/leave/balance/export?year=${year}`))}>Excel</Button>)}
        <Grid>
          {balance && <DataTable compact rows={balance.rows.map((r: any[], i: number) => ({ i, r }))} rowKey={(x: any) => x.i}
            columns={balance.columns.map((c: string, ci: number) => ({ key: String(ci), header: c, value: (x: any) => x.r[ci], render: (x: any) => String(x.r[ci] ?? '') }))} />}
        </Grid>
      </>}

      {tab === 'holidays' && <>
        {bar(<>
          <Button variant="primary" icon="add" onClick={() => setDialog({ kind: 'holiday', row: null })}>Add Holiday</Button>
          <Button icon="edit" disabled={!pick(holidays)} onClick={() => setDialog({ kind: 'holiday', row: pick(holidays) })}>Edit</Button>
          <Button variant="danger" icon="trash" onClick={() => del('holidays')}>Delete</Button>
        </>)}
        <Grid>
          <DataTable rows={holidays} rowKey={(r) => r.Id} selected={sel} onSelect={(k) => setSel(k as number[])} onDoubleClick={(r) => setDialog({ kind: 'holiday', row: r })}
            empty="No holidays in this year."
            columns={[{ key: 'Date', header: 'Date', value: (r) => r.DateIso }, { key: 'Day', header: 'Day' }, { key: 'Name', header: 'Holiday' }]} />
        </Grid>
      </>}

      {tab === 'types' && <>
        {bar(<>
          <Button variant="primary" icon="add" onClick={() => setDialog({ kind: 'type', row: null })}>Add Type</Button>
          <Button icon="edit" disabled={!pick(types)} onClick={() => setDialog({ kind: 'type', row: pick(types) })}>Edit</Button>
        </>)}
        <Grid>
          <DataTable rows={types} rowKey={(r) => r.Id} selected={sel} onSelect={(k) => setSel(k as number[])} onDoubleClick={(r) => setDialog({ kind: 'type', row: r })}
            columns={[
              { key: 'Code', header: 'Code' }, { key: 'Name', header: 'Name' }, { key: 'IsPaid', header: 'Paid', render: (t) => (t.IsPaid ? 'Yes' : 'No') },
              { key: 'YearlyQuota', header: 'Quota / Year', render: (t) => (t.YearlyQuota > 0 ? String(Math.round(t.YearlyQuota * 10) / 10) : 'No limit') },
            ]} />
        </Grid>
      </>}

      {dialog?.kind === 'leave' && <LeaveDialog row={dialog.row} emps={emps} types={types} onClose={() => setDialog(null)} onSaved={() => { load(); app.dataChanged(); }} />}
      {dialog?.kind === 'holiday' && <HolidayDialog row={dialog.row} onClose={() => setDialog(null)} onSaved={() => { load(); app.dataChanged(); }} />}
      {dialog?.kind === 'type' && <TypeDialog row={dialog.row} onClose={() => setDialog(null)} onSaved={() => { load(); app.dataChanged(); }} />}
    </Page>
  );
}

const Grid = ({ children }: { children: React.ReactNode }) => (
  <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">{children}</div>
);

const STATUSES = ['Pending', 'Approved', 'Rejected'];

function LeaveDialog({ row, emps, types, onClose, onSaved }: { row: any; emps: any[]; types: any[]; onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const [f, setF] = useState(() => ({
    Id: row?.Id ?? 0, EmployeeId: String(row?.EmployeeId ?? ''), LeaveTypeId: String(row?.LeaveTypeId ?? ''), FromDate: row?.FromIso ?? isoDate(),
    ToDate: row?.ToIso ?? isoDate(), IsHalfDay: !!row?.HalfDay, AppliedOn: row ? row.AppliedOnIso : isoDate(), Status: row?.Status ?? 'Pending',
    ApprovedBy: row?.ApprovedBy ?? '', Reason: row?.Reason ?? '',
  }));
  useEffect(() => {
    if (!row) api.get('/leave/last-approver').then((r) => setF((x) => ({ ...x, ApprovedBy: x.ApprovedBy || r.name }))).catch(() => {});
  }, [row]);
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const body = { ...f, EmployeeId: +f.EmployeeId, LeaveTypeId: +f.LeaveTypeId };
    let r = await app.run(() => api.post('/leave/entries', body));
    if (r?.needsConfirm) {
      if (!(await app.confirm(r.needsConfirm))) return;
      r = await app.run(() => api.post('/leave/entries', { ...body, confirmQuota: true }));
    }
    if (r?.ok) { onSaved(); onClose(); }
  };
  const activeEmps = emps.filter((e) => e.IsActive || e.Id === row?.EmployeeId);
  return (
    <Modal title={row ? 'Edit Leave' : 'Add Leave'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>OK</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Employee" className="col-span-2">
          <Select value={f.EmployeeId} onChange={(e) => set('EmployeeId', e.target.value)}>
            <option value="">Select…</option>
            {activeEmps.map((e) => <option key={e.Id} value={e.Id}>{e.EnrollNo} - {e.Name}</option>)}
          </Select>
        </Field>
        <Field label="Leave type" className="col-span-2">
          <Select value={f.LeaveTypeId} onChange={(e) => set('LeaveTypeId', e.target.value)}>
            <option value="">Select…</option>
            {types.map((t) => <option key={t.Id} value={t.Id}>{t.Code} - {t.Name}</option>)}
          </Select>
        </Field>
        <Field label="From"><Input type="date" value={f.FromDate} onChange={(e) => set('FromDate', e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={f.ToDate} onChange={(e) => set('ToDate', e.target.value)} /></Field>
        <div className="col-span-2"><Check label="Half day (single date)" checked={f.IsHalfDay} onChange={(v) => set('IsHalfDay', v)} /></div>
        <Field label="Applied on (email / request date)"><Input type="date" value={f.AppliedOn} onChange={(e) => set('AppliedOn', e.target.value)} /></Field>
        <Field label="Status"><Select value={f.Status} onChange={(e) => set('Status', e.target.value)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <Field label="Approved / Rejected by" className="col-span-2">
          <Input value={f.ApprovedBy} disabled={f.Status === 'Pending'} onChange={(e) => set('ApprovedBy', e.target.value)} />
        </Field>
        <Field label="Reason / remark" className="col-span-2"><TextArea rows={2} value={f.Reason} onChange={(e) => set('Reason', e.target.value)} /></Field>
      </div>
      <div className="mt-3"><Note>Only 'Approved' leave counts for attendance, salary and quota. Days of a 'Pending' leave count as absent until it is approved.</Note></div>
    </Modal>
  );
}

function HolidayDialog({ row, onClose, onSaved }: { row: any; onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const [f, setF] = useState({ Id: row?.Id ?? 0, Date: row?.DateIso ?? isoDate(), Name: row?.Name ?? '' });
  const save = async () => { if (await app.run(() => api.post('/leave/holidays', f))) { onSaved(); onClose(); } };
  return (
    <Modal title={row ? 'Edit Holiday' : 'Add Holiday'} onClose={onClose} width="max-w-sm" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>OK</Button></>}>
      <div className="space-y-3">
        <Field label="Date"><Input type="date" value={f.Date} onChange={(e) => setF({ ...f, Date: e.target.value })} /></Field>
        <Field label="Holiday name *"><Input value={f.Name} onChange={(e) => setF({ ...f, Name: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function TypeDialog({ row, onClose, onSaved }: { row: any; onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const [f, setF] = useState({ Id: row?.Id ?? 0, Code: row?.Code ?? '', Name: row?.Name ?? '', IsPaid: row?.IsPaid ?? true, YearlyQuota: row?.YearlyQuota ?? 0 });
  const save = async () => { if (await app.run(() => api.post('/leave/types', f))) { onSaved(); onClose(); } };
  return (
    <Modal title={row ? 'Edit Leave Type' : 'Add Leave Type'} onClose={onClose} width="max-w-sm" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>OK</Button></>}>
      <div className="space-y-3">
        <Field label="Code * (e.g. CL)"><Input value={f.Code} onChange={(e) => setF({ ...f, Code: e.target.value })} /></Field>
        <Field label="Name *"><Input value={f.Name} onChange={(e) => setF({ ...f, Name: e.target.value })} /></Field>
        <Check label="Paid leave (counted in Paid Days)" checked={f.IsPaid} onChange={(v) => setF({ ...f, IsPaid: v })} />
        <Field label="Yearly quota (days, 0 = no limit)"><Input type="number" min={0} max={366} step={0.5} value={f.YearlyQuota} onChange={(e) => setF({ ...f, YearlyQuota: +e.target.value })} /></Field>
        <Note>When the quota is used up, further leave of this type is counted as unpaid (LWP).</Note>
      </div>
    </Modal>
  );
}
