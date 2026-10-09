/**
 * Employee portal (/me/store): ask the store for material (optionally for a work site), follow the requests, record what
 * was installed at a site, see the returnable items one holds.
 */
import { useMemo, useState } from 'react';
import { useApp } from '../../app';
import { Button, Field, Icon, Input, Select } from '../../ui';
import { Section } from '../../portal/PortalApp';
import { Loading, useLoad, Wrap } from '../../portal/PortalPages';
import { papi } from '../../portal/papi';
import { Badge, qty } from './shared';

interface CatItem { Id: number; Code: string; Name: string; Unit: string; Category: string; IsReturnable: boolean; InStock: boolean }
interface Row { key: number; ItemId: number | ''; Qty: string }
let seq = 1;

export function StorePortal() {
  const app = useApp();
  const [cat] = useLoad<{ warehouseId: number | null; warehouses: { Id: number; Name: string }[]; sites: { Id: number; Name: string }[]; items: CatItem[] }>(() => papi.get('/store/catalog'), []);
  const [atSite, reloadAtSite] = useLoad<any[]>(() => papi.get('/store/site-material'), []);
  const [mine, reloadMine] = useLoad<any[]>(() => papi.get('/store/requisitions'), []);
  const [bin] = useLoad<any>(() => papi.get('/store/bin'), []);
  const [rows, setRows] = useState<Row[]>([{ key: seq++, ItemId: '', Qty: '1' }]);
  const [purpose, setPurpose] = useState('');
  const [store, setStore] = useState<number | ''>('');
  const [site, setSite] = useState<number | ''>('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const shown = useMemo(() => (cat?.items ?? []).filter((i) => !filter || `${i.Code} ${i.Name} ${i.Category}`.toLowerCase().includes(filter.toLowerCase())), [cat, filter]);

  if (!cat) return <Loading />;
  const send = async () => {
    setBusy(true);
    const r = await app.run(() => papi.post('/store/requisitions', {
      Purpose: purpose, WarehouseId: store || cat.warehouseId, SiteId: site || null, Lines: rows.filter((x) => x.ItemId).map((x) => ({ ItemId: x.ItemId, Qty: x.Qty })),
    }));
    setBusy(false);
    if (r) { await app.alert(r.message); setRows([{ key: seq++, ItemId: '', Qty: '1' }]); setPurpose(''); setSite(''); reloadMine(); reloadAtSite(); }
  };
  const cancel = async (id: number) => {
    if (!(await app.confirm('Cancel this request?'))) return;
    if (await app.run(() => papi.post(`/store/requisitions/${id}/cancel`))) reloadMine();
  };
  const set = (key: number, patch: Partial<Row>) => setRows(rows.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  return (
    <Wrap>
      <Section title="Request material from the store" icon="report">
        {!cat.items.length ? <p className="text-sm text-slate-500">The store has no items yet.</p> : (
          <div className="space-y-3">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search items" aria-label="Search items" className="sm:w-72" />
            {rows.map((x) => (
              <div key={x.key} className="flex flex-wrap items-center gap-2">
                <Select className="min-w-0 flex-1" value={x.ItemId} onChange={(e) => set(x.key, { ItemId: e.target.value ? Number(e.target.value) : '' })} aria-label="Item">
                  <option value="">— choose an item —</option>
                  {shown.map((i) => <option key={i.Id} value={i.Id}>{i.Name} ({i.Unit}){i.InStock ? '' : ' — not in stock now'}</option>)}
                </Select>
                <Input type="number" min={0} step="any" className="w-24" value={x.Qty} onChange={(e) => set(x.key, { Qty: e.target.value })} aria-label="Quantity" />
                <button type="button" aria-label="Remove" className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  onClick={() => setRows(rows.length > 1 ? rows.filter((r) => r.key !== x.key) : rows)}><Icon name="close" /></button>
              </div>
            ))}
            <Button icon="add" onClick={() => setRows([...rows, { key: seq++, ItemId: '', Qty: '1' }])}>Another item</Button>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Purpose" className="sm:col-span-2"><Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What is it for?" /></Field>
              {cat.sites.length > 0 && <Field label="For work site"><Select value={site} onChange={(e) => setSite(e.target.value ? Number(e.target.value) : '')}>
                <option value="">— not for a site —</option>{cat.sites.map((s) => <option key={s.Id} value={s.Id}>{s.Name}</option>)}</Select></Field>}
              {cat.warehouses.length > 1 && <Field label="Store"><Select value={store || cat.warehouseId || ''} onChange={(e) => setStore(Number(e.target.value))}>
                {cat.warehouses.map((w) => <option key={w.Id} value={w.Id}>{w.Name}</option>)}</Select></Field>}
            </div>
            <Button variant="primary" busy={busy} onClick={send}>Send request</Button>
          </div>
        )}
      </Section>

      <Section title="My requests">
        {!mine ? <Loading /> : !mine.length ? <p className="text-sm text-slate-500">No requests yet.</p> : (
          <ul className="divide-y divide-slate-100">
            {mine.map((r) => (
              <li key={r.Id} className="flex flex-wrap items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800">{r.ReqNo} <span className="font-normal text-slate-500">· {r.CreatedAt}</span></div>
                  <div className="text-sm text-slate-600">{r.Lines.map((l: any) => `${l.Name} × ${qty(l.Qty)} ${l.Unit}${l.IssuedQty ? ` (got ${qty(l.IssuedQty)})` : ''}`).join(', ')}</div>
                  {(r.Site || r.Purpose) && <div className="text-xs text-slate-500">{[r.Site && `Site: ${r.Site}`, r.Purpose].filter(Boolean).join(' · ')}</div>}
                  {r.DecisionNote && <div className="text-xs text-slate-500">Note: {r.DecisionNote}</div>}
                </div>
                <Badge value={r.Status} />
                {r.Status === 'Pending' && <Button variant="danger" onClick={() => cancel(r.Id)}>Cancel</Button>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {!!atSite?.length && <SiteUsage docs={atSite} onSaved={reloadAtSite} />}

      <Section title={bin ? `My bin ${bin.Bin}` : 'My bin'} icon="box">
        {!bin ? <Loading /> : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <span>Open items: <b className={bin.Full ? 'text-red-600' : ''}>{bin.Open}{bin.Limit ? ` of ${bin.Limit}` : ''}</b>{bin.Full ? ' — full: give something back before asking for more' : ''}</span>
              <span>Taken: <b>{qty(bin.Totals.Taken)}</b></span><span>Installed at sites: <b>{qty(bin.Totals.Installed)}</b></span><span>Given back: <b>{qty(bin.Totals.Returned)}</b></span>
            </div>
            {!bin.Lines.some((l: any) => l.Open > 0) ? <p className="text-sm text-slate-500">Your bin is empty.</p> : (
              <ul className="divide-y divide-slate-100">
                {bin.Lines.filter((l: any) => l.Open > 0).map((l: any) => (
                  <li key={l.LineId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">{l.Item} × {qty(l.Open)} {l.Unit}<span className="text-slate-500"> · {l.IssuedOn}{l.Site ? ` · for ${l.Site}` : ''}</span>
                      {!!l.Units.length && <span className="block text-xs text-slate-500">{l.Units.filter((u: any) => u.Status === 'Out').map((u: any) => u.SerialNo).join(', ')}</span>}</span>
                    {l.DueDate && <span className={l.Overdue ? 'font-semibold text-red-600' : 'text-slate-600'}>due {l.DueDate}</span>}
                    <Badge value={l.Overdue ? 'Overdue' : l.Status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Section>
    </Wrap>
  );
}

/** Material the employee took for a site: enter what was installed there (the rest goes back to the store as a return). */
function SiteUsage({ docs, onSaved }: { docs: any[]; onSaved: () => void }) {
  const app = useApp();
  const [q, setQ] = useState<Record<number, string>>({});
  const [note, setNote] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const save = async (d: any) => {
    setBusy(d.Id);
    const r = await app.run(() => papi.post(`/store/issues/${d.Id}/consume`, { Note: note[d.Id] ?? '', Lines: d.Lines.map((l: any) => ({ LineId: l.LineId, Qty: q[l.LineId] ?? '' })) }));
    setBusy(null);
    if (r) { await app.alert(r.message); setQ({}); onSaved(); }
  };
  return (
    <Section title="Material at sites (mark what was installed)" icon="check">
      <div className="space-y-4">
        {docs.map((d) => (
          <div key={d.Id} className="rounded-md border border-slate-200 p-3">
            <div className="mb-2 text-sm font-medium text-slate-800">{d.Site} <span className="font-normal text-slate-500">· {d.IssueNo} · {d.IssuedOn}</span></div>
            <ul className="space-y-2">
              {d.Lines.map((l: any) => (
                <li key={l.LineId} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1">{l.Name} <span className="text-slate-500">· at site {qty(l.Open)} {l.Unit}{l.Installed ? ` · installed ${qty(l.Installed)}` : ''}</span></span>
                  <Input type="number" min={0} step="any" className="w-24" value={q[l.LineId] ?? ''} placeholder="Installed" aria-label={`Installed ${l.Name}`}
                    onChange={(e) => setQ({ ...q, [l.LineId]: e.target.value })} />
                  <Button onClick={() => setQ({ ...q, [l.LineId]: String(l.Open) })}>All</Button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <Input className="min-w-0 flex-1" value={note[d.Id] ?? ''} onChange={(e) => setNote({ ...note, [d.Id]: e.target.value })} placeholder="Where / note (optional)" aria-label="Note" />
              <Button variant="primary" busy={busy === d.Id} onClick={() => save(d)}>Save installed</Button>
            </div>
          </div>
        ))}
        <p className="text-xs text-slate-500">Left-over material: give it back to the store; the store enters it as a return.</p>
      </div>
    </Section>
  );
}
