/**
 * Locations: the racks of every store with their rows and columns (R03-2-4). Every quantity in a store lies on a
 * location; goods booked in without one wait on RECEIVING (the inward counter) until they are put away. Put away / move:
 * scan the rack position's label, then the items (unit tags, item barcodes with a quantity).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, qs } from '../../../api';
import { useApp } from '../../../app';
import { Button, Field, Input, Modal, Note, Page, Select, Tabs } from '../../../ui';
import { printLabels, ScanBox } from '../scan';
import { inr, qty, useInv } from '../shared';

type Tab = 'racks' | 'move';
interface Loc { Id: number; WarehouseId: number; Warehouse: string; Code: string; Rack: string; RowNo: string; ColNo: string; Tag: string; IsSystem: boolean; IsActive: boolean; Items: number; Qty: number }

export function Locations() {
  const { lk, me } = useInv();
  const [w, setW] = useState<number>(lk.warehouses.find((x) => x.IsActive)?.Id ?? 0);
  const [tab, setTab] = useState<Tab>('racks');
  return (
    <Page title="Locations (rack / row / column)" icon="table" toolbar={
      <Field label="Store"><Select className="w-48" value={w} onChange={(e) => setW(Number(e.target.value))}>
        {lk.warehouses.map((x) => <option key={x.Id} value={x.Id}>{x.Name}</option>)}</Select></Field>
    } bodyClass="flex flex-col gap-2">
      <PutAwayBanner warehouseId={w} onOpen={() => setTab('move')} />
      <Tabs tabs={[{ key: 'racks' as Tab, label: 'Racks' }, ...(me.manage ? [{ key: 'move' as Tab, label: 'Put away / move (scan)' }] : [])]} value={tab} onChange={setTab} />
      {tab === 'racks' ? <Racks warehouseId={w} /> : <Move warehouseId={w} />}
    </Page>
  );
}

function PutAwayBanner({ warehouseId, onOpen }: { warehouseId: number; onOpen: () => void }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api.get('/inventory/locations/put-away').then(setRows).catch(() => {}); }, [warehouseId]);
  const r = rows.find((x) => x.WarehouseId === warehouseId);
  if (!r) return null;
  return <Note tone="warn">{`${r.Items} item(s), ${qty(r.Qty)} piece(s) are on RECEIVING in ${r.Warehouse}: put them away onto the racks. `}<button type="button" className="underline" onClick={onOpen}>Put away now</button></Note>;
}

function Racks({ warehouseId }: { warehouseId: number }) {
  const app = useApp();
  const { me, reload } = useInv();
  const [rows, setRows] = useState<Loc[]>([]);
  const [add, setAdd] = useState(false);
  const [view, setView] = useState<number | null>(null);
  const load = useCallback(() => api.get('/inventory/locations' + qs({ warehouse: warehouseId })).then(setRows), [warehouseId]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const racks = useMemo(() => {
    const m = new Map<string, Loc[]>();
    for (const l of rows) m.set(l.Rack, [...(m.get(l.Rack) ?? []), l]);
    return [...m];
  }, [rows]);
  const scan = (code: string) => app.run(async () => {
    const r = await api.get('/inventory/scan' + qs({ code }));
    if (r.kind === 'location') setView(r.location.Id);
    else if (r.kind === 'unit') { if (r.unit.LocationId) setView(r.unit.LocationId); else await app.alert(`${r.unit.SerialNo} is not in a store (${r.unit.Status}).`); }
    else if (r.kind === 'item') {
      const where = await api.get('/inventory/locations/where' + qs({ item: r.item.Id }));
      await app.alert(where.length ? `${r.item.Name}:\n${where.map((x: any) => `${x.Warehouse} · ${x.Code}: ${qty(x.Qty)}`).join('\n')}` : `${r.item.Name} is not in stock.`);
    } else await app.alert('Scan a location label, a unit or an item.');
  });
  const labels = (ls: Loc[]) => app.run(() => printLabels(ls.map((l) => ({ code: `LOC-${l.Id}`, title: l.Code, sub: l.Warehouse })), 'Location labels'));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ScanBox className="w-80" onScan={scan} placeholder="Scan a location, unit or item (where is it?)" />
        {me.head && <Button variant="primary" icon="add" onClick={() => setAdd(true)}>Add rack</Button>}
        <Button icon="print" onClick={() => labels(rows.filter((l) => l.IsActive))} disabled={!rows.length}>Print all labels</Button>
        <Button icon="export" onClick={() => app.run(() => api.download('/inventory/reports/locations/file' + qs({ warehouse: warehouseId, format: 'xlsx' })))}>Stock by location (Excel)</Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto scroll-thin">
        {racks.map(([rack, ls]) => {
          const rowsN = [...new Set(ls.map((l) => l.RowNo))].sort((a, b) => Number(a) - Number(b));
          const colsN = [...new Set(ls.map((l) => l.ColNo))].sort((a, b) => Number(a) - Number(b));
          return (
            <div key={rack} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center gap-2">
                <b className="text-brand-900">{rack === 'RECEIVING' ? 'RECEIVING (inward counter)' : `Rack ${rack}`}</b>
                <span className="text-xs text-slate-500">{ls.reduce((a, l) => a + l.Items, 0)} item line(s)</span>
                <span className="flex-1" />
                <Button icon="print" onClick={() => labels(ls)}>Labels</Button>
              </div>
              {rack === 'RECEIVING' ? (
                <button type="button" onClick={() => setView(ls[0].Id)} className={`rounded border px-3 py-2 text-left text-sm ${ls[0].Items ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                  {ls[0].Items ? `${ls[0].Items} item(s) waiting to be put away` : 'Empty'}</button>
              ) : (
                <div className="overflow-x-auto">
                  <table className="border-separate border-spacing-1 text-xs">
                    <thead><tr><th />{colsN.map((c) => <th key={c} className="px-1 font-medium text-slate-500">Col {c}</th>)}</tr></thead>
                    <tbody>{[...rowsN].reverse().map((r) => (
                      <tr key={r}><th className="pr-1 text-right font-medium text-slate-500">Row {r}</th>
                        {colsN.map((c) => {
                          const l = ls.find((x) => x.RowNo === r && x.ColNo === c);
                          if (!l) return <td key={c} />;
                          return (
                            <td key={c}>
                              <button type="button" onClick={() => setView(l.Id)} title={l.Tag ? `RFID ${l.Tag}` : undefined}
                                className={`h-14 w-24 rounded border px-1 text-left align-top ${!l.IsActive ? 'border-dashed border-slate-300 text-slate-400' : l.Items ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                                <div className="font-semibold">{l.Code}</div><div>{l.Items ? `${l.Items} item(s)` : l.IsActive ? 'empty' : 'off'}</div>
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        {!rows.length && <Note>No locations yet. Add a rack: name, number of rows (shelves) and columns.</Note>}
      </div>
      {add && <RackDialog warehouseId={warehouseId} onClose={() => setAdd(false)} onSaved={async () => { setAdd(false); await Promise.all([load(), reload()]); }} />}
      {view && <LocationDialog id={view} onClose={() => { setView(null); load(); }} />}
    </div>
  );
}

function RackDialog({ warehouseId, onClose, onSaved }: { warehouseId: number; onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const [f, setF] = useState({ Rack: '', Rows: '4', Cols: '5' });
  const save = async () => {
    const r = await app.run(() => api.post('/inventory/locations/rack', { ...f, WarehouseId: warehouseId }));
    if (r) { await app.alert(r.message); onSaved(); }
  };
  return (
    <Modal title="Add rack" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="save" onClick={save}>Create locations</Button></>}>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Rack name" hint="e.g. R03 or A"><Input value={f.Rack} onChange={(e) => setF({ ...f, Rack: e.target.value.toUpperCase() })} /></Field>
        <Field label="Rows (shelves)"><Input type="number" min={1} max={50} value={f.Rows} onChange={(e) => setF({ ...f, Rows: e.target.value })} /></Field>
        <Field label="Columns"><Input type="number" min={1} max={50} value={f.Cols} onChange={(e) => setF({ ...f, Cols: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><Note>Makes {f.Rack || 'R'}-1-1 … {f.Rack || 'R'}-{f.Rows}-{f.Cols} (rack-row-column). Adding more rows / columns later keeps the existing ones. Print the labels and stick them on the shelves.</Note></div>
    </Modal>
  );
}

export function LocationDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const app = useApp();
  const { me, reload } = useInv();
  const [l, setL] = useState<any>(null);
  const [tag, setTag] = useState('');
  const load = useCallback(async () => { const x = await api.get(`/inventory/locations/${id}`); setL(x); setTag(x.Tag); }, [id]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!l) return null;
  const save = async (patch: any) => { if (await app.run(() => api.put(`/inventory/locations/${id}`, { Tag: tag, Note: l.Note, IsActive: l.IsActive, ...patch }))) { await load(); await reload(); } };
  const del = async () => {
    if (!(await app.confirm(`Delete location ${l.Code}?`))) return;
    if (await app.run(() => api.del(`/inventory/locations/${id}`))) { await reload(); onClose(); }
  };
  return (
    <Modal title={`${l.Warehouse} · ${l.Code}`} onClose={onClose} width="max-w-3xl" footer={<>
      <Button icon="print" onClick={() => app.run(() => printLabels([{ code: l.Label, title: l.Code, sub: l.Warehouse }], l.Code))}>Label</Button>
      {me.head && !l.IsSystem && <><Button onClick={() => save({ IsActive: !l.IsActive })}>{l.IsActive ? 'Switch off' : 'Switch on'}</Button><Button variant="danger" onClick={del}>Delete</Button></>}
      <span className="flex-1" /><Button onClick={onClose}>Close</Button></>}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3 text-[13px]">
          <span>QR label: <b>{l.Label}</b></span>
          {me.head && <><Field label="RFID tag on this position"><Input className="w-56" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Click and scan the RFID tag" /></Field>
            <Button icon="save" onClick={() => save({})}>Save tag</Button></>}
          {!l.IsActive && <b className="text-red-700">Switched off</b>}
        </div>
        <table className="w-full rounded border border-slate-200 text-[13px]">
          <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-2 py-1.5 text-left">Item</th><th className="px-2 py-1.5 text-right">Qty</th><th className="px-2 py-1.5 text-right">Value</th><th className="px-2 py-1.5 text-left">Serial numbers</th></tr></thead>
          <tbody>
            {l.Items.map((i: any) => <tr key={i.ItemId} className="border-t border-slate-100 align-top"><td className="px-2 py-1">{i.Code} — {i.Name}</td>
              <td className="px-2 py-1 text-right tabular-nums">{qty(i.Qty)} {i.Unit}</td><td className="px-2 py-1 text-right">{inr(i.Value)}</td>
              <td className="px-2 py-1 text-xs">{i.Units.map((u: any) => u.SerialNo).join(', ')}</td></tr>)}
            {!l.Items.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">Empty.</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/** Put away / move: scan the target location, then the goods (from RECEIVING, or from the chosen location). */
function Move({ warehouseId }: { warehouseId: number }) {
  const { lk, reload } = useInv();
  const here = lk.locations.filter((l) => l.WarehouseId === warehouseId);
  const recv = here.find((l) => l.IsSystem)?.Id ?? '';
  const [from, setFrom] = useState<number | ''>(recv);
  const [to, setTo] = useState<{ Id: number; Code: string } | null>(null);
  const [q, setQ] = useState('1');
  const [log, setLog] = useState<{ ok: boolean; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setFrom(recv); setTo(null); }, [warehouseId, recv]);
  const add = (ok: boolean, text: string) => setLog((l) => [{ ok, text }, ...l].slice(0, 100));
  const scan = async (code: string) => {
    setBusy(true);
    try {
      const r = await api.get('/inventory/scan' + qs({ code }));
      if (r.kind === 'location') {
        if (r.location.WarehouseId !== warehouseId) throw new Error(`${r.location.Code} is in ${r.location.Warehouse}.`);
        setTo({ Id: r.location.Id, Code: r.location.Code });
        add(true, `Now putting onto ${r.location.Code}`);
        return;
      }
      if (!to) throw new Error('Scan the location (rack label) first.');
      const line = r.kind === 'unit' ? { Units: [r.unit.Id] } : r.kind === 'item' ? { ItemId: r.item.Id, Qty: q || 1 } : null;
      if (!line) throw new Error('Scan a location, a unit tag or an item barcode.');
      const res = await api.post('/inventory/locations/move', { FromLocationId: from || null, ToLocationId: to.Id, Lines: [line] });
      add(true, `${r.kind === 'unit' ? `${r.unit.Code} ${r.unit.SerialNo}` : `${qty(Number(q || 1))} × ${r.item.Name}`} → ${to.Code} (${res.message.split(':')[0]})`);
      setQ('1');
      void reload();
    } catch (e: any) {
      add(false, `${code}: ${e.message}`);
    } finally { setBusy(false); }
  };
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,28rem)_1fr]">
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <ScanBox autoFocus busy={busy} onScan={scan} placeholder="Scan rack label, then unit tags / item barcodes" />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Take quantity items from"><Select value={from} onChange={(e) => setFrom(Number(e.target.value) || '')}>
            {here.map((l) => <option key={l.Id} value={l.Id}>{l.IsSystem ? 'RECEIVING (inward counter)' : l.Code}</option>)}</Select></Field>
          <Field label="Quantity" hint="Quantity items only"><Input type="number" min={0} step="any" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        </div>
        <div className="text-sm">Putting onto: {to ? <b className="text-emerald-700">{to.Code}</b> : <span className="text-slate-500">scan a rack label</span>}</div>
        <Note>Tagged units move from wherever they lie in this store. Quantity items (pens, wires): set the quantity, then scan the item's barcode.</Note>
      </div>
      <ul className="max-h-[60vh] space-y-1 overflow-auto rounded-lg border border-slate-200 bg-white p-2 text-sm">
        {!log.length && <li className="text-slate-400">Nothing moved yet.</li>}
        {log.map((l, i) => <li key={i} className={l.ok ? 'text-emerald-700' : 'text-red-700'}>{l.ok ? '✓' : '✗'} {l.text}</li>)}
      </ul>
    </div>
  );
}
