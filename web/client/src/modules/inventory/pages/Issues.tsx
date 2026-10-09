/**
 * Issue / Return: issue slips (direct or from a requisition, optionally for a work site), returns, what was installed at
 * a site, who holds what, and the material at each site.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, firstOfMonth, isoDate, qs } from '../../../api';
import { useApp } from '../../../app';
import { DataTable } from '../../../DataTable';
import { Button, Field, Input, Modal, Note, Page, Select, Tabs } from '../../../ui';
import { ScanBox } from '../scan';
import { Badge, EmployeePicker, inr, LineEditor, linesOut, LocationSelect, newLine, qty, SiteSelect, useInv, type Line } from '../shared';
import { BinMeter } from './Bins';

type Tab = 'issues' | 'holdings' | 'sites';

export function Issues() {
  const [tab, setTab] = useState<Tab>((new URLSearchParams(location.search).get('tab') as Tab) || 'issues');
  return (
    <Page title="Issue / Return" icon="upload" bodyClass="flex flex-col">
      <Tabs tabs={[{ key: 'issues', label: 'Issue slips' }, { key: 'holdings', label: 'Returnable items with employees' }, { key: 'sites', label: 'Material at sites' }]}
        value={tab} onChange={setTab} />
      {tab === 'issues' ? <IssueList /> : tab === 'holdings' ? <Holdings /> : <SiteMaterial />}
    </Page>
  );
}

function IssueList() {
  const app = useApp();
  const { me, lk } = useInv();
  const [f, setF] = useState({ from: firstOfMonth(isoDate()), to: isoDate(), employee: null as number | null, department: '', site: '' as number | '' });
  const [rows, setRows] = useState<any[]>([]);
  const [add, setAdd] = useState(false);
  const [ret, setRet] = useState<any | null>(null);
  const [use, setUse] = useState<any | null>(null);
  const [view, setView] = useState<any | null>(null);
  const load = useCallback(() => api.get('/inventory/issues' + qs(f)).then(setRows), [f]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="flex flex-wrap items-end gap-2 py-2">
        {me.manage && <Button variant="primary" icon="add" onClick={() => setAdd(true)}>Issue items</Button>}
        <Field label="From"><Input type="date" className="w-36" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="To"><Input type="date" className="w-36" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <Field label="Employee"><EmployeePicker className="w-64" value={f.employee} onChange={(id) => setF({ ...f, employee: id })} /></Field>
        <Field label="Department"><Select className="w-44" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>
          <option value="">All</option>{lk.departments.map((d) => <option key={d.Id} value={d.Id}>{d.Name}</option>)}</Select></Field>
        <Field label="Site"><SiteSelect className="w-44" emptyLabel="All" value={f.site} onChange={(id) => setF({ ...f, site: id })} /></Field>
        <span className="ml-auto pb-2 text-xs text-slate-500">{rows.length} issue(s) · {inr(rows.reduce((a, r) => a + r.Value, 0))}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <DataTable rows={rows} rowKey={(r) => r.Id} onDoubleClick={setView} empty="No issues in this period."
          columns={[
            { key: 'IssueNo', header: 'No' }, { key: 'IssuedOn', header: 'Date' },
            { key: 'Employee', header: 'Employee', render: (r) => `${r.EnrollNo ? r.EnrollNo + ' — ' : ''}${r.Employee ?? ''}` }, { key: 'Department', header: 'Department' },
            { key: 'Items', header: 'Items', sortable: false, render: (r) => <span className="block max-w-80 truncate">{r.Lines.map((l: any) => `${l.Name} ×${qty(l.Qty)}`).join(', ')}</span> },
            { key: 'Value', header: 'Value', align: 'right', render: (r) => inr(r.Value) },
            { key: 'Site', header: 'Site', render: (r) => (r.Site ? <>{r.Site}{r.AtSite && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">AT SITE</span>}</> : '') },
            { key: 'ReqNo', header: 'Requisition' }, { key: 'Warehouse', header: 'Store' }, { key: 'IssuedBy', header: 'By' },
            { key: 'Actions', header: '', sortable: false, render: (r) => (
              <span className="flex gap-1"><Button onClick={() => setView(r)}>Open</Button>
                {me.manage && r.AtSite && <Button icon="check" onClick={() => setUse(r)}>Installed</Button>}
                {me.manage && r.Lines.some((l: any) => l.Open > 0 && (r.ForSite || l.IsReturnable)) && <Button icon="undo" onClick={() => setRet(r)}>Return</Button>}</span>) },
          ]} />
      </div>
      {add && <IssueDialog onClose={() => setAdd(false)} onSaved={async () => { setAdd(false); await load(); }} />}
      {ret && <ReturnDialog issue={ret} onClose={() => setRet(null)} onSaved={async () => { setRet(null); await load(); }} />}
      {use && <ConsumeDialog issue={use} onClose={() => setUse(null)} onSaved={async () => { setUse(null); await load(); }} />}
      {view && (
        <Modal title={`${view.IssueNo} — ${view.Employee}`} onClose={() => setView(null)} width="max-w-2xl">
          <div className="mb-2 text-[13px] text-slate-600">{view.IssuedOn} · {view.Department || 'no department'} · {view.Warehouse}{view.Site ? <> · site <b>{view.Site}</b></> : ''} · by {view.IssuedBy}{view.Note ? ` · ${view.Note}` : ''}</div>
          <table className="w-full text-[13px]"><thead className="bg-slate-50 text-xs text-slate-600"><tr>
            <th className="px-2 py-1 text-left">Item</th><th className="px-2 py-1 text-left">Picked from</th><th className="px-2 py-1 text-right">Qty</th>{view.ForSite && <th className="px-2 py-1 text-right">Installed</th>}
            <th className="px-2 py-1 text-right">Returned</th>{view.ForSite && <th className="px-2 py-1 text-right">At site</th>}<th className="px-2 py-1 text-right">Rate</th><th className="px-2 py-1 text-left">Due back</th></tr></thead>
          <tbody>{view.Lines.map((l: any) => <tr key={l.Id} className="border-t border-slate-100">
            <td className="px-2 py-1">{l.Code} — {l.Name}</td><td className="px-2 py-1 text-xs">{l.PickedFrom}</td><td className="px-2 py-1 text-right">{qty(l.Qty)} {l.Unit}</td>
            {view.ForSite && <td className="px-2 py-1 text-right">{qty(l.ConsumedQty)}</td>}
            <td className="px-2 py-1 text-right">{l.IsReturnable || view.ForSite || l.ReturnedQty ? qty(l.ReturnedQty) : '—'}</td>
            {view.ForSite && <td className="px-2 py-1 text-right font-semibold">{qty(l.Open)}</td>}
            <td className="px-2 py-1 text-right">{inr(l.UnitCost)}</td><td className="px-2 py-1">{l.DueDate}{l.Overdue && <> <Badge value="Overdue" /></>}</td></tr>)}</tbody></table>
        </Modal>
      )}
    </>
  );
}

function IssueDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const { lk, reload } = useInv();
  const [f, setF] = useState({ EmployeeId: null as number | null, DepartmentId: '' as string | number, WarehouseId: lk.warehouses.find((w) => w.IsActive)?.Id ?? 0,
    SiteId: '' as number | '', LocationId: '' as number | '', Note: '' });
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [bin, setBin] = useState<{ Open: number; Limit: number; Full: boolean } | null>(null);
  useEffect(() => {
    setBin(null);
    if (f.EmployeeId) api.get(`/inventory/bins/${f.EmployeeId}`).then(setBin).catch(() => {});
  }, [f.EmployeeId]);
  /** Scanned: employee card / bin -> the employee; unit tag -> that unit; item barcode / code -> one more of it. */
  const scan = (code: string) => app.run(async () => {
    const r = await api.get('/inventory/scan' + qs({ code }));
    if (r.kind === 'employee') { setF((x) => ({ ...x, EmployeeId: r.employee.Id, DepartmentId: r.employee.DepartmentId ?? '' })); return; }
    if (r.kind === 'location') {
      if (r.location.WarehouseId !== f.WarehouseId) throw new Error(`${r.location.Code} is in ${r.location.Warehouse}.`);
      setF((x) => ({ ...x, LocationId: r.location.Id }));
      return;
    }
    if (r.kind === 'unit') {
      const u = r.unit;
      if (u.Status !== 'InStore') throw new Error(`${u.Code} ${u.SerialNo} is ${u.Status === 'Issued' ? `with ${u.EnrollNo} ${u.Employee}` : u.Status.toLowerCase()}, not in the store.`);
      if (u.WarehouseId !== f.WarehouseId) throw new Error(`${u.Code} ${u.SerialNo} is in another store.`);
      setLines((ls) => {
        const at = ls.find((l) => l.ItemId === u.ItemId);
        if (at?.Units?.some((x) => x.Id === u.Id)) return ls;
        if (at) return ls.map((l) => (l === at ? { ...l, Units: [...(l.Units ?? []), { Id: u.Id, SerialNo: u.SerialNo }], Qty: String((l.Units?.length ?? 0) + 1) } : l));
        const nl = newLine({ ItemId: u.ItemId, Qty: '1', Units: [{ Id: u.Id, SerialNo: u.SerialNo }] });
        return ls.length === 1 && !ls[0].ItemId ? [nl] : [...ls, nl];
      });
      return;
    }
    const it = r.item;
    if (!it.IsActive) throw new Error(`${it.Name} is switched off.`);
    setLines((ls) => {
      const at = ls.find((l) => l.ItemId === it.Id);
      if (at?.Units?.length) { void app.alert(`${it.Name} is tracked by serial: scan the tag of each unit.`); return ls; }
      if (at) return ls.map((l) => (l === at ? { ...l, Qty: String(Number(l.Qty || 0) + 1) } : l));
      const nl = newLine({ ItemId: it.Id, Qty: '1' });
      return ls.length === 1 && !ls[0].ItemId ? [nl] : [...ls, nl];
    });
  });
  const save = async () => {
    const r = await app.run(() => api.post('/inventory/issues', { ...f, DepartmentId: f.DepartmentId || null, SiteId: f.SiteId || null, LocationId: f.LocationId || null, Lines: linesOut(lines) }));
    if (r) { await reload(); await app.alert(r.message); onSaved(); }
  };
  return (
    <Modal title="Issue items" onClose={onClose} width="max-w-3xl" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="save" onClick={save}>Issue</Button></>}>
      <div className="space-y-3">
        <ScanBox autoFocus onScan={scan} placeholder="Scan employee card / bin, then unit tags or item barcodes" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="To employee *" className="sm:col-span-2" hint={bin ? <span>Bin: <BinMeter open={bin.Open} limit={bin.Limit} />{bin.Full && <b className="ml-1 text-red-700">FULL — only consumables can be issued</b>}</span> : undefined}>
            <EmployeePicker value={f.EmployeeId} onChange={(id, e) => setF({ ...f, EmployeeId: id, DepartmentId: e?.DepartmentId ?? '' })} /></Field>
          <Field label="From store"><Select value={f.WarehouseId} onChange={(e) => setF({ ...f, WarehouseId: Number(e.target.value), LocationId: '' })}>
            {lk.warehouses.filter((w) => w.IsActive).map((w) => <option key={w.Id} value={w.Id}>{w.Name}</option>)}</Select></Field>
          <Field label="Charge to department" hint="Default: the employee's department"><Select value={f.DepartmentId} onChange={(e) => setF({ ...f, DepartmentId: e.target.value })}>
            <option value="">—</option>{lk.departments.map((d) => <option key={d.Id} value={d.Id}>{d.Name}</option>)}</Select></Field>
          <Field label="For work site" hint="Empty = not for a site"><SiteSelect activeOnly value={f.SiteId} onChange={(id) => setF({ ...f, SiteId: id })} /></Field>
          <Field label="Take from location" hint="Or scan the rack label"><LocationSelect warehouseId={f.WarehouseId} value={f.LocationId} auto="Where it lies (system picks)"
            onChange={(id) => setF({ ...f, LocationId: id })} /></Field>
          <Field label="Note" className="sm:col-span-3"><Input value={f.Note} onChange={(e) => setF({ ...f, Note: e.target.value })} /></Field>
        </div>
        <LineEditor lines={lines} setLines={setLines} warehouseId={f.WarehouseId} due />
        {lines.filter((l) => l.Units?.length).map((l) => (
          <div key={l.key} className="flex flex-wrap items-center gap-1 text-xs">
            <span className="text-slate-600">{lk.items.find((i) => i.Id === l.ItemId)?.Name}: </span>
            {l.Units!.map((u) => <span key={u.Id} className="inline-flex items-center gap-1 rounded bg-sky-100 px-1.5 py-0.5 text-sky-800">{u.SerialNo}
              <button type="button" aria-label={`Remove ${u.SerialNo}`} onClick={() => setLines(lines.map((x) => (x.key === l.key ? { ...x, Units: x.Units!.filter((y) => y.Id !== u.Id), Qty: String(x.Units!.length - 1) } : x)))}>×</button></span>)}
          </div>
        ))}
        <Note>Serial items: scan each unit's tag (or enter a quantity: the oldest units in the store go). Stock leaves at its average cost. Returnable items get a due date (empty = the item's return days); overdue items are reminded automatically.
          Material for a site counts as "at the site" until it is marked installed (Installed) or given back (Return).</Note>
      </div>
    </Modal>
  );
}

function ReturnDialog({ issue, onClose, onSaved }: { issue: any; onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const { reload } = useInv();
  const open = issue.Lines.filter((l: any) => l.Open > 0 && (issue.ForSite || l.IsReturnable));
  const [q, setQ] = useState<Record<number, { Qty: string; Condition: string; Units: number[] }>>(Object.fromEntries(open.map((l: any) => [l.Id, { Qty: '', Condition: 'Good', Units: [] }])));
  const [note, setNote] = useState('');
  const [loc, setLoc] = useState<number | ''>('');
  const store = useInv().lk.warehouses.find((w) => w.Name === issue.Warehouse)?.Id ?? '';
  const save = async () => {
    const r = await app.run(() => api.post(`/inventory/issues/${issue.Id}/return`, { Note: note, LocationId: loc || null, Lines: open.map((l: any) => ({ LineId: l.Id, ...q[l.Id], Units: q[l.Id].Units.length ? q[l.Id].Units : undefined })) }));
    if (r) { await reload(); await app.alert(r.message); onSaved(); }
  };
  return (
    <Modal title={`Return on ${issue.IssueNo} — ${issue.Employee}`} onClose={onClose} width="max-w-2xl" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="save" onClick={save}>Save return</Button></>}>
      <table className="w-full text-[13px]"><thead className="bg-slate-50 text-xs text-slate-600"><tr>
        <th className="px-2 py-1 text-left">Item</th><th className="px-2 py-1 text-right">Still out</th><th className="w-28 px-2 py-1 text-left">Given back</th><th className="w-32 px-2 py-1 text-left">Condition</th></tr></thead>
      <tbody>{open.map((l: any) => (
        <tr key={l.Id} className="border-t border-slate-100">
          <td className="px-2 py-1">{l.Code} — {l.Name}<UnitPicks units={l.Units} chosen={q[l.Id].Units} onChange={(u) => setQ({ ...q, [l.Id]: { ...q[l.Id], Units: u, Qty: String(u.length || '') } })} /></td>
          <td className="px-2 py-1 text-right">{qty(l.Open)} {l.Unit}</td>
          <td className="px-2 py-1"><Input type="number" step="any" min={0} value={q[l.Id].Qty} disabled={q[l.Id].Units.length > 0} onChange={(e) => setQ({ ...q, [l.Id]: { ...q[l.Id], Qty: e.target.value } })} aria-label="Quantity" /></td>
          <td className="px-2 py-1"><Select value={q[l.Id].Condition} onChange={(e) => setQ({ ...q, [l.Id]: { ...q[l.Id], Condition: e.target.value } })}>
            <option value="Good">Good (back in stock)</option><option value="Damaged">Damaged</option><option value="Lost">Lost</option></Select></td>
        </tr>))}</tbody></table>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Put back to location"><LocationSelect warehouseId={store} value={loc} onChange={setLoc} /></Field>
        <Field label="Note" className="sm:col-span-2"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <div className="mt-2"><Note>Only "Good" goes back into stock (onto the chosen location; RECEIVING = put away later). Damaged / lost close the line so the employee no longer holds the item.</Note></div>
    </Modal>
  );
}

/** Serial units still out on a line, to tick the ones that come back / were installed (none ticked = the oldest go). */
function UnitPicks({ units, chosen, onChange }: { units?: { Id: number; SerialNo: string; Tag: string; Status: string }[]; chosen: number[]; onChange: (ids: number[]) => void }) {
  const out = (units ?? []).filter((u) => u.Status === 'Out');
  if (!out.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {out.map((u) => (
        <label key={u.Id} className={`inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${chosen.includes(u.Id) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
          <input type="checkbox" className="hidden" checked={chosen.includes(u.Id)} onChange={(e) => onChange(e.target.checked ? [...chosen, u.Id] : chosen.filter((x) => x !== u.Id))} />
          {u.SerialNo}{u.Tag ? ` · ${u.Tag}` : ''}
        </label>
      ))}
    </div>
  );
}

/** What was installed / used at the site, out of what is still there. */
function ConsumeDialog({ issue, onClose, onSaved }: { issue: any; onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const open = issue.Lines.filter((l: any) => l.Open > 0);
  const [q, setQ] = useState<Record<number, string>>(Object.fromEntries(open.map((l: any) => [l.Id, ''])));
  const [units, setUnits] = useState<Record<number, number[]>>({});
  const [usedOn, setUsedOn] = useState(isoDate());
  const [note, setNote] = useState('');
  const save = async () => {
    const r = await app.run(() => api.post(`/inventory/issues/${issue.Id}/consume`, { UsedOn: usedOn, Note: note,
      Lines: open.map((l: any) => ({ LineId: l.Id, Qty: q[l.Id], Units: units[l.Id]?.length ? units[l.Id] : undefined })) }));
    if (r) { await app.alert(r.message); onSaved(); }
  };
  return (
    <Modal title={`Installed at ${issue.Site} — ${issue.IssueNo}`} onClose={onClose} width="max-w-2xl" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="save" onClick={save}>Save</Button></>}>
      <table className="w-full text-[13px]"><thead className="bg-slate-50 text-xs text-slate-600"><tr>
        <th className="px-2 py-1 text-left">Item</th><th className="px-2 py-1 text-right">At site</th><th className="w-32 px-2 py-1 text-left">Installed / used</th></tr></thead>
      <tbody>{open.map((l: any) => (
        <tr key={l.Id} className="border-t border-slate-100">
          <td className="px-2 py-1">{l.Code} — {l.Name}<UnitPicks units={l.Units} chosen={units[l.Id] ?? []} onChange={(u) => { setUnits({ ...units, [l.Id]: u }); setQ({ ...q, [l.Id]: String(u.length || '') }); }} /></td>
          <td className="px-2 py-1 text-right">{qty(l.Open)} {l.Unit}</td>
          <td className="px-2 py-1"><div className="flex gap-1"><Input type="number" step="any" min={0} value={q[l.Id]} disabled={(units[l.Id]?.length ?? 0) > 0} onChange={(e) => setQ({ ...q, [l.Id]: e.target.value })} aria-label="Quantity" />
            <Button onClick={() => setQ({ ...q, [l.Id]: String(l.Open) })} title="All of it">All</Button></div></td>
        </tr>))}</tbody></table>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Date"><Input type="date" value={usedOn} max={isoDate()} onChange={(e) => setUsedOn(e.target.value)} /></Field>
        <Field label="Note" className="sm:col-span-2"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Floor 2, panel room" /></Field>
      </div>
      <div className="mt-2"><Note>The stock already left the store with the issue; this only records where it went. What is left over comes back with Return.</Note></div>
    </Modal>
  );
}

/** Material per site and item: issued, installed, returned, still at the site; and the register of everything that happened. */
function SiteMaterial() {
  const app = useApp();
  const [site, setSite] = useState<number | ''>('');
  const [openOnly, setOpenOnly] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const load = useCallback(() => api.get('/inventory/sites/stock' + qs({ site, open: openOnly ? 1 : '' })).then(setRows), [site, openOnly]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="flex flex-wrap items-end gap-2 py-2">
        <Field label="Site"><SiteSelect className="w-52" emptyLabel="All sites" value={site} onChange={setSite} /></Field>
        <Button variant={openOnly ? 'primary' : 'default'} onClick={() => setOpenOnly(!openOnly)}>{openOnly ? 'Showing material still at site' : 'Show only material still at site'}</Button>
        <Button icon="export" onClick={() => app.run(() => api.download('/inventory/reports/site/file' + qs({ site, format: 'xlsx' })))}>Excel</Button>
        <span className="ml-auto pb-2 text-xs text-slate-500">Installed {inr(rows.reduce((a, r) => a + r.InstalledValue, 0))} · at site {inr(rows.reduce((a, r) => a + r.AtSiteValue, 0))}.
          Who took / installed what: Inventory Reports → Site Material Register.</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <DataTable rows={rows} rowKey={(r) => `${r.SiteId ?? r.Site}-${r.ItemId}`} empty="No material issued for a site yet. Choose the site when issuing (Issue items → For work site)."
          columns={[
            { key: 'Site', header: 'Site' }, { key: 'Item', header: 'Item', render: (r) => `${r.Code} — ${r.Name}` },
            { key: 'Issued', header: 'Issued', align: 'right', render: (r) => `${qty(r.Issued)} ${r.Unit}` },
            { key: 'Installed', header: 'Installed', align: 'right', render: (r) => qty(r.Installed) },
            { key: 'Returned', header: 'Returned', align: 'right', render: (r) => qty(r.Returned) },
            { key: 'AtSite', header: 'At site', align: 'right', render: (r) => <b>{qty(r.AtSite)}</b> },
            { key: 'InstalledValue', header: 'Installed value', align: 'right', render: (r) => inr(r.InstalledValue) },
            { key: 'AtSiteValue', header: 'At site value', align: 'right', render: (r) => inr(r.AtSiteValue) },
            { key: 'LastIssued', header: 'Last issue' },
          ]} />
      </div>
    </>
  );
}

function Holdings() {
  const app = useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [overdue, setOverdue] = useState(false);
  const load = useCallback(() => api.get('/inventory/holdings' + qs({ overdue: overdue ? 1 : '' })).then(setRows), [overdue]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 py-2">
        <Button variant={overdue ? 'primary' : 'default'} onClick={() => setOverdue(!overdue)}>{overdue ? 'Showing overdue only' : 'Show overdue only'}</Button>
        <Button icon="export" onClick={() => app.run(() => api.download('/inventory/reports/holdings/file'))}>Excel</Button>
        <span className="text-xs text-slate-500">Employees marked LEFT are inactive in attendance: recover the items (exit clearance). Returns are entered on the issue slip.</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <DataTable rows={rows} rowKey={(r) => r.LineId} empty="No returnable items are out."
          rowClass={(r) => (r.OverdueDays ? 'text-red-700' : '')}
          columns={[
            { key: 'Employee', header: 'Employee', render: (r) => <>{r.EnrollNo ? `${r.EnrollNo} — ` : ''}{r.Employee}{!r.EmployeeActive && <span className="ml-1 rounded bg-red-600 px-1 text-[10px] font-bold text-white">LEFT</span>}</> },
            { key: 'Department', header: 'Department' }, { key: 'Item', header: 'Item', render: (r) => `${r.Code} — ${r.Item}` }, { key: 'Site', header: 'Site' },
            { key: 'Qty', header: 'Qty', align: 'right', render: (r) => `${qty(r.Qty)} ${r.Unit}` }, { key: 'Value', header: 'Value', align: 'right', render: (r) => inr(r.Value) },
            { key: 'IssueNo', header: 'Issue' }, { key: 'IssuedOn', header: 'Issued on' }, { key: 'DueDate', header: 'Due back' },
            { key: 'OverdueDays', header: 'Late', align: 'right', render: (r) => (r.OverdueDays ? `${r.OverdueDays} d` : '') },
          ]} />
      </div>
    </>
  );
}
