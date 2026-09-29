/** Attendance Reports: 11 reports, grid with colored status codes, Excel / PDF, salary slip. */
import { useEffect, useState } from 'react';
import { api, firstOfMonth, isoDate, qs } from '../api';
import { useApp } from '../app';
import { DataTable } from '../DataTable';
import { Button, Input, Page, Select, StatusBadge } from '../ui';

interface Entry { kind: string; name: string; period: 'date' | 'range' | 'month' | 'year' }

export function Reports() {
  const app = useApp();
  const [catalog, setCatalog] = useState<Entry[]>([]);
  const [kind, setKind] = useState('DailyAttendance');
  const [from, setFrom] = useState(isoDate());
  const [to, setTo] = useState(isoDate());
  const [dept, setDept] = useState('');
  const [emp, setEmp] = useState('');
  const [depts, setDepts] = useState<any[]>([]);
  const [emps, setEmps] = useState<any[]>([]);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api.get('/reports/catalog').then(setCatalog);
    api.get('/departments').then((r) => setDepts([...r.departments].sort((a: any, b: any) => a.Name.localeCompare(b.Name))));
    api.get('/employees/options?active=1').then(setEmps);
  }, [app.dataVersion]);

  const entry = catalog.find((c) => c.kind === kind);
  const period = entry?.period ?? 'date';

  const changeKind = (k: string) => {
    setKind(k);
    const p = catalog.find((c) => c.kind === k)?.period;
    if (p === 'range' && from === to) setFrom(firstOfMonth(to));
  };

  const params = () => qs({ kind, from: period === 'month' ? firstOfMonth(from) : period === 'year' ? `${from.slice(0, 4)}-01-01` : from, to: period === 'range' ? to : undefined, dept, emp });

  const generate = async () => {
    setBusy('gen');
    const r = await app.run(() => api.get('/reports/run' + params()));
    setBusy('');
    if (r) setResult(r);
  };
  const file = async (format: 'xlsx' | 'pdf') => {
    if (!result) return app.alert("Click 'Generate' first.");
    setBusy(format);
    await app.run(() => api.download('/reports/file' + params() + `&format=${format}`));
    setBusy('');
  };
  const slip = async () => {
    setBusy('slip');
    await app.run(() => api.download('/reports/salary-slip' + params()));
    setBusy('');
  };

  const label = period === 'year' ? 'Year' : period === 'month' ? 'Month' : period === 'date' ? 'Date' : 'From';
  const status = new Set<string>(result?.statusColumns ?? []);

  const toolbar = (
    <>
      <Select value={kind} onChange={(e) => changeKind(e.target.value)} className="w-64" aria-label="Report">
        {catalog.map((c) => <option key={c.kind} value={c.kind}>{c.name}</option>)}
      </Select>
      <label className="flex items-center gap-1.5">{label}
        {period === 'month' ? <Input type="month" value={from.slice(0, 7)} onChange={(e) => setFrom(e.target.value + '-01')} className="w-40" />
          : period === 'year' ? <Input type="number" min={2000} max={2100} value={from.slice(0, 4)} onChange={(e) => setFrom(`${e.target.value}-01-01`)} className="w-24" />
            : <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" />}
      </label>
      {period === 'range' && <label className="flex items-center gap-1.5">To <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" /></label>}
      <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-44" aria-label="Department">
        <option value="">All departments</option>
        {depts.map((d) => <option key={d.Id} value={d.Id}>{d.Name}</option>)}
      </Select>
      <Select value={emp} onChange={(e) => setEmp(e.target.value)} className="w-52" aria-label="Employee">
        <option value="">All employees</option>
        {emps.map((e) => <option key={e.Id} value={e.Id}>{e.EnrollNo} - {e.Name}</option>)}
      </Select>
      <Button variant="primary" icon="play" busy={busy === 'gen'} onClick={generate}>Generate</Button>
      <Button variant="success" icon="download" busy={busy === 'xlsx'} onClick={() => file('xlsx')}>Excel</Button>
      <Button variant="danger" icon="download" busy={busy === 'pdf'} onClick={() => file('pdf')}>PDF</Button>
      <Button icon="report" busy={busy === 'slip'} onClick={slip}>Salary Slip</Button>
    </>
  );

  return (
    <Page title="Reports" icon="report" toolbar={toolbar} bodyClass="flex flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-2.5 font-semibold text-brand-900">
          {result ? <>{result.title} — {result.subtitle} <span className="font-normal text-slate-500">({result.rows.length} rows)</span></> : <span className="font-normal text-slate-500">Choose a report and click Generate. Salary Slip uses the month of the date picker.</span>}
        </div>
        {result && (
          <DataTable compact rows={result.rows.map((r: any[], i: number) => ({ i, r }))} rowKey={(x: any) => x.i}
            rowClass={(x: any) => (x.r[1] === 'TOTAL' ? 'font-semibold bg-brand-50' : '')}
            columns={result.columns.map((c: string, ci: number) => ({
              key: String(ci), header: c, value: (x: any) => x.r[ci], align: status.has(c) ? 'center' : undefined,
              render: (x: any) => (status.has(c) ? <StatusBadge value={String(x.r[ci] ?? '')} /> : String(x.r[ci] ?? '')),
            }))} />
        )}
      </div>
    </Page>
  );
}
