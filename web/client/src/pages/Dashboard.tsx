/** Live attendance dashboard: today's cards, department-wise attendance, late arrivals, latest punches, month trend, approvals. */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../app';
import { Card, Icon, Page } from '../ui';

interface Dash {
  date: string; time: string;
  cards: { total: number; present: number; absent: number; onLeave: number; late: number; earlyExit: number; halfDay: number; off: number; missingOut: number; onTime: number };
  departments: { name: string; total: number; present: number; absent: number; leave: number; late: number; pct: number }[];
  late: { EnrollNo: string; Name: string; Department: string; In: string; LateBy: string }[];
  absent: { EnrollNo: string; Name: string; Department: string; Shift: string; Remark: string }[];
  punches: { EnrollNo: string; Name: string; Time: string; Source: string }[];
  month: { name: string; totalOvertime: string; lateCount: number; attendancePct: number; overtime: { EnrollNo: string; Name: string; Department: string; Hours: string }[];
    trend: { date: string; label: string; present: number; absent: number; leave: number; late: number }[] };
  pending: { leave: number; regularisation: number; overtime: number; compOff: number; profile: number; claims: number };
  holidays: { date: string; name: string }[]; birthdays: { name: string; when: string }[]; anniversaries: { name: string; when: string; years: number }[];
}

const TONES: Record<string, string> = {
  green: 'border-l-emerald-500 text-emerald-700', red: 'border-l-red-500 text-red-700', purple: 'border-l-purple-500 text-purple-700',
  amber: 'border-l-amber-500 text-amber-700', blue: 'border-l-brand-600 text-brand-700', slate: 'border-l-slate-400 text-slate-600',
};

function Stat({ label, value, tone, sub, to }: { label: string; value: number | string; tone: string; sub?: string; to?: string }) {
  const body = (
    <div className={`rounded-lg border border-l-4 border-slate-200 bg-white px-3 py-2.5 shadow-sm ${TONES[tone]} ${to ? 'transition hover:shadow-md' : ''}`}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function List<T>({ rows, cols, empty }: { rows: T[]; cols: { head: string; cell: (r: T) => React.ReactNode; right?: boolean }[]; empty: string }) {
  return (
    <div className="max-h-64 overflow-auto scroll-thin">
      <table className="w-full text-[12.5px]">
        <thead className="sticky top-0 bg-slate-50 text-[11px] text-slate-500">
          <tr>{cols.map((c) => <th key={c.head} className={`px-2 py-1 font-medium ${c.right ? 'text-right' : 'text-left'}`}>{c.head}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">{cols.map((c) => <td key={c.head} className={`px-2 py-1 ${c.right ? 'text-right tabular-nums' : ''}`}>{c.cell(r)}</td>)}</tr>
          ))}
          {!rows.length && <tr><td colSpan={cols.length} className="px-2 py-4 text-center text-slate-400">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Stacked bars of the month: present / leave / absent per day. */
function Trend({ data }: { data: Dash['month']['trend'] }) {
  const max = Math.max(1, ...data.map((d) => d.present + d.leave + d.absent));
  return (
    <div className="px-3 pb-3 pt-2">
      <div className="flex h-36 items-end gap-[3px]" role="img" aria-label="Daily attendance this month">
        {data.map((d) => (
          <div key={d.date} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
            <div className="flex flex-col-reverse overflow-hidden rounded-t-sm">
              <div className="bg-emerald-500" style={{ height: `${(d.present / max) * 128}px` }} />
              <div className="bg-purple-400" style={{ height: `${(d.leave / max) * 128}px` }} />
              <div className="bg-red-400" style={{ height: `${(d.absent / max) * 128}px` }} />
            </div>
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[11px] text-white group-hover:block">
              {d.date}: {d.present} present, {d.leave} leave, {d.absent} absent, {d.late} late
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px] text-center text-[9px] text-slate-400">{data.map((d) => <div key={d.date} className="min-w-0 flex-1">{d.label}</div>)}</div>
      <div className="mt-2 flex gap-4 text-[11px] text-slate-600">
        <span className="flex items-center gap-1"><i className="size-2.5 rounded-sm bg-emerald-500" />Present</span>
        <span className="flex items-center gap-1"><i className="size-2.5 rounded-sm bg-purple-400" />Leave</span>
        <span className="flex items-center gap-1"><i className="size-2.5 rounded-sm bg-red-400" />Absent</span>
      </div>
    </div>
  );
}

export function Dashboard() {
  const app = useApp();
  const [d, setD] = useState<Dash | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.get<Dash>('/dashboard').then((x) => { setD(x); setError(''); }).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load, app.dataVersion]);

  if (!d) return <Page title="Dashboard" icon="home"><div className="text-slate-500">{error || 'Loading…'}</div></Page>;
  const c = d.cards;
  const pct = (n: number) => (c.total ? `${Math.round((n / c.total) * 100)}% of ${c.total}` : '');
  const p = d.pending;
  const approvals = [
    { label: 'Leave', n: p.leave, to: '/leave' }, { label: 'Regularisation', n: p.regularisation, to: '/portal-admin?type=Regularisation' },
    { label: 'Overtime', n: p.overtime, to: '/portal-admin?type=Overtime' }, { label: 'Comp-off', n: p.compOff, to: '/portal-admin?type=CompOff' },
    { label: 'Profile change', n: p.profile, to: '/portal-admin?type=Profile' }, { label: 'Expense / Advance', n: p.claims, to: '/portal-admin' },
  ];

  return (
    <Page title="Dashboard" icon="home" toolbar={
      <>
        <span className="font-medium text-brand-900">{d.date}</span>
        <span className="text-xs text-slate-500">Live — refreshes every 30 s (last {d.time})</span>
        <span className="flex-1" />
        <Link to="/aclog" className="text-xs text-brand-700 hover:underline">AC Log</Link>
        <Link to="/reports" className="text-xs text-brand-700 hover:underline">Reports</Link>
      </>
    }>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Present" value={c.present} tone="green" sub={pct(c.present)} to="/aclog" />
          <Stat label="Absent" value={c.absent} tone="red" sub={pct(c.absent)} />
          <Stat label="On Leave" value={c.onLeave} tone="purple" sub={pct(c.onLeave)} to="/leave" />
          <Stat label="Late Arrivals" value={c.late} tone="amber" sub={`${c.onTime} on time`} />
          <Stat label="Early Exit" value={c.earlyExit} tone="amber" sub={`${c.missingOut} without OUT punch`} />
          <Stat label="Half Day" value={c.halfDay} tone="slate" />
          <Stat label="Holiday / Weekly Off" value={c.off} tone="slate" />
          <Stat label="Employees" value={c.total} tone="blue" to="/employees" />
          <Stat label={`Attendance ${d.month.name}`} value={`${d.month.attendancePct}%`} tone="green" />
          <Stat label={`Overtime ${d.month.name}`} value={d.month.totalOvertime || '0:00'} tone="blue" sub={`${d.month.lateCount} late arrivals this month`} />
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <Card title="Department-wise attendance (today)" className="xl:col-span-2">
            <List rows={d.departments} empty="No employees." cols={[
              { head: 'Department', cell: (r) => r.name }, { head: 'Employees', cell: (r) => r.total, right: true },
              { head: 'Present', cell: (r) => <span className="text-emerald-700">{r.present}</span>, right: true },
              { head: 'Absent', cell: (r) => <span className="text-red-700">{r.absent}</span>, right: true },
              { head: 'Leave', cell: (r) => r.leave, right: true }, { head: 'Late', cell: (r) => r.late, right: true },
              { head: 'Present %', right: true, cell: (r) => (
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block h-1.5 w-16 overflow-hidden rounded bg-slate-200"><span className="block h-full bg-emerald-500" style={{ width: `${r.pct}%` }} /></span>{r.pct}%
                </span>) },
            ]} />
          </Card>
          <Card title="Pending approvals">
            <ul className="divide-y divide-slate-100">
              {approvals.map((a) => (
                <li key={a.label}>
                  <Link to={a.to} className="flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-brand-50">
                    <Icon name="check" className="size-3.5 text-slate-400" /><span className="flex-1">{a.label}</span>
                    <span className={`min-w-7 rounded-full px-2 text-center text-xs font-semibold ${a.n ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-400'}`}>{a.n}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <Card title={`Late arrivals today (${d.late.length})`}>
            <List rows={d.late} empty="Nobody is late today." cols={[
              { head: 'Name', cell: (r) => <><span className="text-slate-400">{r.EnrollNo}</span> {r.Name}</> },
              { head: 'In', cell: (r) => r.In, right: true }, { head: 'Late by', cell: (r) => <span className="text-amber-700">{r.LateBy}</span>, right: true },
            ]} />
          </Card>
          <Card title={`Absent today (${d.absent.length})`}>
            <List rows={d.absent} empty="Nobody is absent." cols={[
              { head: 'Name', cell: (r) => <><span className="text-slate-400">{r.EnrollNo}</span> {r.Name}</> }, { head: 'Department', cell: (r) => r.Department },
              { head: 'Shift', cell: (r) => r.Shift },
            ]} />
          </Card>
          <Card title="Latest punches (live)">
            <List rows={d.punches} empty="No punches today yet." cols={[
              { head: 'Time', cell: (r) => <span className="tabular-nums">{r.Time}</span> },
              { head: 'Name', cell: (r) => <><span className="text-slate-400">{r.EnrollNo}</span> {r.Name}</> }, { head: 'Source', cell: (r) => r.Source },
            ]} />
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <Card title={`Daily attendance — ${d.month.name}`} className="xl:col-span-2"><Trend data={d.month.trend} /></Card>
          <Card title={`Top overtime — ${d.month.name}`}>
            <List rows={d.month.overtime} empty="No overtime this month." cols={[
              { head: 'Name', cell: (r) => <><span className="text-slate-400">{r.EnrollNo}</span> {r.Name}</> }, { head: 'Department', cell: (r) => r.Department },
              { head: 'OT Hrs', cell: (r) => r.Hours, right: true },
            ]} />
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card title="Upcoming holidays">
            <List rows={d.holidays} empty="No holidays in the next 45 days." cols={[{ head: 'Date', cell: (r) => r.date }, { head: 'Holiday', cell: (r) => r.name }]} />
          </Card>
          <Card title="Birthdays (next 7 days)">
            <List rows={d.birthdays} empty="No birthdays this week." cols={[{ head: 'Name', cell: (r) => r.name }, { head: 'When', cell: (r) => r.when, right: true }]} />
          </Card>
          <Card title="Work anniversaries (next 7 days)">
            <List rows={d.anniversaries} empty="None this week." cols={[{ head: 'Name', cell: (r) => r.name }, { head: 'Years', cell: (r) => r.years, right: true },
              { head: 'When', cell: (r) => r.when, right: true }]} />
          </Card>
        </div>
      </div>
    </Page>
  );
}
