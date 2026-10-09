/** Purchase orders (draft → ordered → received) with the automatic re-order, and goods receipts (with or without a PO). */
import { useCallback, useEffect, useState } from 'react';
import { api, firstOfMonth, isoDate, qs } from '../../../api';
import { useApp } from '../../../app';
import { DataTable } from '../../../DataTable';
import { Button, Field, Input, Modal, Note, Page, Select, Tabs, TextArea } from '../../../ui';
import { Badge, inr, LineEditor, linesOut, LocationSelect, newLine, qty, useIdParam, useInv, type Line } from '../shared';

type Tab = 'orders' | 'receipts';

export function Purchase() {
  const [tab, setTab] = useState<Tab>('orders');
  return (
    <Page title="Purchase Orders / Goods Receipt" icon="download" bodyClass="flex flex-col">
      <Tabs tabs={[{ key: 'orders', label: 'Purchase orders' }, { key: 'receipts', label: 'Goods receipts (GRN)' }]} value={tab} onChange={setTab} />
      {tab === 'orders' ? <Orders /> : <Receipts />}
    </Page>
  );
}

function Orders() {
  const app = useApp();
  const { me } = useInv();
  const [status, setStatus] = useState('Open');
  const [rows, setRows] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null>(null);
  const [open, clearOpen] = useIdParam();
  const [view, setView] = useState<number | null>(open);
  const load = useCallback(() => api.get('/inventory/purchase-orders' + qs({ status })).then(setRows), [status]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const reorder = async () => {
    const r = await app.run(() => api.post('/inventory/purchase-orders/reorder'));
    if (r) { await app.alert(r.message, 'Re-order'); await load(); }
  };
  return (
    <>
      <div className="flex flex-wrap items-end gap-2 py-2">
        {me.manage && <Button variant="primary" icon="add" onClick={() => setEdit({})}>New PO</Button>}
        {me.manage && <Button icon="sync" onClick={reorder}>Re-order now (low stock)</Button>}
        <Field label="Status"><Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="Open">Open</option>{['Draft', 'Ordered', 'Partial', 'Received', 'Closed', 'Cancelled'].map((s) => <option key={s}>{s}</option>)}<option value="">All</option></Select></Field>
        <span className="ml-auto pb-2 text-xs text-slate-500">{rows.length} order(s) · {inr(rows.reduce((a, r) => a + r.Total, 0))}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <DataTable rows={rows} rowKey={(r) => r.Id} onDoubleClick={(r) => setView(r.Id)} empty="No purchase orders."
          columns={[
            { key: 'PoNo', header: 'PO No', render: (r) => <>{r.PoNo}{r.IsAuto && <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] font-semibold text-sky-800">AUTO</span>}</> },
            { key: 'OrderDate', header: 'Date' }, { key: 'Supplier', header: 'Supplier' }, { key: 'Warehouse', header: 'Store' },
            { key: 'LineCount', header: 'Lines', align: 'right' }, { key: 'Total', header: 'Total (incl. GST)', align: 'right', render: (r) => inr(r.Total) },
            { key: 'ExpectedDate', header: 'Expected', render: (r) => <>{r.ExpectedDate}{r.Late && <> <Badge value="Late" /></>}</> },
            { key: 'Status', header: 'Status', render: (r) => <Badge value={r.Status} /> },
            { key: 'Open', header: '', sortable: false, render: (r) => <Button onClick={() => setView(r.Id)}>Open</Button> },
          ]} />
      </div>
      {edit && <PoDialog po={edit} onClose={() => setEdit(null)} onSaved={async (id) => { setEdit(null); await load(); setView(id); }} />}
      {view && <PoView id={view} onClose={() => { setView(null); clearOpen(); }} onEdit={(p) => { setView(null); setEdit(p); }} onChanged={load} />}
    </>
  );
}

function PoDialog({ po, onClose, onSaved }: { po: any; onClose: () => void; onSaved: (id: number) => void }) {
  const app = useApp();
  const { lk } = useInv();
  const [f, setF] = useState({
    SupplierId: po.SupplierId ?? '', WarehouseId: po.WarehouseId ?? lk.warehouses.find((w) => w.IsActive)?.Id ?? '', OrderDate: po.OrderDate ?? isoDate(),
    ExpectedDate: po.ExpectedDate ?? '', Notes: po.Notes ?? '',
  });
  const [lines, setLines] = useState<Line[]>(po.Lines?.length
    ? po.Lines.map((l: any) => newLine({ ItemId: l.ItemId, Qty: String(Number(l.Qty)), UnitPrice: String(Number(l.UnitPrice)), GstRate: String(Number(l.GstRate)) }))
    : [newLine()]);
  const fromSupplier = () => {
    // Items whose preferred supplier this is, below their level: a quick start for a manual PO.
    const mine = lk.items.filter((i) => i.IsActive && i.PreferredSupplierId === Number(f.SupplierId));
    if (!mine.length) return app.alert('No item has this supplier as preferred supplier.');
    setLines(mine.map((i) => newLine({ ItemId: i.Id, Qty: '', UnitPrice: String(i.PurchasePrice || ''), GstRate: String(i.GstRate) })));
  };
  const save = async (status?: string) => {
    const body = { ...f, ExpectedDate: f.ExpectedDate || undefined, Status: status, Lines: linesOut(lines) };
    const r = await app.run(() => (po.Id ? api.put(`/inventory/purchase-orders/${po.Id}`, body) : api.post('/inventory/purchase-orders', body)));
    if (r) onSaved(r.id);
  };
  return (
    <Modal title={po.Id ? `Edit ${po.PoNo}` : 'New purchase order'} onClose={onClose} width="max-w-4xl"
      footer={<><Button onClick={onClose}>Cancel</Button><Button icon="save" onClick={() => save()}>Save draft</Button><Button variant="primary" icon="check" onClick={() => save('Ordered')}>Save & mark ordered</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Supplier *" className="col-span-2"><div className="flex gap-2"><Select value={f.SupplierId} onChange={(e) => setF({ ...f, SupplierId: e.target.value })}>
            <option value="">— choose —</option>{lk.suppliers.filter((s) => s.IsActive).map((s) => <option key={s.Id} value={s.Id}>{s.Name}</option>)}</Select>
            {f.SupplierId && <Button onClick={fromSupplier} title="Add this supplier's items">Its items</Button>}</div></Field>
          <Field label="Deliver to store" className="col-span-2"><Select value={f.WarehouseId} onChange={(e) => setF({ ...f, WarehouseId: e.target.value })}>
            {lk.warehouses.filter((w) => w.IsActive).map((w) => <option key={w.Id} value={w.Id}>{w.Name}</option>)}</Select></Field>
          <Field label="Order date"><Input type="date" value={f.OrderDate} onChange={(e) => setF({ ...f, OrderDate: e.target.value })} /></Field>
          <Field label="Expected" hint="Empty = supplier's lead time"><Input type="date" value={f.ExpectedDate} onChange={(e) => setF({ ...f, ExpectedDate: e.target.value })} /></Field>
          <Field label="Notes / terms" className="col-span-2"><Input value={f.Notes} onChange={(e) => setF({ ...f, Notes: e.target.value })} /></Field>
        </div>
        <LineEditor lines={lines} setLines={setLines} price gst />
      </div>
    </Modal>
  );
}

function PoView({ id, onClose, onEdit, onChanged }: { id: number; onClose: () => void; onEdit: (p: any) => void; onChanged: () => void }) {
  const app = useApp();
  const { me, lk, reload } = useInv();
  const [p, setP] = useState<any>(null);
  const [recv, setRecv] = useState<Record<number, { Qty: string; UnitPrice: string }> | null>(null);
  const [inv, setInv] = useState<{ InvoiceNo: string; ReceivedOn: string; Note: string; LocationId?: number | '' }>({ InvoiceNo: '', ReceivedOn: isoDate(), Note: '' });
  const load = useCallback(() => api.get(`/inventory/purchase-orders/${id}`).then(setP), [id]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const status = async (s: string, ask?: string) => {
    if (ask && !(await app.confirm(ask))) return;
    if (await app.run(() => api.post(`/inventory/purchase-orders/${id}/status`, { status: s }))) { await load(); onChanged(); }
  };
  const del = async () => {
    if (!(await app.confirm(`Delete ${p.PoNo}?`))) return;
    if (await app.run(() => api.del(`/inventory/purchase-orders/${id}`))) { onChanged(); onClose(); }
  };
  const startReceive = () => setRecv(Object.fromEntries(p.Lines.map((l: any) => [l.Id, { Qty: String(l.Pending || ''), UnitPrice: String(Number(l.UnitPrice)) }])));
  const receive = async () => {
    const r = await app.run(() => api.post(`/inventory/purchase-orders/${id}/receive`, { ...inv, Lines: Object.entries(recv!).map(([LineId, v]) => ({ LineId: Number(LineId), ...v })) }));
    if (r) { setRecv(null); await Promise.all([load(), reload()]); onChanged(); await app.alert(r.message); }
  };
  const print = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    w.document.write(`<title>${esc(p.PoNo)}</title><style>body{font:13px Segoe UI,Arial;margin:32px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:5px 7px}th{background:#eef}td.r{text-align:right}</style>
      <h2>Purchase Order ${esc(p.PoNo)}</h2><p>Date: ${esc(p.OrderDate)} · Expected: ${esc(p.ExpectedDate)}</p>
      <p><b>To:</b> ${esc(p.Supplier)}<br>${esc(p.SupplierAddress)}<br>${p.SupplierGstin ? 'GSTIN ' + esc(p.SupplierGstin) : ''}</p><p><b>Deliver to:</b> ${esc(p.Warehouse)}</p>
      <table><tr><th>#</th><th>Item</th><th>HSN</th><th>Qty</th><th>Rate</th><th>GST %</th><th>Amount</th></tr>
      ${p.Lines.map((l: any, i: number) => `<tr><td>${i + 1}</td><td>${esc(l.Code)} ${esc(l.Name)}</td><td>${esc(l.Hsn)}</td><td class=r>${qty(l.Qty)} ${esc(l.Unit)}</td><td class=r>${inr(l.UnitPrice)}</td><td class=r>${Number(l.GstRate)}</td><td class=r>${inr(l.Total)}</td></tr>`).join('')}
      <tr><td colspan=6 class=r><b>Total</b></td><td class=r><b>${inr(p.Total)}</b></td></tr></table><p>${esc(p.Notes)}</p>`);
    w.document.close();
    w.print();
  };
  if (!p) return null;
  const canReceive = me.manage && ['Ordered', 'Partial'].includes(p.Status);
  return (
    <Modal title={`${p.PoNo} — ${p.Supplier}`} onClose={onClose} width="max-w-4xl" footer={
      <>
        {me.manage && p.Status === 'Draft' && <><Button variant="danger" icon="trash" onClick={del}>Delete</Button><Button icon="edit" onClick={() => onEdit(p)}>Edit</Button></>}
        {me.manage && ['Draft', 'Ordered'].includes(p.Status) && !p.Receipts.length && <Button variant="danger" onClick={() => status('Cancelled', 'Cancel this order?')}>Cancel order</Button>}
        {me.manage && p.Status === 'Partial' && <Button onClick={() => status('Closed', 'Close the order? The rest will not be received.')}>Close (rest not coming)</Button>}
        <span className="flex-1" />
        <Button icon="report" onClick={print}>Print</Button>
        {me.manage && p.Status === 'Draft' && <Button variant="primary" icon="check" onClick={() => status('Ordered')}>Mark as ordered</Button>}
        {canReceive && !recv && <Button variant="primary" icon="download" onClick={startReceive}>Receive goods</Button>}
        {recv && <Button variant="success" icon="save" onClick={receive}>Save receipt</Button>}
        <Button onClick={onClose}>Close</Button>
      </>
    }>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
          <Badge value={p.Status} /><span>Date <b>{p.OrderDate}</b></span><span>Expected <b>{p.ExpectedDate}</b></span><span>Store <b>{p.Warehouse}</b></span>
          <span>Total <b>{inr(p.Total)}</b></span>{p.IsAuto && <span className="text-sky-700">Made by the automatic re-order</span>}{p.Notes && <span className="basis-full text-slate-600">{p.Notes}</span>}
        </div>
        {recv && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Supplier invoice / challan no"><Input value={inv.InvoiceNo} onChange={(e) => setInv({ ...inv, InvoiceNo: e.target.value })} /></Field>
            <Field label="Received on"><Input type="date" value={inv.ReceivedOn} onChange={(e) => setInv({ ...inv, ReceivedOn: e.target.value })} /></Field>
            <Field label="Note"><Input value={inv.Note} onChange={(e) => setInv({ ...inv, Note: e.target.value })} /></Field>
            <Field label="Put into location" hint="RECEIVING = put away later"><LocationSelect warehouseId={p.WarehouseId} value={inv.LocationId ?? ''} onChange={(id) => setInv({ ...inv, LocationId: id })} /></Field>
          </div>
        )}
        <table className="w-full rounded border border-slate-200 text-[13px]">
          <thead className="bg-slate-50 text-xs text-slate-600"><tr>
            <th className="px-2 py-1.5 text-left">Item</th><th className="px-2 py-1.5 text-right">Ordered</th><th className="px-2 py-1.5 text-right">Received</th>
            <th className="px-2 py-1.5 text-right">Rate</th><th className="px-2 py-1.5 text-right">GST %</th><th className="px-2 py-1.5 text-right">Amount</th>
            {recv && <><th className="w-28 px-2 py-1.5 text-left">Receive now</th><th className="w-28 px-2 py-1.5 text-left">Rate</th></>}
          </tr></thead>
          <tbody>
            {p.Lines.map((l: any) => (
              <tr key={l.Id} className="border-t border-slate-100">
                <td className="px-2 py-1">{l.Code} — {l.Name}</td><td className="px-2 py-1 text-right tabular-nums">{qty(l.Qty)} {l.Unit}</td>
                <td className="px-2 py-1 text-right tabular-nums">{qty(l.ReceivedQty)}</td><td className="px-2 py-1 text-right tabular-nums">{inr(l.UnitPrice)}</td>
                <td className="px-2 py-1 text-right">{Number(l.GstRate)}</td><td className="px-2 py-1 text-right tabular-nums">{inr(l.Total)}</td>
                {recv && <><td className="px-2 py-1"><Input type="number" step="any" min={0} disabled={!l.Pending} value={recv[l.Id].Qty} onChange={(e) => setRecv({ ...recv, [l.Id]: { ...recv[l.Id], Qty: e.target.value } })} aria-label="Receive" /></td>
                  <td className="px-2 py-1"><Input type="number" step="any" min={0} disabled={!l.Pending} value={recv[l.Id].UnitPrice} onChange={(e) => setRecv({ ...recv, [l.Id]: { ...recv[l.Id], UnitPrice: e.target.value } })} aria-label="Rate" /></td></>}
              </tr>
            ))}
          </tbody>
        </table>
        {p.Receipts.length > 0 && <div className="text-xs text-slate-600">Receipts: {p.Receipts.map((r: any) => `${r.GrnNo} (${r.ReceivedOn}${r.InvoiceNo ? ', inv. ' + r.InvoiceNo : ''})`).join(' · ')}</div>}
        {p.Status === 'Draft' && <Note tone="info">A draft does not go anywhere. Check the quantities, print or send it to the supplier, then mark it as ordered.</Note>}
        {lk.warehouses.length === 0 && <Note tone="warn">Add a store first.</Note>}
      </div>
    </Modal>
  );
}

function Receipts() {
  const app = useApp();
  const { me } = useInv();
  const [f, setF] = useState({ from: firstOfMonth(isoDate()), to: isoDate() });
  const [rows, setRows] = useState<any[]>([]);
  const [add, setAdd] = useState(false);
  const load = useCallback(() => api.get('/inventory/receipts' + qs(f)).then(setRows), [f]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="flex flex-wrap items-end gap-2 py-2">
        {me.manage && <Button variant="primary" icon="add" onClick={() => setAdd(true)}>Receipt without PO</Button>}
        <Field label="From"><Input type="date" className="w-36" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="To"><Input type="date" className="w-36" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <span className="ml-auto pb-2 text-xs text-slate-500">Receive goods on a PO from the PO itself (Open → Receive goods).</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <DataTable rows={rows} rowKey={(r) => r.Id} empty="No goods received in this period."
          columns={[
            { key: 'GrnNo', header: 'GRN No' }, { key: 'ReceivedOn', header: 'Date' }, { key: 'PoNo', header: 'PO' }, { key: 'Supplier', header: 'Supplier' },
            { key: 'InvoiceNo', header: 'Invoice' }, { key: 'Warehouse', header: 'Store' },
            { key: 'Items', header: 'Items', sortable: false, render: (r) => <span className="block max-w-80 truncate">{r.Lines.map((l: any) => `${l.Name} ×${qty(l.Qty)}`).join(', ')}</span> },
            { key: 'Value', header: 'Value (excl. GST)', align: 'right', render: (r) => inr(r.Value) }, { key: 'CreatedBy', header: 'By' },
          ]} />
      </div>
      {add && <DirectReceipt onClose={() => setAdd(false)} onSaved={async () => { setAdd(false); await load(); }} />}
    </>
  );
}

function DirectReceipt({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const { lk, reload } = useInv();
  const [f, setF] = useState<any>({ SupplierId: '', WarehouseId: lk.warehouses.find((w) => w.IsActive)?.Id ?? '', InvoiceNo: '', ReceivedOn: isoDate(), Note: '', LocationId: '' });
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const save = async () => {
    const r = await app.run(() => api.post('/inventory/receipts', { ...f, SupplierId: f.SupplierId || null, LocationId: f.LocationId || null, Lines: linesOut(lines) }));
    if (r) { await reload(); await app.alert(r.message); onSaved(); }
  };
  return (
    <Modal title="Goods receipt without PO" onClose={onClose} width="max-w-3xl" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="save" onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Supplier" className="col-span-2"><Select value={f.SupplierId} onChange={(e) => setF({ ...f, SupplierId: e.target.value })}>
            <option value="">— none / cash —</option>{lk.suppliers.filter((s) => s.IsActive).map((s) => <option key={s.Id} value={s.Id}>{s.Name}</option>)}</Select></Field>
          <Field label="Store"><Select value={f.WarehouseId} onChange={(e) => setF({ ...f, WarehouseId: e.target.value, LocationId: '' })}>
            {lk.warehouses.filter((w) => w.IsActive).map((w) => <option key={w.Id} value={w.Id}>{w.Name}</option>)}</Select></Field>
          <Field label="Put into location"><LocationSelect warehouseId={f.WarehouseId} value={f.LocationId} onChange={(id) => setF({ ...f, LocationId: id })} /></Field>
          <Field label="Invoice / challan"><Input value={f.InvoiceNo} onChange={(e) => setF({ ...f, InvoiceNo: e.target.value })} /></Field>
          <Field label="Received on"><Input type="date" value={f.ReceivedOn} onChange={(e) => setF({ ...f, ReceivedOn: e.target.value })} /></Field>
          <Field label="Note" className="col-span-2"><TextArea rows={1} value={f.Note} onChange={(e) => setF({ ...f, Note: e.target.value })} /></Field>
        </div>
        <LineEditor lines={lines} setLines={setLines} price />
      </div>
    </Modal>
  );
}
