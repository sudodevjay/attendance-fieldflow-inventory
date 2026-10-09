/** Stock operations: transfer between stores, adjustments (damage, expiry, found), physical stock count, their history. */
import { useCallback, useEffect, useState } from 'react';
import { api, qs } from '../../../api';
import { useApp } from '../../../app';
import { DataTable } from '../../../DataTable';
import { Button, Card, Field, Input, Note, Page, Select, Tabs } from '../../../ui';
import { inr, LineEditor, linesOut, LocationSelect, newLine, qty, useInv, type Line } from '../shared';

type Tab = 'transfer' | 'adjust' | 'count' | 'history';

export function StockOps() {
  const { me } = useInv();
  const [tab, setTab] = useState<Tab>(me.manage ? 'transfer' : 'history');
  const tabs: { key: Tab; label: string }[] = me.manage
    ? [{ key: 'transfer', label: 'Transfer' }, { key: 'adjust', label: 'Adjustment' }, { key: 'count', label: 'Physical stock count' }, { key: 'history', label: 'History' }]
    : [{ key: 'history', label: 'History' }];
  return (
    <Page title="Transfer / Adjust / Stock Count" icon="sync" bodyClass="flex flex-col gap-3">
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'transfer' && <Transfer done={() => setTab('history')} />}
      {tab === 'adjust' && <Adjust done={() => setTab('history')} />}
      {tab === 'count' && <Count done={() => setTab('history')} />}
      {tab === 'history' && <History />}
    </Page>
  );
}

function StoreSelect({ value, onChange, label }: { value: number | ''; onChange: (v: number) => void; label: string }) {
  const { lk } = useInv();
  return (
    <Field label={label}><Select className="w-52" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      <option value="">— choose —</option>{lk.warehouses.filter((w) => w.IsActive).map((w) => <option key={w.Id} value={w.Id}>{w.Name}</option>)}</Select></Field>
  );
}

function Transfer({ done }: { done: () => void }) {
  const app = useApp();
  const { lk, reload } = useInv();
  const [f, setF] = useState<{ FromWarehouseId: number | ''; ToWarehouseId: number | ''; Reason: string; LocationId: number | ''; ToLocationId: number | '' }>({
    FromWarehouseId: lk.warehouses[0]?.Id ?? '', ToWarehouseId: '', Reason: '', LocationId: '', ToLocationId: '' });
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const save = async () => {
    const r = await app.run(() => api.post('/inventory/stock/transfer', { ...f, LocationId: f.LocationId || null, ToLocationId: f.ToLocationId || null, Lines: linesOut(lines) }));
    if (r) { await reload(); await app.alert(r.message); done(); }
  };
  if (lk.warehouses.filter((w) => w.IsActive).length < 2) return <Note tone="info">Add a second store (Suppliers, Stores, Categories → Stores) to move stock between stores.</Note>;
  return (
    <Card title="Move stock to another store">
      <div className="space-y-3 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <StoreSelect label="From store" value={f.FromWarehouseId} onChange={(v) => setF({ ...f, FromWarehouseId: v, LocationId: '' })} />
          <Field label="from location"><LocationSelect className="w-44" warehouseId={f.FromWarehouseId} value={f.LocationId} auto="Where it lies" onChange={(id) => setF({ ...f, LocationId: id })} /></Field>
          <StoreSelect label="To store" value={f.ToWarehouseId} onChange={(v) => setF({ ...f, ToWarehouseId: v, ToLocationId: '' })} />
          <Field label="to location"><LocationSelect className="w-44" warehouseId={f.ToWarehouseId} value={f.ToLocationId} onChange={(id) => setF({ ...f, ToLocationId: id })} /></Field>
          <Field label="Reason / note" className="min-w-64 flex-1"><Input value={f.Reason} onChange={(e) => setF({ ...f, Reason: e.target.value })} /></Field>
        </div>
        <LineEditor lines={lines} setLines={setLines} warehouseId={f.FromWarehouseId || null} />
        <div className="flex justify-end"><Button variant="primary" icon="save" onClick={save}>Save transfer</Button></div>
      </div>
    </Card>
  );
}

function Adjust({ done }: { done: () => void }) {
  const app = useApp();
  const { lk, reload } = useInv();
  const [f, setF] = useState<{ WarehouseId: number | ''; Reason: string; LocationId: number | '' }>({ WarehouseId: lk.warehouses[0]?.Id ?? '', Reason: '', LocationId: '' });
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const save = async () => {
    const r = await app.run(() => api.post('/inventory/stock/adjust', { ...f, Lines: linesOut(lines) }));
    if (r) { await reload(); await app.alert(r.message); done(); }
  };
  return (
    <Card title="Stock adjustment">
      <div className="space-y-3 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <StoreSelect label="Store" value={f.WarehouseId} onChange={(v) => setF({ ...f, WarehouseId: v, LocationId: '' })} />
          <Field label="Location"><LocationSelect className="w-44" warehouseId={f.WarehouseId} value={f.LocationId} onChange={(id) => setF({ ...f, LocationId: id })} /></Field>
          <Field label="Reason *" className="min-w-64 flex-1"><Input list="inv-adj-reasons" value={f.Reason} onChange={(e) => setF({ ...f, Reason: e.target.value })} />
            <datalist id="inv-adj-reasons">{['Damaged', 'Expired', 'Lost / theft', 'Found in store', 'Opening balance', 'Correction'].map((r) => <option key={r} value={r} />)}</datalist></Field>
        </div>
        <LineEditor lines={lines} setLines={setLines} warehouseId={f.WarehouseId || null} signed />
        <Note>+ adds stock (valued at the average cost, or the item's purchase price), − removes it. Removing stock can start an automatic re-order.</Note>
        <div className="flex justify-end"><Button variant="primary" icon="save" onClick={save}>Save adjustment</Button></div>
      </div>
    </Card>
  );
}

function Count({ done }: { done: () => void }) {
  const app = useApp();
  const { lk, reload } = useInv();
  const [w, setW] = useState<number | ''>(lk.warehouses[0]?.Id ?? '');
  const [cat, setCat] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [counted, setCounted] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [loc, setLoc] = useState<number | ''>('');
  useEffect(() => {
    if (!w || !loc) return;
    app.run(async () => {
      const [items, here] = await Promise.all([api.get('/inventory/items' + qs({ category: cat })), api.get(`/inventory/locations/${loc}`)]);
      const atLoc = new Map<number, number>(here.Items.map((i: any) => [i.ItemId, i.Qty]));
      setRows(items.map((i: any) => ({ ...i, Qty: atLoc.get(i.Id) ?? 0 })).sort((a: any, b: any) => (b.Qty !== 0 ? 1 : 0) - (a.Qty !== 0 ? 1 : 0)));
      setCounted({});
    });
  }, [w, cat, loc]); // eslint-disable-line react-hooks/exhaustive-deps
  const entered = rows.filter((r) => counted[r.Id] !== undefined && counted[r.Id] !== '');
  const diff = (r: any) => Number(counted[r.Id]) - r.Qty;
  const save = async () => {
    if (!entered.length) return app.alert('Enter the counted quantity of at least one item. Items left empty are not changed.');
    const changes = entered.filter((r) => diff(r) !== 0).length;
    if (!(await app.confirm(`${entered.length} item(s) counted, ${changes} differ from the books. Correct the stock?`))) return;
    const r = await app.run(() => api.post('/inventory/stock/count', { WarehouseId: w, LocationId: loc, Reason: reason, Lines: entered.map((x) => ({ ItemId: x.Id, Counted: counted[x.Id] })) }));
    if (r) { await reload(); await app.alert(r.message); done(); }
  };
  return (
    <Card title="Physical stock count" actions={<Button variant="primary" icon="save" onClick={save}>Post count</Button>}>
      <div className="flex flex-wrap items-end gap-3 p-3">
        <StoreSelect label="Store" value={w} onChange={(v) => { setW(v); setLoc(''); }} />
        <Field label="Location (count one rack position at a time)"><LocationSelect className="w-48" warehouseId={w} value={loc} onChange={setLoc} /></Field>
        <Field label="Category"><Select className="w-44" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All</option>{lk.categories.map((c) => <option key={c.Id} value={c.Id}>{c.Name}</option>)}</Select></Field>
        <Field label="Note" className="min-w-64 flex-1"><Input value={reason} placeholder="e.g. Quarterly count Sep 2026" onChange={(e) => setReason(e.target.value)} /></Field>
        <Button icon="export" onClick={() => app.run(() => api.download('/inventory/reports/stock/file' + qs({ warehouse: w, category: cat })))}>Count sheet (Excel)</Button>
      </div>
      <div className="flex max-h-[55vh] min-h-0 flex-col">
        <DataTable rows={rows} rowKey={(r) => r.Id} empty="No items."
          columns={[
            { key: 'Code', header: 'Code' }, { key: 'Name', header: 'Item' }, { key: 'Category', header: 'Category' },
            { key: 'Qty', header: 'Book stock here', align: 'right', render: (r) => `${qty(r.Qty)} ${r.Unit}` },
            { key: 'Counted', header: 'Counted', sortable: false, render: (r) => <Input type="number" step="any" min={0} className="w-28" value={counted[r.Id] ?? ''} onChange={(e) => setCounted({ ...counted, [r.Id]: e.target.value })} aria-label={`Counted ${r.Name}`} /> },
            { key: 'Diff', header: 'Difference', align: 'right', sortable: false, render: (r) => {
              if (counted[r.Id] === undefined || counted[r.Id] === '') return '';
              const d = diff(r);
              return <span className={d < 0 ? 'font-semibold text-red-700' : d > 0 ? 'font-semibold text-emerald-700' : 'text-slate-400'}>{d > 0 ? '+' : ''}{qty(d)}{d ? ` (${inr(d * r.AvgCost)})` : ''}</span>;
            } },
          ]} />
      </div>
    </Card>
  );
}

function History() {
  const app = useApp();
  const [kind, setKind] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const load = useCallback(() => api.get('/inventory/stock/documents' + qs({ kind })).then(setRows), [kind]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="flex items-end gap-2">
        <Field label="Kind"><Select className="w-40" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All</option><option>Transfer</option><option>Adjustment</option><option value="Count">Stock count</option></Select></Field>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <DataTable rows={rows} rowKey={(r) => r.Id} empty="Nothing yet."
          columns={[
            { key: 'DocNo', header: 'No' }, { key: 'CreatedAt', header: 'Date' }, { key: 'Kind', header: 'Kind' },
            { key: 'Warehouse', header: 'Store', render: (r) => (r.ToWarehouse ? `${r.Warehouse} → ${r.ToWarehouse}` : r.Warehouse) },
            { key: 'Lines', header: 'Items', sortable: false, render: (r) => <span className="block max-w-[28rem] truncate">{r.Lines.map((l: any) => `${l.Name} ${l.Qty > 0 && r.Kind !== 'Transfer' ? '+' : ''}${qty(l.Qty)}`).join(', ')}</span> },
            { key: 'Reason', header: 'Reason' }, { key: 'CreatedBy', header: 'By' },
          ]} />
      </div>
    </>
  );
}
