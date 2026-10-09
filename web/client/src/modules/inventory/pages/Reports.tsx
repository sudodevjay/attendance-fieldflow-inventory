/** Inventory reports: choose one, set its filters, see it, download Excel / PDF (same export as the attendance reports). */
import { useEffect, useState } from 'react';
import { api, firstOfMonth, isoDate, qs } from '../../../api';
import { useApp } from '../../../app';
import { Button, Field, Input, Page, Select } from '../../../ui';
import { EmployeePicker, ItemPicker, SiteSelect, useInv } from '../shared';

interface Rep { key: string; name: string; params: string[] }

export function InvReports() {
  const app = useApp();
  const { lk } = useInv();
  const [list, setList] = useState<Rep[]>([]);
  const [key, setKey] = useState('stock');
  const [p, setP] = useState<Record<string, any>>({ from: firstOfMonth(isoDate()), to: isoDate() });
  const [r, setR] = useState<{ title: string; subtitle: string; columns: string[]; rows: (string | number)[][] } | null>(null);
  useEffect(() => { api.get('/inventory/reports').then(setList); }, []);
  const rep = list.find((x) => x.key === key);
  const params = () => Object.fromEntries((rep?.params ?? []).map((k) => [k, p[k]]));
  const show = () => app.run(async () => setR(await api.get(`/inventory/reports/${key}` + qs(params()))));
  useEffect(() => { if (rep) show(); }, [key, rep]); // eslint-disable-line react-hooks/exhaustive-deps
  const has = (k: string) => rep?.params.includes(k);
  const set = (k: string, v: unknown) => setP({ ...p, [k]: v ?? '' });

  return (
    <Page title="Inventory Reports" icon="report" toolbar={
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); show(); }}>
        <Field label="Report"><Select className="w-72" value={key} onChange={(e) => { setKey(e.target.value); setR(null); }}>
          {list.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</Select></Field>
        {has('from') && <Field label="From"><Input type="date" className="w-36" value={p.from} onChange={(e) => set('from', e.target.value)} /></Field>}
        {has('to') && <Field label="To"><Input type="date" className="w-36" value={p.to} onChange={(e) => set('to', e.target.value)} /></Field>}
        {has('warehouse') && <Field label="Store"><Select className="w-40" value={p.warehouse ?? ''} onChange={(e) => set('warehouse', e.target.value)}>
          <option value="">All</option>{lk.warehouses.map((w) => <option key={w.Id} value={w.Id}>{w.Name}</option>)}</Select></Field>}
        {has('category') && <Field label="Category"><Select className="w-40" value={p.category ?? ''} onChange={(e) => set('category', e.target.value)}>
          <option value="">All</option>{lk.categories.map((c) => <option key={c.Id} value={c.Id}>{c.Name}</option>)}</Select></Field>}
        {has('department') && <Field label="Department"><Select className="w-44" value={p.department ?? ''} onChange={(e) => set('department', e.target.value)}>
          <option value="">All</option>{lk.departments.map((d) => <option key={d.Id} value={d.Id}>{d.Name}</option>)}</Select></Field>}
        {has('supplier') && <Field label="Supplier"><Select className="w-44" value={p.supplier ?? ''} onChange={(e) => set('supplier', e.target.value)}>
          <option value="">All</option>{lk.suppliers.map((s) => <option key={s.Id} value={s.Id}>{s.Name}</option>)}</Select></Field>}
        {has('type') && <Field label="Type"><Select className="w-36" value={p.type ?? ''} onChange={(e) => set('type', e.target.value)}>
          <option value="">All</option>{['Opening', 'Receipt', 'Issue', 'Return', 'TransferOut', 'TransferIn', 'Adjustment'].map((t) => <option key={t}>{t}</option>)}</Select></Field>}
        {has('site') && <Field label="Site"><SiteSelect className="w-44" emptyLabel="All" value={p.site ?? ''} onChange={(id) => set('site', id)} /></Field>}
        {has('item') && <Field label="Item"><ItemPicker className="w-60" activeOnly={false} value={p.item || null} onChange={(id) => set('item', id)} /></Field>}
        {has('employee') && <Field label="Employee"><EmployeePicker className="w-60" value={p.employee || null} onChange={(id) => set('employee', id)} /></Field>}
        <Button type="submit" variant="primary" icon="search">Show</Button>
        <Button icon="export" onClick={() => app.run(() => api.download(`/inventory/reports/${key}/file` + qs({ ...params(), format: 'xlsx' })))}>Excel</Button>
        <Button icon="report" onClick={() => app.run(() => api.download(`/inventory/reports/${key}/file` + qs({ ...params(), format: 'pdf' })))}>PDF</Button>
      </form>
    } bodyClass="flex flex-col">
      {r && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-3 py-2"><div className="font-semibold text-brand-900">{r.title}</div><div className="text-xs text-slate-500">{r.subtitle} · {r.rows.length} row(s)</div></div>
          <div className="min-h-0 flex-1 overflow-auto scroll-thin">
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="sticky top-0"><tr>{r.columns.map((c) => <th key={c} className="border-b border-r border-slate-200 bg-gradient-to-b from-slate-50 to-slate-200 px-2 py-1.5 text-left text-xs font-semibold whitespace-nowrap text-slate-700">{c}</th>)}</tr></thead>
              <tbody>
                {r.rows.map((row, i) => <tr key={i} className={i % 2 ? 'bg-slate-50/70' : ''}>{row.map((v, j) => <td key={j} className="border-b border-r border-slate-100 px-2 py-1 whitespace-nowrap">{v}</td>)}</tr>)}
                {!r.rows.length && <tr><td colSpan={r.columns.length} className="px-3 py-8 text-center text-slate-400">No data.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Page>
  );
}
