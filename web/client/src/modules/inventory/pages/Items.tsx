/** Items & Stock: every item with its stock, value and re-order status; add / edit, Excel import, item card with its ledger. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, qs } from '../../../api';
import { useApp } from '../../../app';
import { DataTable } from '../../../DataTable';
import { Button, Check, Field, Input, Modal, Note, Page, Select, TextArea } from '../../../ui';
import { printLabels } from '../scan';
import { Badge, inr, itemKind, LocationSelect, qty, useIdParam, useInv } from '../shared';

const UNITS = ['Nos', 'Pcs', 'Pair', 'Box', 'Pack', 'Set', 'Kg', 'g', 'Ltr', 'ml', 'Mtr', 'Roll', 'Ream', 'Bag', 'Can', 'Bottle'];
const GST = [0, 5, 12, 18, 28, 3, 0.25];

export function Items() {
  const app = useApp();
  const { me, lk, reload } = useInv();
  const [f, setF] = useState({ q: '', category: '', warehouse: '', status: new URLSearchParams(location.search).get('status') ?? '', inactive: '' });
  const [rows, setRows] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null>(null);
  const [card, setCard] = useIdParam();
  const [view, setView] = useState<number | null>(card);
  const file = useRef<HTMLInputElement>(null);
  const load = useCallback(() => api.get('/inventory/items' + qs(f)).then(setRows), [f]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const after = async () => { await Promise.all([load(), reload()]); };

  const importFile = async (fl: File | undefined) => {
    if (!fl) return;
    const r = await app.run(() => api.upload('/inventory/items/import', fl));
    if (file.current) file.current.value = '';
    if (r) { await app.alert(r.message, 'Import items'); await after(); }
  };
  const remove = async (r: any) => {
    if (!(await app.confirm(`Delete the item ${r.Code} ${r.Name}?`))) return;
    if (await app.run(() => api.del(`/inventory/items/${r.Id}`))) await after();
  };
  const total = rows.reduce((a, r) => a + r.Value, 0);

  return (
    <Page title="Items & Stock" icon="table" toolbar={
      <>
        {me.manage && <Button variant="primary" icon="add" onClick={() => setEdit({ Unit: 'Nos', GstRate: 18, IsActive: true })}>Add item</Button>}
        {me.manage && <><Button icon="import" onClick={() => file.current?.click()}>Import Excel</Button>
          <input ref={file} type="file" accept=".xlsx" className="hidden" onChange={(e) => importFile(e.target.files?.[0])} />
          <Button icon="download" onClick={() => app.run(() => api.download('/inventory/items/template'))}>Import template</Button></>}
        <Button icon="export" onClick={() => app.run(() => api.download('/inventory/reports/stock/file' + qs({ warehouse: f.warehouse, category: f.category })))}>Excel</Button>
      </>
    } bodyClass="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Search"><Input className="w-52" value={f.q} placeholder="Code or name" onChange={(e) => setF({ ...f, q: e.target.value })} /></Field>
        <Field label="Category"><Select className="w-44" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          <option value="">All</option>{lk.categories.map((c) => <option key={c.Id} value={c.Id}>{c.Name}</option>)}</Select></Field>
        <Field label="Store"><Select className="w-40" value={f.warehouse} onChange={(e) => setF({ ...f, warehouse: e.target.value })}>
          <option value="">All stores</option>{lk.warehouses.map((w) => <option key={w.Id} value={w.Id}>{w.Name}</option>)}</Select></Field>
        <Field label="Status"><Select className="w-40" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">All</option><option value="Reorder">Re-order needed</option><option value="Low">Low stock</option><option value="Out">Out of stock</option><option value="OK">In stock</option></Select></Field>
        <div className="pb-2"><Check label="Show inactive" checked={f.inactive === '1'} onChange={(v) => setF({ ...f, inactive: v ? '1' : '' })} /></div>
        <span className="ml-auto pb-2 text-xs text-slate-500">{rows.length} item(s) · value <b className="text-slate-700">{inr(total)}</b></span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <DataTable rows={rows} rowKey={(r) => r.Id} onDoubleClick={(r) => setView(r.Id)} empty="No items. Add one or import them from Excel."
          rowClass={(r) => (r.IsActive ? '' : 'text-slate-400')}
          columns={[
            { key: 'Code', header: 'Code' }, { key: 'Name', header: 'Item' }, { key: 'Category', header: 'Category' },
            { key: 'Qty', header: f.warehouse ? 'Stock (store)' : 'Stock', align: 'right', render: (r) => `${qty(r.Qty)} ${r.Unit}` },
            { key: 'AvgCost', header: 'Avg cost', align: 'right', render: (r) => inr(r.AvgCost) },
            { key: 'Value', header: 'Value', align: 'right', render: (r) => inr(r.Value) },
            { key: 'ReorderLevel', header: 'Re-order at', align: 'right', render: (r) => (Number(r.ReorderLevel) ? qty(r.ReorderLevel) : '—') },
            { key: 'OnOrder', header: 'On order', align: 'right', render: (r) => (r.OnOrder ? qty(r.OnOrder) : '') },
            { key: 'Status', header: 'Status', render: (r) => <Badge value={r.Status} /> },
            { key: 'TrackBy', header: 'Type', render: (r) => `${itemKind(r)}${r.IsReturnable && r.ReturnDays ? ` (${r.ReturnDays} d)` : ''}` },
            { key: 'Supplier', header: 'Supplier' },
            { key: 'Actions', header: '', sortable: false, render: (r) => (
              <span className="flex gap-1">
                <Button onClick={() => setView(r.Id)}>Card</Button>
                {me.manage && <><Button icon="edit" onClick={() => setEdit({ ...r })}>Edit</Button><Button variant="danger" icon="trash" onClick={() => remove(r)} aria-label="Delete" /></>}
              </span>) },
          ]} />
      </div>
      {edit && <ItemDialog item={edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await after(); }} />}
      {view && <ItemCard id={view} onClose={() => { setView(null); setCard(); }} />}
    </Page>
  );
}

function ItemDialog({ item, onClose, onSaved }: { item: any; onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const { lk } = useInv();
  const [f, setF] = useState<any>({ ReorderLevel: 0, ReorderQty: 0, PurchasePrice: 0, ReturnDays: 0, TrackBy: 'Qty', Barcode: '', ...item, Category: undefined });
  const wasSerial = item.Id && item.TrackBy === 'Serial';
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  const save = async () => {
    const r = await app.run(() => (f.Id ? api.put(`/inventory/items/${f.Id}`, f) : api.post('/inventory/items', f)));
    if (r) onSaved();
  };
  return (
    <Modal title={f.Id ? `Edit ${item.Code} — ${item.Name}` : 'Add item'} onClose={onClose} width="max-w-2xl"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="save" onClick={save}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Code" hint={f.Id ? undefined : 'Empty = ITM-0001 …'}><Input value={f.Code ?? ''} onChange={(e) => set('Code', e.target.value)} /></Field>
        <Field label="Item name *" className="col-span-2 sm:col-span-3"><Input value={f.Name ?? ''} onChange={(e) => set('Name', e.target.value)} /></Field>
        <Field label="Category" className="col-span-2"><Select value={f.CategoryId ?? ''} onChange={(e) => set('CategoryId', e.target.value || null)}>
          <option value="">—</option>{lk.categories.map((c) => <option key={c.Id} value={c.Id}>{c.Name}</option>)}</Select></Field>
        <Field label="Unit"><Input list="inv-units" value={f.Unit ?? ''} onChange={(e) => set('Unit', e.target.value)} /><datalist id="inv-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist></Field>
        <Field label="HSN / SAC"><Input value={f.Hsn ?? ''} onChange={(e) => set('Hsn', e.target.value)} /></Field>
        <Field label="Purchase price (₹)"><Input type="number" step="any" min={0} value={f.PurchasePrice} onChange={(e) => set('PurchasePrice', e.target.value)} /></Field>
        <Field label="GST %"><Select value={String(f.GstRate)} onChange={(e) => set('GstRate', Number(e.target.value))}>{GST.map((g) => <option key={g} value={g}>{g}</option>)}</Select></Field>
        <Field label="Preferred supplier" className="col-span-2"><Select value={f.PreferredSupplierId ?? ''} onChange={(e) => set('PreferredSupplierId', e.target.value || null)}>
          <option value="">— none (no automatic PO) —</option>{lk.suppliers.filter((s) => s.IsActive || s.Id === f.PreferredSupplierId).map((s) => <option key={s.Id} value={s.Id}>{s.Name}</option>)}</Select></Field>
        <Field label="Re-order level" hint="At or below: alert + PO"><Input type="number" step="any" min={0} value={f.ReorderLevel} onChange={(e) => set('ReorderLevel', e.target.value)} /></Field>
        <Field label="Re-order quantity" hint="0 = up to 2× level"><Input type="number" step="any" min={0} value={f.ReorderQty} onChange={(e) => set('ReorderQty', e.target.value)} /></Field>
        <Field label="Tracking" className="col-span-2" hint={f.TrackBy === 'Serial' ? 'Every unit gets a serial number and an RFID / QR tag (Units & Tags)' : 'Counted: consumables, pens, wires, components'}>
          <Select value={f.TrackBy} disabled={!!wasSerial} onChange={(e) => set('TrackBy', e.target.value)}>
            <option value="Qty">By quantity</option><option value="Serial">By serial — each unit tagged (boom barrier, turnstile, laptop …)</option></Select></Field>
        <Field label="Barcode / QR on the pack" className="col-span-2" hint="Scanning it picks this item (empty = the item code)"><Input value={f.Barcode ?? ''} onChange={(e) => set('Barcode', e.target.value)} /></Field>
        {f.TrackBy !== 'Serial' && <div className="col-span-2 flex items-center pt-4"><Check label="Returnable (tools, pens, wires to give back …)" checked={!!f.IsReturnable} onChange={(v) => set('IsReturnable', v)} /></div>}
        {(f.IsReturnable || f.TrackBy === 'Serial') && <Field label="Due back after (days)" hint="0 = no due date"><Input type="number" min={0} value={f.ReturnDays} onChange={(e) => set('ReturnDays', e.target.value)} /></Field>}
        <div className="col-span-2 flex items-center pt-4"><Check label="Active" checked={f.IsActive !== false} onChange={(v) => set('IsActive', v)} /></div>
        <Field label="Description" className="col-span-2 sm:col-span-4"><TextArea rows={2} value={f.Description ?? ''} onChange={(e) => set('Description', e.target.value)} /></Field>
        {!f.Id && (
          <>
            <Field label="Opening stock"><Input type="number" step="any" min={0} value={f.OpeningQty ?? ''} onChange={(e) => set('OpeningQty', e.target.value)} /></Field>
            <Field label="at location" className="col-span-1"><LocationSelect warehouseId={f.OpeningWarehouseId ?? lk.warehouses.find((w) => w.IsActive)?.Id}
              value={f.OpeningLocationId ?? ''} onChange={(id) => set('OpeningLocationId', id || null)} /></Field>
            <Field label="in store" className="col-span-1 sm:col-span-2"><Select value={f.OpeningWarehouseId ?? ''} onChange={(e) => { set('OpeningWarehouseId', e.target.value || null); set('OpeningLocationId', null); }}>
              <option value="">Default store</option>{lk.warehouses.filter((w) => w.IsActive).map((w) => <option key={w.Id} value={w.Id}>{w.Name}</option>)}</Select></Field>
            <div className="col-span-2 sm:col-span-4"><Note>The opening stock is valued at the purchase price. Later changes of stock go through receipts, issues or adjustments.</Note></div>
          </>
        )}
      </div>
    </Modal>
  );
}

function ItemCard({ id, onClose }: { id: number; onClose: () => void }) {
  const app = useApp();
  const [d, setD] = useState<any>(null);
  useEffect(() => { app.run(() => api.get(`/inventory/items/${id}`).then(setD)); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title={d ? `${d.Code} — ${d.Name}` : 'Item'} onClose={onClose} width="max-w-4xl">
      {!d ? 'Loading…' : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-4">
            <span>Category: <b>{d.Category ?? '—'}</b></span><span>Unit: <b>{d.Unit}</b></span><span>HSN: <b>{d.Hsn ?? '—'}</b> · GST {Number(d.GstRate)} %</span>
            <span>Last price: <b>{inr(d.PurchasePrice)}</b></span><span>Re-order at: <b>{qty(d.ReorderLevel)}</b> (qty {qty(d.ReorderQty)})</span>
            <span>Supplier: <b>{d.Supplier ?? '—'}</b></span><span>{itemKind(d)}{d.IsReturnable ? `, return in ${d.ReturnDays || 'no'} days` : ''}</span>
            <span>Barcode: <b>{d.Barcode || d.Code}</b></span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button icon="print" onClick={() => printLabels([{ code: d.Barcode || d.Code, title: d.Name, sub: d.Code }], d.Code)}>Item QR label</Button>
            {d.TrackBy === 'Serial' && <>
              <span className="text-[13px]">Units: {d.Units.map((u: any) => <span key={u.Status} className="mr-2"><Badge value={u.Status} /> {u.N}</span>)}
                {d.Units.some((u: any) => u.Untagged) && <span className="text-amber-700">{d.Units.reduce((a: number, u: any) => a + u.Untagged, 0)} without tag</span>}</span>
              <a className="text-[13px] text-brand-700 underline" href={`/inventory/units?item=${d.Id}`}>Open units</a></>}
          </div>
          <div className="flex flex-wrap gap-2">
            {d.Stock.map((s: any) => <div key={s.WarehouseId} className="rounded border border-slate-200 px-3 py-1.5 text-[13px]"><div className="text-xs text-slate-500">{s.Warehouse}</div>
              <b className="tabular-nums">{qty(s.Qty)} {d.Unit}</b> <span className="text-xs text-slate-500">@ {inr(s.AvgCost)}</span></div>)}
          </div>
          {!!d.Locations.length && (
            <div className="text-[13px]"><span className="text-xs text-slate-500">Where it lies: </span>
              {d.Locations.map((l: any) => <span key={l.LocationId} className="mr-2 inline-block rounded bg-slate-100 px-1.5 py-0.5" title={l.Units.map((u: any) => u.SerialNo).join(', ')}>
                {l.Warehouse} · <b>{l.IsSystem ? 'RECEIVING' : l.Code}</b> {qty(l.Qty)}</span>)}
            </div>
          )}
          <div className="flex h-80 flex-col overflow-hidden rounded border border-slate-200">
            <DataTable compact rows={d.Movements} rowKey={(r: any) => r.Id} empty="No movements."
              columns={[
                { key: 'At', header: 'When' }, { key: 'Type', header: 'Type' }, { key: 'RefNo', header: 'Doc' }, { key: 'Warehouse', header: 'Store' }, { key: 'Location', header: 'Location' },
                { key: 'Qty', header: 'Qty', align: 'right', render: (r: any) => <span className={Number(r.Qty) < 0 ? 'text-red-700' : 'text-emerald-700'}>{Number(r.Qty) > 0 ? '+' : ''}{qty(r.Qty)}</span> },
                { key: 'BalanceAfter', header: 'Balance', align: 'right', render: (r: any) => qty(r.BalanceAfter) },
                { key: 'UnitCost', header: 'Rate', align: 'right', render: (r: any) => inr(r.UnitCost) },
                { key: 'Employee', header: 'Employee' }, { key: 'Department', header: 'Department' }, { key: 'Note', header: 'Note' }, { key: 'CreatedBy', header: 'By' },
              ]} />
          </div>
        </div>
      )}
    </Modal>
  );
}
