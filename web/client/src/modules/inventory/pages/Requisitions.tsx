/** Requisitions: material requests of employees (portal) or made by the store for them; approve, reject, issue. */
import { useCallback, useEffect, useState } from 'react';
import { api, qs } from '../../../api';
import { useApp } from '../../../app';
import { DataTable } from '../../../DataTable';
import { Button, Field, Input, Modal, Note, Page, Select, Tabs, TextArea } from '../../../ui';
import { Badge, EmployeePicker, LineEditor, linesOut, newLine, qty, SiteSelect, useIdParam, useInv, type Line } from '../shared';

type Tab = 'Pending' | 'ToIssue' | '';

export function Requisitions() {
  const app = useApp();
  const { me } = useInv();
  const [tab, setTab] = useState<Tab>('Pending');
  const [rows, setRows] = useState<any[]>([]);
  const [open, clearOpen] = useIdParam();
  const [view, setView] = useState<number | null>(open);
  const [add, setAdd] = useState(false);
  const load = useCallback(() => api.get('/inventory/requisitions' + qs({ status: tab })).then(setRows), [tab]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page title="Requisitions (material requests)" icon="check" toolbar={
      <>
        {me.manage && <Button variant="primary" icon="add" onClick={() => setAdd(true)}>New requisition</Button>}
        <Button icon="refresh" onClick={() => app.run(load)}>Refresh</Button>
        <span className="text-xs text-slate-500">Employees ask for material in the portal (Store → Request material). {me.scoped ? 'You see the requisitions of your department.' : ''}</span>
      </>
    } bodyClass="flex flex-col">
      <Tabs tabs={[{ key: 'Pending', label: 'To approve' }, { key: 'ToIssue', label: 'Approved — to issue' }, { key: '', label: 'All' }]} value={tab} onChange={setTab} />
      <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <DataTable rows={rows} rowKey={(r) => r.Id} onDoubleClick={(r) => setView(r.Id)} empty="No requisitions here."
          columns={[
            { key: 'ReqNo', header: 'No' }, { key: 'CreatedAt', header: 'Date' },
            { key: 'Employee', header: 'Employee', render: (r) => `${r.EnrollNo ? r.EnrollNo + ' — ' : ''}${r.Employee ?? ''}` },
            { key: 'Department', header: 'Department' },
            { key: 'Items', header: 'Items', sortable: false, render: (r) => <span className="block max-w-80 truncate">{r.Lines.map((l: any) => `${l.Name} ×${qty(l.Qty)}`).join(', ')}</span> },
            { key: 'Site', header: 'Site' }, { key: 'Purpose', header: 'Purpose' }, { key: 'Warehouse', header: 'Store' },
            { key: 'Status', header: 'Status', render: (r) => <Badge value={r.Status} /> },
            { key: 'Source', header: 'From', render: (r) => (r.Source === 'portal' ? 'Employee' : 'Store') },
            { key: 'Open', header: '', sortable: false, render: (r) => <Button onClick={() => setView(r.Id)}>Open</Button> },
          ]} />
      </div>
      {add && <NewRequisition onClose={() => setAdd(false)} onSaved={async () => { setAdd(false); await load(); }} />}
      {view && <RequisitionDialog id={view} onClose={() => { setView(null); clearOpen(); }} onChanged={load} />}
    </Page>
  );
}

function NewRequisition({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const { lk } = useInv();
  const [f, setF] = useState<{ EmployeeId: number | null; WarehouseId: number; SiteId: number | ''; Purpose: string }>({
    EmployeeId: null, WarehouseId: lk.warehouses.find((w) => w.IsActive)?.Id ?? 0, SiteId: '', Purpose: '',
  });
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const save = async () => {
    const r = await app.run(() => api.post('/inventory/requisitions', { ...f, SiteId: f.SiteId || null, Lines: linesOut(lines) }));
    if (r) { await app.alert(r.message); onSaved(); }
  };
  return (
    <Modal title="New requisition" onClose={onClose} width="max-w-3xl" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="save" onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="For employee *" className="sm:col-span-2"><EmployeePicker value={f.EmployeeId} onChange={(id) => setF({ ...f, EmployeeId: id })} /></Field>
          <Field label="Store"><Select value={f.WarehouseId} onChange={(e) => setF({ ...f, WarehouseId: Number(e.target.value) })}>
            {lk.warehouses.filter((w) => w.IsActive).map((w) => <option key={w.Id} value={w.Id}>{w.Name}</option>)}</Select></Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="For work site" hint="Material for a site stays 'at the site' until installed or returned"><SiteSelect activeOnly value={f.SiteId} onChange={(id) => setF({ ...f, SiteId: id })} /></Field>
          <Field label="Purpose" className="sm:col-span-2"><Input value={f.Purpose} onChange={(e) => setF({ ...f, Purpose: e.target.value })} placeholder="e.g. Machine 4 maintenance" /></Field>
        </div>
        <LineEditor lines={lines} setLines={setLines} warehouseId={f.WarehouseId} />
        <Note>The department is the employee's department in attendance. It then waits for the HOD's approval (unless approval is switched off in the settings).</Note>
      </div>
    </Modal>
  );
}

function RequisitionDialog({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const app = useApp();
  const { me, reload } = useInv();
  const [r, setR] = useState<any>(null);
  const [q, setQ] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');
  const load = useCallback(async () => {
    const x = await api.get(`/inventory/requisitions/${id}`);
    setR(x);
    setQ(Object.fromEntries(x.Lines.map((l: any) => [l.Id, String(x.Status === 'Pending' ? Number(l.Qty) : l.Pending)])));
  }, [id]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = async (msg?: string) => { if (msg) await app.alert(msg); await Promise.all([load(), reload()]); onChanged(); };
  const lines = () => r.Lines.map((l: any) => ({ LineId: l.Id, Qty: q[l.Id] ?? '0' }));

  const decide = async (approve: boolean) => {
    const x = await app.run(() => api.post(`/inventory/requisitions/${id}/decide`, { approve, note, Lines: approve ? lines() : undefined }));
    if (x) await done(x.message);
  };
  const issue = async () => {
    const x = await app.run(() => api.post(`/inventory/requisitions/${id}/issue`, { Lines: lines() }));
    if (x) await done(x.message);
  };
  const cancel = async () => {
    if (!(await app.confirm(r.Status === 'PartIssued' ? 'Close this requisition? What was not issued yet will not be issued.' : 'Cancel this requisition?'))) return;
    const x = await app.run(() => api.post(`/inventory/requisitions/${id}/cancel`));
    if (x) await done(x.message);
  };
  if (!r) return null;
  const pending = r.Status === 'Pending', toIssue = ['Approved', 'PartIssued'].includes(r.Status);
  return (
    <Modal title={`${r.ReqNo} — ${r.Employee ?? ''}`} onClose={onClose} width="max-w-3xl" footer={
      <>
        {(pending || toIssue) && (me.manage || (pending && me.approve)) && <Button variant="danger" onClick={cancel}>{r.Status === 'PartIssued' ? 'Close' : 'Cancel requisition'}</Button>}
        <span className="flex-1" />
        {pending && me.approve && <><Button variant="danger" onClick={() => decide(false)}>Reject</Button><Button variant="success" icon="check" onClick={() => decide(true)}>Approve</Button></>}
        {toIssue && me.manage && <Button variant="primary" icon="upload" onClick={issue}>Issue now</Button>}
        <Button onClick={onClose}>Close</Button>
      </>
    }>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
          <span><Badge value={r.Status} /></span><span>Date: <b>{r.CreatedAt}</b></span><span>Department: <b>{r.Department || '—'}</b></span>
          <span>Store: <b>{r.Warehouse}</b></span>{r.Site && <span>Site: <b>{r.Site}</b></span>}<span>Asked by: <b>{r.Source === 'portal' ? 'the employee (portal)' : r.RequestedBy}</b></span>
          {r.Purpose && <span className="basis-full">Purpose: {r.Purpose}</span>}
          {r.DecidedBy && <span className="basis-full text-slate-600">Decided by {r.DecidedBy}{r.DecisionNote ? `: ${r.DecisionNote}` : ''}</span>}
        </div>
        <table className="w-full rounded border border-slate-200 text-[13px]">
          <thead className="bg-slate-50 text-xs text-slate-600"><tr>
            <th className="px-2 py-1.5 text-left">Item</th><th className="px-2 py-1.5 text-right">Asked</th><th className="px-2 py-1.5 text-right">Issued</th>
            <th className="px-2 py-1.5 text-right">In store</th>{(pending || toIssue) && <th className="w-28 px-2 py-1.5 text-left">{pending ? 'Approve' : 'Issue now'}</th>}
          </tr></thead>
          <tbody>
            {r.Lines.map((l: any) => (
              <tr key={l.Id} className="border-t border-slate-100">
                <td className="px-2 py-1">{l.Code} — {l.Name}{l.IsReturnable && <span className="ml-1 text-xs text-slate-500">(returnable)</span>}</td>
                <td className="px-2 py-1 text-right tabular-nums">{qty(l.Qty)} {l.Unit}</td>
                <td className="px-2 py-1 text-right tabular-nums">{qty(l.IssuedQty)}</td>
                <td className={`px-2 py-1 text-right tabular-nums ${Number(l.InStock) < l.Pending ? 'font-semibold text-red-600' : ''}`}>{qty(l.InStock)}</td>
                {(pending || toIssue) && <td className="px-2 py-1"><Input type="number" step="any" min={0} value={q[l.Id] ?? ''} disabled={pending ? !me.approve : !me.manage}
                  onChange={(e) => setQ({ ...q, [l.Id]: e.target.value })} aria-label="Quantity" /></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {pending && me.approve && <Field label="Note (needed to reject)"><TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}
