/**
 * Employee Bins: every employee's bin (BIN-<AC No>) with what they took and still have — returnables, serial units,
 * material at a site — the bin limit, and what was installed / returned. Search by AC No / name, or scan the bin label
 * or the employee's card.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, qs } from '../../../api';
import { useApp } from '../../../app';
import { DataTable } from '../../../DataTable';
import { Button, Field, Input, Modal, Note, Page } from '../../../ui';
import { printLabels, ScanBox } from '../scan';
import { Badge, inr, qty, useInv } from '../shared';

export interface BinLine {
  LineId: number; IssueId: number; IssueNo: string; IssuedOn: string; Site: string; ItemId: number; Code: string; Item: string; Unit: string;
  Kind: 'Serial' | 'Returnable' | 'Consumable'; Qty: number; Returned: number; Installed: number; Open: number; DueDate: string; Overdue: boolean;
  Status: string; UnitCost?: number; OpenValue?: number; Units: { Id: number; SerialNo: string; Tag: string; Status: string }[];
}
export interface Bin {
  EmployeeId: number; Bin: string; EnrollNo: string; Name: string; Active: boolean; Department: string; Limit: number; OwnLimit: boolean; Open: number; Full: boolean; Note: string;
  Totals: { Lines: number; Taken: number; Installed: number; Returned: number; OpenLines: number; Overdue: number; OpenValue?: number };
  Lines: BinLine[];
}

export function Bins() {
  const app = useApp();
  const [q, setQ] = useState('');
  const [openOnly, setOpenOnly] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<number | null>(() => Number(new URLSearchParams(location.search).get('employee')) || null);
  const load = useCallback(() => api.get('/inventory/bins' + qs({ q, open: openOnly && !q ? 1 : '' })).then(setRows), [q, openOnly]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const scan = (code: string) => app.run(async () => {
    const r = await api.get('/inventory/scan' + qs({ code }));
    if (r.kind === 'employee') setSel(r.employee.Id);
    else if (r.kind === 'unit' && r.unit.EmployeeId) setSel(r.unit.EmployeeId);
    else await app.alert(r.kind === 'unit' ? `${r.unit.Code} ${r.unit.SerialNo} is ${r.unit.Status}${r.unit.Site ? ` (${r.unit.Site})` : ''}, not in a bin.` : 'This is an item, not a bin. Scan a bin label or an employee card.');
  });
  return (
    <Page title="Employee Bins" icon="box" toolbar={
      <>
        <ScanBox className="w-80" onScan={scan} placeholder="Scan bin label / employee card / unit" />
        <Field label=""><Input className="w-52" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search AC No or name" aria-label="Search" /></Field>
        <Button variant={openOnly ? 'primary' : 'default'} onClick={() => setOpenOnly(!openOnly)}>{openOnly ? 'Bins with items' : 'All employees'}</Button>
        <Button icon="export" onClick={() => app.run(() => api.download('/inventory/reports/bins/file' + qs({ format: 'xlsx' })))}>Excel</Button>
        <Button icon="print" onClick={() => app.run(() => printLabels(rows.map((r) => ({ code: r.Bin, title: r.Name, sub: `AC No ${r.EnrollNo}${r.Department ? ' · ' + r.Department : ''}` })), 'Bin labels'))}>Print bin labels</Button>
      </>
    } bodyClass="flex flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <DataTable rows={rows} rowKey={(r) => r.EmployeeId} onDoubleClick={(r) => setSel(r.EmployeeId)} empty={q ? 'Nobody found.' : 'No employee holds anything from the store.'}
          rowClass={(r) => (r.Full ? 'bg-red-50/60' : '')}
          columns={[
            { key: 'Bin', header: 'Bin' },
            { key: 'Name', header: 'Employee', render: (r) => <>{r.EnrollNo} — {r.Name}{!r.Active && <span className="ml-1 rounded bg-red-600 px-1 text-[10px] font-bold text-white">LEFT</span>}</> },
            { key: 'Department', header: 'Department' },
            { key: 'Open', header: 'Open items', align: 'right', render: (r) => <BinMeter open={r.Open} limit={r.Limit} /> },
            { key: 'Overdue', header: 'Overdue', align: 'right', render: (r) => (r.Overdue ? <span className="font-semibold text-red-700">{r.Overdue}</span> : '') },
            { key: 'AtSite', header: 'At site', align: 'right', render: (r) => r.AtSite || '' },
            { key: 'Value', header: 'Value', align: 'right', render: (r) => inr(r.Value) },
            { key: 'Open_', header: '', sortable: false, render: (r) => <Button onClick={() => setSel(r.EmployeeId)}>Open bin</Button> },
          ]} />
      </div>
      {sel && (
        <Modal title="Bin" onClose={() => { setSel(null); load(); }} width="max-w-5xl">
          <BinView employeeId={sel} />
        </Modal>
      )}
    </Page>
  );
}

/** "7 / 10" with a bar; red when full. */
export function BinMeter({ open, limit }: { open: number; limit: number }) {
  const pct = limit ? Math.min(100, (open / limit) * 100) : 0;
  const full = limit > 0 && open >= limit;
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`tabular-nums ${full ? 'font-semibold text-red-700' : ''}`}>{open}{limit ? ` / ${limit}` : ''}</span>
      {limit > 0 && <span className="h-1.5 w-16 overflow-hidden rounded bg-slate-200"><span className={`block h-full ${full ? 'bg-red-600' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} /></span>}
    </span>
  );
}

/** One bin: summary, limit, every line with its units. Also the Employee List → Store Items tab. */
export function BinView({ employeeId, allowEdit = true }: { employeeId: number; allowEdit?: boolean }) {
  const app = useApp();
  const [b, setB] = useState<Bin | null>(null);
  const [all, setAll] = useState(false);
  const [edit, setEdit] = useState(false);
  const load = useCallback(() => api.get(`/inventory/bins/${employeeId}`).then(setB), [employeeId]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const manage = useManage();
  if (!b) return <div className="text-sm text-slate-500">Loading…</div>;
  const lines = all ? b.Lines : b.Lines.filter((l) => l.Open > 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <div className="text-lg font-semibold text-brand-900">{b.Bin} <span className="font-normal text-slate-600">· {b.EnrollNo} — {b.Name}</span></div>
          <div className="text-xs text-slate-500">{b.Department || 'No department'}{!b.Active && ' · LEFT the company: recover the items (exit clearance)'}{b.Note ? ` · ${b.Note}` : ''}</div>
        </div>
        <span className="flex-1" />
        <Button icon="print" onClick={() => app.run(() => printLabels([{ code: b.Bin, title: b.Name, sub: `AC No ${b.EnrollNo}` }], b.Bin))}>Bin label</Button>
        {allowEdit && manage && <Button icon="edit" onClick={() => setEdit(true)}>Bin limit</Button>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        <Tile label="Open items" value={<BinMeter open={b.Open} limit={b.Limit} />} sub={b.Limit ? (b.Full ? 'FULL — clear before new issues' : `${b.Limit - b.Open} more allowed`) : 'no limit'} tone={b.Full ? 'red' : 'blue'} />
        <Tile label="Taken (all time)" value={qty(b.Totals.Taken)} sub={`${b.Totals.Lines} line(s)`} />
        <Tile label="Installed at sites" value={qty(b.Totals.Installed)} />
        <Tile label="Given back" value={qty(b.Totals.Returned)} />
        <Tile label="Overdue" value={b.Totals.Overdue} tone={b.Totals.Overdue ? 'red' : 'blue'} />
        {b.Totals.OpenValue !== undefined && <Tile label="Value still out" value={inr(b.Totals.OpenValue)} />}
      </div>
      <div className="flex items-center gap-2">
        <Button variant={all ? 'default' : 'primary'} onClick={() => setAll(false)}>Still open ({b.Totals.OpenLines})</Button>
        <Button variant={all ? 'primary' : 'default'} onClick={() => setAll(true)}>Everything ever taken ({b.Lines.length})</Button>
      </div>
      <div className="max-h-[26rem] overflow-auto rounded border border-slate-200 scroll-thin">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-slate-50 text-xs text-slate-600"><tr>
            <th className="px-2 py-1.5 text-left">Date</th><th className="px-2 py-1.5 text-left">Issue</th><th className="px-2 py-1.5 text-left">Item</th><th className="px-2 py-1.5 text-left">Type</th>
            <th className="px-2 py-1.5 text-left">Site</th><th className="px-2 py-1.5 text-right">Taken</th><th className="px-2 py-1.5 text-right">Installed</th>
            <th className="px-2 py-1.5 text-right">Returned</th><th className="px-2 py-1.5 text-right">Open</th><th className="px-2 py-1.5 text-left">Status</th><th className="px-2 py-1.5 text-left">Due back</th>
          </tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.LineId} className={`border-t border-slate-100 align-top ${l.Overdue ? 'text-red-700' : l.Open ? '' : 'text-slate-400'}`}>
                <td className="px-2 py-1 whitespace-nowrap">{l.IssuedOn}</td><td className="px-2 py-1">{l.IssueNo}</td>
                <td className="px-2 py-1">{l.Code} — {l.Item}
                  {!!l.Units.length && <div className="mt-0.5 flex flex-wrap gap-1">{l.Units.map((u) => (
                    <span key={u.Id} title={u.Tag ? `Tag ${u.Tag}` : 'No tag'} className={`rounded px-1 text-[11px] ${u.Status === 'Out' ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-500 line-through'}`}>{u.SerialNo}</span>))}</div>}
                </td>
                <td className="px-2 py-1 text-xs">{l.Kind}</td><td className="px-2 py-1">{l.Site}</td>
                <td className="px-2 py-1 text-right tabular-nums">{qty(l.Qty)} {l.Unit}</td>
                <td className="px-2 py-1 text-right tabular-nums">{l.Installed ? qty(l.Installed) : ''}</td>
                <td className="px-2 py-1 text-right tabular-nums">{l.Returned ? qty(l.Returned) : ''}</td>
                <td className="px-2 py-1 text-right font-semibold tabular-nums">{l.Open ? qty(l.Open) : ''}</td>
                <td className="px-2 py-1"><Badge value={l.Overdue ? 'Overdue' : l.Status} /></td><td className="px-2 py-1 whitespace-nowrap">{l.DueDate}</td>
              </tr>
            ))}
            {!lines.length && <tr><td colSpan={11} className="px-3 py-6 text-center text-slate-400">{all ? 'The store has not issued anything to this employee.' : 'The bin is empty.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <Note>An open item counts once per serial unit or per issue line (10 pens on one slip = 1). Consumables issued without a site are used up and leave the bin.
        Give things back at Inventory → Scan Station (scan the bin, then the items) or on the issue slip (Issue / Return).</Note>
      {edit && <LimitDialog bin={b} onClose={() => setEdit(false)} onSaved={async () => { setEdit(false); await load(); }} />}
    </div>
  );
}

function useManage() {
  try { return useInv().me.manage; } catch { return false; }
}

function Tile({ label, value, sub, tone = 'blue' }: { label: string; value: React.ReactNode; sub?: string; tone?: 'blue' | 'red' }) {
  return (
    <div className={`rounded-lg border border-l-4 border-slate-200 bg-white px-3 py-2 ${tone === 'red' ? 'border-l-red-500' : 'border-l-brand-600'}`}>
      <div className="text-xs text-slate-500">{label}</div><div className="text-lg font-semibold">{value}</div>{sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

function LimitDialog({ bin, onClose, onSaved }: { bin: Bin; onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const [own, setOwn] = useState(bin.OwnLimit);
  const [max, setMax] = useState(String(bin.Limit));
  const [note, setNote] = useState(bin.Note);
  const save = async () => {
    if (await app.run(() => api.put(`/inventory/bins/${bin.EmployeeId}`, { MaxItems: own ? max : null, Note: note }))) onSaved();
  };
  return (
    <Modal title={`Bin limit — ${bin.Name}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="save" onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm"><input type="radio" checked={!own} onChange={() => setOwn(false)} /> Same as everybody (Inventory → Automation settings → Bin limit)</label>
        <label className="flex items-center gap-2 text-sm"><input type="radio" checked={own} onChange={() => setOwn(true)} /> Own limit for this employee</label>
        {own && <Field label="Most open items in the bin" hint="0 = no limit"><Input type="number" min={0} value={max} onChange={(e) => setMax(e.target.value)} /></Field>}
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Site supervisor: carries more tools" /></Field>
      </div>
    </Modal>
  );
}
