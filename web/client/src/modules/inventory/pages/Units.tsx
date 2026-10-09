/**
 * Units & Tags: every unit of the serial items (boom barriers, turnstiles, tripods, laptops …) — where it is (store,
 * with whom, installed at which site), its RFID / QR tag and history. Tagging mode: choose the item and scan the labels
 * one after the other; each tag goes on the next unit without one. QR labels can be printed for the units.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, qs } from '../../../api';
import { useApp } from '../../../app';
import { DataTable } from '../../../DataTable';
import { Button, Field, Input, Modal, Note, Page, Select } from '../../../ui';
import { printLabels, ScanBox } from '../scan';
import { Badge, inr, ItemPicker, useInv } from '../shared';

const STATUSES = ['InStore', 'Issued', 'Installed', 'Damaged', 'Lost', 'Scrapped'];

export function Units() {
  const app = useApp();
  const { me, lk } = useInv();
  const [f, setF] = useState({ item: (Number(new URLSearchParams(location.search).get('item')) || null) as number | null, status: '', warehouse: '', q: '', untagged: false });
  const [rows, setRows] = useState<any[]>([]);
  const [view, setView] = useState<number | null>(null);
  const [tagging, setTagging] = useState(false);
  const load = useCallback(() => api.get('/inventory/units' + qs({ ...f, untagged: f.untagged ? 1 : '' })).then(setRows), [f]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const scan = (code: string) => app.run(async () => {
    const r = await api.get('/inventory/scan' + qs({ code }));
    if (r.kind === 'unit') setView(r.unit.Id);
    else if (r.kind === 'item') setF({ ...f, item: r.item.Id });
    else await app.alert(`${r.employee.Name}: open the bin in Employee Bins.`);
  });
  const serialItems = lk.items.filter((i) => i.TrackBy === 'Serial');
  return (
    <Page title="Units & Tags (RFID / QR)" icon="tag" toolbar={
      <>
        <ScanBox className="w-72" onScan={scan} placeholder="Scan a unit's tag or serial" />
        {me.manage && <Button variant="primary" icon="tag" onClick={() => setTagging(true)}>Tag units</Button>}
        <Button icon="print" onClick={() => app.run(() => printLabels(rows.map((u) => ({ code: u.Tag || u.SerialNo, title: u.Item, sub: `S/N ${u.SerialNo}` })), 'Unit labels'))}
          disabled={!rows.length}>Print QR labels ({rows.length})</Button>
        <Button icon="export" onClick={() => app.run(() => api.download('/inventory/reports/units/file' + qs({ item: f.item ?? '', warehouse: f.warehouse, format: 'xlsx' })))}>Excel</Button>
      </>
    } bodyClass="flex flex-col">
      <div className="flex flex-wrap items-end gap-2 pb-2">
        <Field label="Item"><ItemPicker className="w-64" activeOnly={false} value={f.item} onChange={(id) => setF({ ...f, item: id })} /></Field>
        <Field label="Status"><Select className="w-36" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s === 'InStore' ? 'In store' : s}</option>)}</Select></Field>
        <Field label="Store"><Select className="w-40" value={f.warehouse} onChange={(e) => setF({ ...f, warehouse: e.target.value })}>
          <option value="">All</option>{lk.warehouses.map((w) => <option key={w.Id} value={w.Id}>{w.Name}</option>)}</Select></Field>
        <Field label="Search"><Input className="w-48" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Serial, tag, employee, site" /></Field>
        <label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" checked={f.untagged} onChange={(e) => setF({ ...f, untagged: e.target.checked })} /> without tag only</label>
        <span className="ml-auto pb-2 text-xs text-slate-500">{rows.length} unit(s) · {rows.filter((r) => !r.Tag).length} without tag</span>
      </div>
      {!serialItems.length && <Note tone="info">No item is tracked by serial yet. Items & Stock → Edit → Tracking: "Serial (each unit with its own RFID / QR tag)" — for boom barriers, turnstiles, tripods, laptops …</Note>}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <DataTable rows={rows} rowKey={(r) => r.Id} onDoubleClick={(r) => setView(r.Id)} empty="No units."
          columns={[
            { key: 'Item', header: 'Item', render: (r) => `${r.Code} — ${r.Item}` }, { key: 'SerialNo', header: 'Serial No' },
            { key: 'Tag', header: 'RFID / QR tag', render: (r) => r.Tag || <span className="text-xs text-amber-700">no tag</span> },
            { key: 'Status', header: 'Status', render: (r) => <Badge value={r.Status} /> },
            { key: 'Where', header: 'Where', sortable: false, render: (r) => where(r) },
            { key: 'IssueNo', header: 'Issue' }, { key: 'Cost', header: 'Cost', align: 'right', render: (r) => inr(r.Cost) },
            { key: 'Open', header: '', sortable: false, render: (r) => <Button onClick={() => setView(r.Id)}>Open</Button> },
          ]} />
      </div>
      {view && <UnitDialog id={view} onClose={() => { setView(null); load(); }} />}
      {tagging && <TagDialog items={serialItems} first={f.item && serialItems.some((i) => i.Id === f.item) ? f.item : serialItems[0]?.Id ?? null}
        onClose={() => { setTagging(false); load(); }} />}
    </Page>
  );
}

const where = (u: any) => u.Status === 'InStore' ? `${u.Warehouse} · ${u.Location || 'RECEIVING'}` : u.Status === 'Issued' ? `${u.EnrollNo} ${u.Employee}${u.Site ? ` · for ${u.Site}` : ''}`
  : u.Status === 'Installed' ? `at ${u.Site}` : u.Warehouse || '';

export function UnitDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const app = useApp();
  const { me } = useInv();
  const [u, setU] = useState<any>(null);
  const [f, setF] = useState({ SerialNo: '', Tag: '', Note: '' });
  const load = useCallback(async () => {
    const x = await api.get(`/inventory/units/${id}`);
    setU(x); setF({ SerialNo: x.SerialNo, Tag: x.Tag, Note: x.Note });
  }, [id]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => { if (await app.run(() => api.put(`/inventory/units/${id}`, f))) await load(); };
  if (!u) return null;
  return (
    <Modal title={`${u.Code} — ${u.Item} · ${u.SerialNo}`} onClose={onClose} width="max-w-3xl" footer={<>
      <Button icon="print" onClick={() => app.run(() => printLabels([{ code: u.Tag || u.SerialNo, title: u.Item, sub: `S/N ${u.SerialNo}` }], u.SerialNo))}>QR label</Button>
      <span className="flex-1" />{me.manage && <Button variant="primary" icon="save" onClick={save}>Save</Button>}<Button onClick={onClose}>Close</Button></>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]"><Badge value={u.Status} /><span>{where(u) || '—'}</span><span>Cost {inr(u.Cost)}</span><span>Since {u.CreatedAt}</span></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Serial number"><Input value={f.SerialNo} disabled={!me.manage} onChange={(e) => setF({ ...f, SerialNo: e.target.value })} /></Field>
          <Field label="RFID / QR tag" hint="Click here and scan the label"><Input value={f.Tag} disabled={!me.manage} onChange={(e) => setF({ ...f, Tag: e.target.value })} /></Field>
          <Field label="Note"><Input value={f.Note} disabled={!me.manage} onChange={(e) => setF({ ...f, Note: e.target.value })} /></Field>
        </div>
        <div className="flex h-72 flex-col overflow-hidden rounded border border-slate-200">
          <DataTable compact rows={u.Events} rowKey={(r: any) => r.Id} empty="No history."
            columns={[
              { key: 'At', header: 'When' }, { key: 'Event', header: 'What' }, { key: 'RefNo', header: 'Doc' }, { key: 'Warehouse', header: 'Store' }, { key: 'Location', header: 'Location' },
              { key: 'Employee', header: 'Employee', render: (r: any) => (r.Employee ? `${r.EnrollNo ? r.EnrollNo + ' ' : ''}${r.Employee}` : '') },
              { key: 'Site', header: 'Site' }, { key: 'Note', header: 'Note' }, { key: 'CreatedBy', header: 'By' },
            ]} />
        </div>
      </div>
    </Modal>
  );
}

/** Scan labels one after the other: each tag goes on the next unit of the item that has none. */
function TagDialog({ items, first, onClose }: { items: { Id: number; Code: string; Name: string }[]; first: number | null; onClose: () => void }) {
  const [item, setItem] = useState<number | null>(first);
  const [log, setLog] = useState<{ ok: boolean; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const scan = async (tag: string) => {
    if (!item) return;
    setBusy(true);
    try {
      const u = await api.post('/inventory/units/tag-next', { ItemId: item, Tag: tag });
      setLog((l) => [{ ok: true, text: `${tag} → ${u.SerialNo} (${u.Status === 'InStore' ? u.Warehouse : u.Status})` }, ...l]);
    } catch (e: any) {
      setLog((l) => [{ ok: false, text: `${tag}: ${e.message}` }, ...l]);
    } finally { setBusy(false); }
  };
  return (
    <Modal title="Tag units" onClose={onClose} width="max-w-xl">
      <div className="space-y-3">
        <Field label="Item"><Select value={item ?? ''} onChange={(e) => setItem(Number(e.target.value) || null)}>
          {items.map((i) => <option key={i.Id} value={i.Id}>{i.Code} — {i.Name}</option>)}</Select></Field>
        <ScanBox autoFocus busy={busy} onScan={scan} placeholder="Scan the RFID / QR label stuck on the unit" />
        <Note>Stick a label on each unit, then scan it here: it goes on the next unit without a tag (units in a store first). To give a tag to one exact unit, open the unit instead.</Note>
        <ul className="max-h-60 space-y-1 overflow-auto text-sm">{log.map((l, i) => <li key={i} className={l.ok ? 'text-emerald-700' : 'text-red-700'}>{l.ok ? '✓' : '✗'} {l.text}</li>)}</ul>
      </div>
    </Modal>
  );
}

