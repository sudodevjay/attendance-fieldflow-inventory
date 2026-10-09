/** Shared pieces of the inventory screens: what the user may do, the pick lists, item / employee pickers, line editor. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../api';
import { useApp } from '../../app';
import { Button, Icon, Input, Select } from '../../ui';

/** manage: daily work (StoreKeeper and up); head: approvals, settings, limits, adjustments, deletes. */
export interface InvMe { role: string; manage: boolean; head: boolean; approve: boolean; scoped: boolean }
export interface LkItem {
  Id: number; Code: string; Name: string; Unit: string; PurchasePrice: number; GstRate: number; IsReturnable: boolean; ReturnDays: number; PreferredSupplierId: number | null;
  IsActive: boolean; TrackBy: 'Qty' | 'Serial'; Barcode: string;
}
export interface LkEmployee { Id: number; EnrollNo: string; Name: string; DepartmentId: number | null; Department: string; Designation: string | null }
export interface Lookups {
  employees: LkEmployee[]; departments: { Id: number; Name: string; ParentId: number | null }[];
  warehouses: { Id: number; Name: string; IsActive: boolean }[]; categories: { Id: number; Name: string }[];
  /** work sites of attendance */
  sites: { Id: number; Name: string; IsActive: boolean }[];
  /** rack / row / column positions of the stores; IsSystem = RECEIVING */
  locations: { Id: number; WarehouseId: number; Code: string; IsSystem: boolean; IsActive: boolean }[];
  suppliers: { Id: number; Name: string; IsActive: boolean; LeadTimeDays: number }[]; items: LkItem[];
  stock: { ItemId: number; WarehouseId: number; Qty: number }[];
}

const EMPTY: Lookups = { employees: [], departments: [], warehouses: [], categories: [], suppliers: [], items: [], stock: [], sites: [], locations: [] };
const Ctx = createContext<{ me: InvMe; lk: Lookups; reload: () => Promise<void> } | null>(null);

export function InvProvider({ children }: { children: ReactNode }) {
  const app = useApp();
  const [me, setMe] = useState<InvMe | null>(null);
  const [lk, setLk] = useState<Lookups>(EMPTY);
  const reload = useCallback(async () => { setLk(await api.get('/inventory/lookups')); }, []);
  useEffect(() => {
    app.run(async () => { setMe(await api.get('/inventory/me')); await reload(); });
  }, [reload]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!me) return <div className="grid h-full place-items-center text-slate-500">Loading…</div>;
  return <Ctx.Provider value={{ me, lk, reload }}>{children}</Ctx.Provider>;
}

export function useInv() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useInv outside InvProvider');
  return c;
}

// ------------------------------------------------------------------ formats

const INR = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const inr = (v: number | string | null | undefined) => '₹ ' + INR.format(Number(v ?? 0));
export const qty = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '');
};

const TONES: Record<string, string> = {
  OK: 'bg-green-100 text-green-800', Received: 'bg-green-100 text-green-800', Issued: 'bg-green-100 text-green-800', Approved: 'bg-sky-100 text-sky-800',
  Low: 'bg-amber-100 text-amber-800', Pending: 'bg-amber-100 text-amber-800', Partial: 'bg-amber-100 text-amber-800', PartIssued: 'bg-amber-100 text-amber-800',
  Draft: 'bg-slate-200 text-slate-700', Ordered: 'bg-indigo-100 text-indigo-800',
  Out: 'bg-red-100 text-red-800', Rejected: 'bg-red-100 text-red-800', Cancelled: 'bg-zinc-200 text-zinc-600', Closed: 'bg-zinc-200 text-zinc-700',
  Late: 'bg-red-100 text-red-800', Overdue: 'bg-red-100 text-red-800',
  InStore: 'bg-green-100 text-green-800', Installed: 'bg-indigo-100 text-indigo-800', Transit: 'bg-amber-100 text-amber-800',
  Damaged: 'bg-red-100 text-red-800', Lost: 'bg-red-100 text-red-800', Scrapped: 'bg-zinc-200 text-zinc-600',
  Holds: 'bg-sky-100 text-sky-800', 'At site': 'bg-amber-100 text-amber-800', Cleared: 'bg-green-100 text-green-800', Used: 'bg-zinc-200 text-zinc-600',
};
const LABELS: Record<string, string> = { PartIssued: 'Part issued', OK: 'In stock', Out: 'Out of stock', Low: 'Low stock', InStore: 'In store' };

export function Badge({ value }: { value: string }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONES[value] ?? 'bg-slate-100 text-slate-700'}`}>{LABELS[value] ?? value}</span>;
}

/** Stock of an item in a store (from the lookups), or the total. */
export function stockOf(lk: Lookups, itemId: number, warehouseId?: number | null) {
  return lk.stock.filter((s) => s.ItemId === itemId && (!warehouseId || s.WarehouseId === warehouseId)).reduce((a, s) => a + Number(s.Qty), 0);
}

// ------------------------------------------------------------------ pickers (type to search: code, name / AC No, name)

function Picker<T extends { Id: number }>({ list, value, onChange, label, placeholder, id, className = '', disabled }: {
  list: T[]; value: number | null | undefined; onChange: (id: number | null, row: T | null) => void; label: (r: T) => string;
  placeholder: string; id: string; className?: string; disabled?: boolean;
}) {
  const current = list.find((r) => r.Id === value);
  const [text, setText] = useState(current ? label(current) : '');
  useEffect(() => { setText(current ? label(current) : ''); }, [value, current?.Id]); // eslint-disable-line react-hooks/exhaustive-deps
  const byLabel = useMemo(() => new Map(list.map((r) => [label(r).toLowerCase(), r])), [list, label]);
  const change = (t: string) => {
    setText(t);
    const hit = byLabel.get(t.trim().toLowerCase());
    if (hit) onChange(hit.Id, hit);
    else if (!t.trim()) onChange(null, null);
  };
  const blur = () => {
    if (byLabel.has(text.trim().toLowerCase())) return;
    // A code / AC No typed alone picks the row it belongs to.
    const t = text.trim().toLowerCase();
    const one = t ? list.filter((r) => label(r).toLowerCase().includes(t)) : [];
    if (one.length === 1) { onChange(one[0].Id, one[0]); setText(label(one[0])); } else setText(current ? label(current) : '');
  };
  return (
    <>
      <Input list={id} value={text} onChange={(e) => change(e.target.value)} onBlur={blur} placeholder={placeholder} className={className} disabled={disabled} aria-label={placeholder} />
      <datalist id={id}>{list.map((r) => <option key={r.Id} value={label(r)} />)}</datalist>
    </>
  );
}

const itemLabel = (i: LkItem) => `${i.Code} — ${i.Name} (${i.Unit})`;
const empLabel = (e: LkEmployee) => `${e.EnrollNo} — ${e.Name}${e.Department ? ` (${e.Department})` : ''}`;

export function ItemPicker({ value, onChange, className, activeOnly = true }: { value: number | null; onChange: (id: number | null, item: LkItem | null) => void; className?: string; activeOnly?: boolean }) {
  const { lk } = useInv();
  const list = useMemo(() => (activeOnly ? lk.items.filter((i) => i.IsActive) : lk.items), [lk.items, activeOnly]);
  return <Picker id="inv-items" list={list} value={value} onChange={onChange} label={itemLabel} placeholder="Item: type code or name" className={className} />;
}

export function EmployeePicker({ value, onChange, className, disabled }: { value: number | null; onChange: (id: number | null, e: LkEmployee | null) => void; className?: string; disabled?: boolean }) {
  const { lk } = useInv();
  return <Picker id="inv-employees" list={lk.employees} value={value} onChange={onChange} label={empLabel} placeholder="Employee: type AC No or name" className={className} disabled={disabled} />;
}

/** Work site (attendance → Work Sites). activeOnly: for new documents; empty = no site / all sites (emptyLabel). */
export function SiteSelect({ value, onChange, className, activeOnly, emptyLabel = '— no site —' }: {
  value: number | '' | null | undefined; onChange: (id: number | '') => void; className?: string; activeOnly?: boolean; emptyLabel?: string;
}) {
  const { lk } = useInv();
  const list = activeOnly ? lk.sites.filter((s) => s.IsActive) : lk.sites;
  return (
    <Select className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')} aria-label="Work site">
      <option value="">{emptyLabel}</option>
      {list.map((s) => <option key={s.Id} value={s.Id}>{s.Name}{s.IsActive ? '' : ' (inactive)'}</option>)}
    </Select>
  );
}

/**
 * Location (rack-row-column) of a store. auto: the label of "no location chosen" (e.g. where the goods lie / RECEIVING);
 * without it the first location (RECEIVING) is the default and a location is always chosen.
 */
export function LocationSelect({ warehouseId, value, onChange, auto, className }: {
  warehouseId: number | '' | null | undefined; value: number | '' | null | undefined; onChange: (id: number | '') => void; auto?: string; className?: string;
}) {
  const { lk } = useInv();
  const list = lk.locations.filter((l) => l.WarehouseId === Number(warehouseId) && l.IsActive);
  useEffect(() => {
    if (!auto && list.length && !list.some((l) => l.Id === value)) onChange(list[0].Id);
  }, [warehouseId, list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Select className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')} aria-label="Location">
      {auto && <option value="">{auto}</option>}
      {list.map((l) => <option key={l.Id} value={l.Id}>{l.IsSystem ? 'RECEIVING (inward counter)' : l.Code}</option>)}
    </Select>
  );
}

// ------------------------------------------------------------------ line editor

export interface Line {
  key: number; ItemId: number | null; Qty: string; UnitPrice?: string; GstRate?: string; DueDate?: string;
  /** serial items: the scanned units (empty = the store takes the oldest) */
  Units?: { Id: number; SerialNo: string }[];
}
let seq = 1;
export const newLine = (l: Partial<Line> = {}): Line => ({ key: seq++, ItemId: null, Qty: '', ...l });

/** Item lines of a document. price: rate (+ GST) columns; warehouseId: shows the stock there; due: due date of returnables. */
export function LineEditor({ lines, setLines, price, gst, warehouseId, due, signed }: {
  lines: Line[]; setLines: (l: Line[]) => void; price?: boolean; gst?: boolean; warehouseId?: number | null; due?: boolean;
  /** quantity may be negative (adjustments) */
  signed?: boolean;
}) {
  const { lk } = useInv();
  const set = (key: number, patch: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((a, l) => a + Number(l.Qty || 0) * Number(l.UnitPrice || 0) * (1 + (gst ? Number(l.GstRate || 0) : 0) / 100), 0);
  return (
    <div className="rounded-md border border-slate-200">
      <table className="w-full text-[13px]">
        <thead className="bg-slate-50 text-xs text-slate-600">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">Item</th>
            {warehouseId !== undefined && <th className="w-20 px-2 py-1.5 text-right font-medium">In stock</th>}
            <th className="w-28 px-2 py-1.5 text-left font-medium">{signed ? 'Qty (+ / -)' : 'Quantity'}</th>
            {price && <th className="w-28 px-2 py-1.5 text-left font-medium">Rate (₹)</th>}
            {gst && <th className="w-20 px-2 py-1.5 text-left font-medium">GST %</th>}
            {due && <th className="w-36 px-2 py-1.5 text-left font-medium">Due back</th>}
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const it = lk.items.find((i) => i.Id === l.ItemId);
            const have = l.ItemId ? stockOf(lk, l.ItemId, warehouseId) : null;
            const short = have !== null && warehouseId !== undefined && !signed && !price && Number(l.Qty || 0) > have;
            return (
              <tr key={l.key} className="border-t border-slate-100 align-top">
                <td className="px-2 py-1"><ItemPicker value={l.ItemId} onChange={(id, item) => set(l.key, {
                  ItemId: id, ...(price && item && !l.UnitPrice ? { UnitPrice: String(item.PurchasePrice || '') } : {}),
                  ...(gst && item ? { GstRate: String(item.GstRate) } : {}),
                })} /></td>
                {warehouseId !== undefined && <td className={`px-2 py-2 text-right tabular-nums ${short ? 'font-semibold text-red-600' : 'text-slate-500'}`}>{have === null ? '' : `${qty(have)} ${it?.Unit ?? ''}`}</td>}
                <td className="px-2 py-1"><Input type="number" step="any" min={signed ? undefined : 0} value={l.Qty} onChange={(e) => set(l.key, { Qty: e.target.value })} aria-label="Quantity" /></td>
                {price && <td className="px-2 py-1"><Input type="number" step="any" min={0} value={l.UnitPrice ?? ''} onChange={(e) => set(l.key, { UnitPrice: e.target.value })} aria-label="Rate" /></td>}
                {gst && <td className="px-2 py-1"><Input type="number" step="any" min={0} value={l.GstRate ?? ''} onChange={(e) => set(l.key, { GstRate: e.target.value })} aria-label="GST %" /></td>}
                {due && <td className="px-2 py-1">{it?.IsReturnable ? <Input type="date" value={l.DueDate ?? ''} onChange={(e) => set(l.key, { DueDate: e.target.value })} aria-label="Due back"
                  title={it.ReturnDays ? `Empty = in ${it.ReturnDays} days` : 'Empty = no due date'} /> : <span className="block py-1.5 text-xs text-slate-400">not returnable</span>}</td>}
                <td className="px-1 py-1.5 text-center">
                  <button type="button" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove line" onClick={() => setLines(lines.length > 1 ? lines.filter((x) => x.key !== l.key) : [newLine()])}>
                    <Icon name="close" className="size-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center gap-2 border-t border-slate-100 px-2 py-1.5">
        <Button icon="add" onClick={() => setLines([...lines, newLine()])}>Add line</Button>
        {price && <span className="ml-auto text-sm font-semibold tabular-nums text-brand-900">Total {inr(total)}</span>}
      </div>
    </div>
  );
}

/** Lines ready to send (empty rows left out). */
export const linesOut = (lines: Line[]) => lines.filter((l) => l.ItemId).map((l) => ({
  ItemId: l.ItemId, Qty: l.Qty, UnitPrice: l.UnitPrice, GstRate: l.GstRate, DueDate: l.DueDate || undefined, Units: l.Units?.length ? l.Units.map((u) => u.Id) : undefined,
}));

/** Kind of an item as the store sees it. */
export const itemKind = (i: { TrackBy?: string; IsReturnable?: boolean }) => (i.TrackBy === 'Serial' ? 'Serial (tagged)' : i.IsReturnable ? 'Returnable' : 'Consumable');

/** ?id= of the URL (a link from an alert opens that document). */
export function useIdParam(): [number | null, () => void] {
  const [id, setId] = useState<number | null>(() => Number(new URLSearchParams(location.search).get('id')) || null);
  return [id, () => { setId(null); const u = new URL(location.href); u.searchParams.delete('id'); history.replaceState(null, '', u); }];
}

export function Stat({ label, value, sub, tone = 'blue', onClick }: { label: string; value: ReactNode; sub?: string; tone?: 'blue' | 'green' | 'amber' | 'red' | 'slate'; onClick?: () => void }) {
  const t = { blue: 'border-l-brand-600 text-brand-800', green: 'border-l-emerald-500 text-emerald-700', amber: 'border-l-amber-500 text-amber-700', red: 'border-l-red-500 text-red-700', slate: 'border-l-slate-400 text-slate-700' }[tone];
  const body = (
    <>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </>
  );
  const cls = `rounded-lg border border-l-4 border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm ${t}`;
  return onClick ? <button type="button" onClick={onClick} className={`${cls} transition hover:shadow-md`}>{body}</button> : <div className={cls}>{body}</div>;
}
