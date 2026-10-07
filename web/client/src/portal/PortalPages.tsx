/** Pages of the employee portal. */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../app';
import { DataTable } from '../DataTable';
import { Button, Check, Field, Icon, Input, Modal, Note, Select, StatusBadge, TextArea } from '../ui';
import { inr, papi, photoToBase64, ptoken, two } from './papi';
import { SiteCheckIn } from './SiteCheckIn';
import { CompOffDialog, fieldLabel, OvertimeDialog, ProfileChangeDialog } from './HrPages';
import { Avatar, ChangePassword, Section, useMe } from './PortalApp';

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const thisMonth = () => today().slice(0, 7);

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): [T | null, () => void] {
  const { run } = useApp();
  const [data, setData] = useState<T | null>(null);
  const load = useCallback(() => { run(fn).then((d) => { if (d !== undefined) setData(d); }); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return [data, load];
}

export const Wrap = ({ children }: { children: ReactNode }) => <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-8">{children}</div>;
export const Loading = () => <div className="p-8 text-slate-500">Loading…</div>;

function Pills<T extends string>({ items, value, onChange }: { items: { key: T; label: string; count?: number }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="flex flex-wrap gap-5 border-b border-slate-100" role="tablist">
      {items.map((i) => (
        <button key={i.key} type="button" role="tab" aria-selected={value === i.key} onClick={() => onChange(i.key)}
          className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2 text-[14px] ${value === i.key ? 'border-slate-800 text-slate-900' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
          {i.label}{i.count !== undefined && <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-600">{i.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ illustrations

function WorkArt() {
  return (
    <svg viewBox="0 0 200 120" className="hidden h-28 w-44 shrink-0 sm:block" aria-hidden="true">
      <circle cx="120" cy="52" r="34" fill="#fff" stroke="#1e293b" strokeWidth="2" />
      <path d="M120 18v68M86 52h68" stroke="#1e293b" strokeWidth="2" />
      <rect x="30" y="48" width="8" height="52" fill="#2563eb" /><rect x="40" y="40" width="8" height="60" fill="#1e40af" /><rect x="50" y="56" width="8" height="44" fill="#60a5fa" />
      <path d="M62 100h110" stroke="#1e293b" strokeWidth="2" />
      <path d="M80 86c10-16 24-18 34-10l18 14" fill="none" stroke="#1e293b" strokeWidth="3" strokeLinecap="round" />
      <circle cx="92" cy="60" r="7" fill="#1e293b" /><rect x="84" y="68" width="18" height="22" rx="6" fill="#2563eb" />
      <rect x="104" y="80" width="26" height="4" rx="2" fill="#1e293b" /><path d="M20 34c6-10 12 0 8 8" stroke="#1e293b" fill="none" />
    </svg>
  );
}

function TeamArt() {
  return (
    <svg viewBox="0 0 200 120" className="h-28 w-44 shrink-0" aria-hidden="true">
      <circle cx="60" cy="40" r="22" fill="#fff" stroke="#1e293b" strokeWidth="2" />
      <rect x="120" y="30" width="56" height="38" rx="3" fill="#fff" stroke="#1e293b" strokeWidth="2" /><path d="M130 42h36M130 50h26M130 58h30" stroke="#60a5fa" strokeWidth="3" />
      <path d="M30 100h150" stroke="#1e293b" strokeWidth="2" /><rect x="70" y="78" width="70" height="4" fill="#1e293b" />
      <circle cx="58" cy="62" r="7" fill="#1e293b" /><rect x="50" y="70" width="16" height="24" rx="6" fill="#1e40af" />
      <circle cx="152" cy="74" r="7" fill="#1e293b" /><rect x="144" y="82" width="16" height="16" rx="6" fill="#2563eb" />
    </svg>
  );
}

// ------------------------------------------------------------------ home

export function Home() {
  const { me } = useMe();
  const app = useApp();
  const navigate = useNavigate();
  const [data, reload] = useLoad(() => papi.get('/home'), []);
  const [tab, setTab] = useState<'late' | 'leave' | 'checkin'>('late');
  const [teamTab, setTeamTab] = useState<'leave' | 'other'>('leave');
  const [busy, setBusy] = useState(false);
  const [regularise, setRegularise] = useState<{ date: string; time: string } | null>(null);
  const [siteCheckIn, setSiteCheckIn] = useState(false);
  if (!data) return <Loading />;
  const first = me.name.split(' ')[0];

  const checkin = async () => {
    if (me.checkInAtSite) return setSiteCheckIn(true);
    setBusy(true);
    const r = await app.run(() => papi.post('/checkin', { checkOut: data.today.checkedIn }));
    setBusy(false);
    if (r) { await app.alert(r.message); reload(); }
  };
  const decide = async (kind: string, id: number, decision: 'Approved' | 'Rejected') => {
    const r = await app.run(() => papi.post('/team/decide', { kind, id, decision }));
    if (r) reload();
  };

  const req = data.requests;
  const list = tab === 'late' ? req.late : tab === 'leave' ? req.leave : req.checkin;

  return (
    <Wrap>
      <h2 className="text-3xl font-semibold text-slate-900">Welcome {first}</h2>
      <div className={`grid gap-5 ${me.isManager ? 'xl:grid-cols-2' : 'xl:grid-cols-[1.4fr_1fr]'}`}>
        <Section title="My Space" icon="person">
          <div className="flex items-center gap-4 rounded-xl bg-amber-300/90 p-4">
            <WorkArt />
            <div className="text-[15px] text-slate-900">
              Mark attendance, apply for leaves, view your payslips, and keep up with office events in one place.
              <Link to="/me/attendance" className="mt-2 flex items-center gap-1 font-medium text-brand-800">Explore <span aria-hidden="true">→</span></Link>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-[1.3fr_1fr]">
            <div className="rounded-xl bg-brand-700 p-4 text-white shadow">
              <div className="text-lg font-semibold">{data.today.checkedIn ? `Checked in at ${data.today.in}` : data.today.punches.length ? 'Checked out' : 'Check-In Required'}</div>
              <div className="text-[13px] text-white/80">{data.today.checkedIn ? 'Have a good day at work' : data.today.punches.length ? `Worked ${data.today.worked || '—'} today` : 'Check-In to start your day'}</div>
              <div className="mt-3 flex items-center gap-2 text-[13px]">
                <Icon name="logout" className="size-5" /><span className="flex-1">{data.today.punches.join(', ') || '---------'}</span>
                <Icon name="calendar" className="size-5" /><span>{data.today.date}</span>
              </div>
              {me.allowCheckIn
                ? <button type="button" disabled={busy} onClick={checkin} className="mt-3 w-full rounded-md bg-white py-2.5 font-medium text-slate-900 hover:bg-slate-100 disabled:opacity-60">{data.today.checkedIn ? 'Check-out' : 'Check-in'}</button>
                : <div className="mt-3 rounded-md bg-white/15 py-2.5 text-center text-sm">Punch on the fingerprint device</div>}
            </div>
            <div className="rounded-xl border border-slate-100 p-4 shadow-sm">
              <div className="font-semibold text-slate-900">Leaves</div>
              <div className="mt-2 flex items-center justify-between text-[13px] text-slate-600">Availed <span className="text-2xl text-slate-900">{two(data.leaves.availed)}</span></div>
              <div className="flex items-center justify-between text-[13px] text-slate-600">Remaining <span className="text-2xl text-slate-900">{data.leaves.remaining === null ? '∞' : two(data.leaves.remaining)}</span></div>
              {data.compOff > 0 && <Link to="/me/comp-off" className="flex items-center justify-between text-[13px] text-slate-600">Comp-off <span className="text-2xl text-slate-900">{two(data.compOff)}</span></Link>}
              <Button variant="primary" className="mt-3 w-full justify-center py-2" onClick={() => navigate('/me/apply-leave')}>Apply</Button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            {[['Attendance', `${data.stats.attendancePct}%`], ['Punctuality', `${data.stats.punctualityPct}%`], ['Regularised', String(data.stats.offsites)]].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-slate-100 p-3 shadow-sm"><div className="text-2xl text-brand-700">{v}</div><div className="text-xs text-slate-600">{k} (this month)</div></div>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="mb-3 flex items-center"><h3 className="flex-1 text-lg font-semibold">My Requests</h3><Link to="/me/requests" className="text-sm text-brand-700 underline">View all</Link></div>
            <Pills items={[{ key: 'late', label: 'Late', count: req.late.length }, { key: 'leave', label: 'Leave', count: req.leave.length }, { key: 'checkin', label: 'Checkin', count: req.checkin.length }]} value={tab} onChange={setTab} />
            <div className="divide-y divide-slate-100">
              {list.length === 0 && <div className="py-6 text-center text-sm text-slate-400">Nothing here.</div>}
              {list.slice(0, 5).map((r: any, i: number) => (
                <div key={i} className="flex items-start gap-3 py-3">
                  {tab === 'late' && <>
                    <div className="flex-1">
                      <div className="font-semibold">Late by {r.LateBy}</div>
                      <div className="text-xs text-slate-500">Checkin Date : <b className="text-slate-700">{r.Date}</b> &nbsp; Checkin time : <span className="text-red-600">{r.CheckIn}</span></div>
                    </div>
                    <Button onClick={() => setRegularise({ date: r.DateIso, time: '' })}>Regularise</Button>
                  </>}
                  {tab === 'leave' && <>
                    <div className="flex-1">
                      <div className="font-semibold">{r.TypeName} · {r.Days} day(s)</div>
                      <div className="text-xs text-slate-500">From : <b className="text-slate-700">{r.From}</b> &nbsp; To : <b className="text-slate-700">{r.To}</b></div>
                      <div className="text-xs text-slate-500">Applied on {r.AppliedOn}</div>
                    </div>
                    <StatusBadge value={r.Status} />
                  </>}
                  {tab === 'checkin' && <>
                    <div className="flex-1">
                      <div className="font-semibold">{r.Category} {r.Time}</div>
                      <div className="text-xs text-slate-500">Date : <b className="text-slate-700">{r.Date}</b> · {r.Details}</div>
                      <div className="text-xs text-slate-500">Applied on {r.Applied}</div>
                    </div>
                    <StatusBadge value={r.Status} />
                  </>}
                </div>
              ))}
            </div>
          </div>
        </Section>

        {me.isManager && data.team ? (
          <Section title="Team Space" icon="people">
            <div className="flex items-center justify-center rounded-xl bg-pink-100 p-4"><TeamArt /></div>
            <h3 className="mt-5 text-lg font-semibold">Todays Statistics</h3>
            <div className="mt-2 space-y-2">
              {[['people', 'All Employees', data.team.total], ['person', 'People Absent', data.team.absent], ['check', 'Present', data.team.present],
                ['clock', 'Late', data.team.late], ['flag', 'On Leave', data.team.onLeave]].map(([icon, k, v]) => (
                <div key={k as string} className="flex items-center gap-2 rounded-lg border border-slate-100 px-4 py-3 shadow-sm">
                  <Icon name={icon as string} className="size-5 text-brand-700" /><span className="flex-1 text-[15px]">{k}</span><span className="text-2xl text-brand-700">{v}</span>
                </div>
              ))}
            </div>
            <h3 className="mt-5 text-lg font-semibold">Teams Requests</h3>
            <Pills items={[{ key: 'leave', label: 'Leave', count: data.team.leaveRequests.length }, { key: 'other', label: 'Other requests', count: data.team.otherRequests.length }]} value={teamTab} onChange={setTeamTab} />
            <div className="divide-y divide-slate-100">
              {(teamTab === 'leave' ? data.team.leaveRequests : data.team.otherRequests).length === 0 && <div className="py-6 text-center text-sm text-slate-400">No pending requests.</div>}
              {(teamTab === 'leave' ? data.team.leaveRequests : data.team.otherRequests).slice(0, 6).map((r: any) => (
                <div key={r.Id} className="flex items-center gap-3 py-3">
                  <Avatar me={{ name: r.Name }} size="size-10" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{r.Name}</div>
                    {teamTab === 'leave'
                      ? <div className="text-xs text-slate-500">From : <b>{r.From}</b> &nbsp; To : <b>{r.To}</b><br />Leave type : <b className="text-slate-700">{r.TypeName}</b></div>
                      : <div className="text-xs text-slate-500"><b>{r.TypeName ?? r.Type}</b>: {requestText(r)}<br />{r.Details}</div>}
                    {r.Stage && <div className="mt-0.5 text-[11px] font-medium text-amber-700">{r.Stage}</div>}
                  </div>
                  {r.Type === 'Profile' ? <span className="text-xs text-slate-500">HR approves</span> : r.CanDecide === false ? <span className="text-xs text-slate-500">{r.FirstApprovedBy ? 'With the manager' : 'With the team lead'}</span> : (
                    <div className="flex flex-col gap-1">
                      <Button variant="success" className="px-2 py-1" onClick={() => decide(teamTab === 'leave' ? 'leave' : 'request', r.Id, 'Approved')}>{r.Step === 'first' ? 'Approve (to manager)' : 'Approve'}</Button>
                      <Button variant="danger" className="px-2 py-1" onClick={() => decide(teamTab === 'leave' ? 'leave' : 'request', r.Id, 'Rejected')}>Reject</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        ) : (
          <div className="space-y-5">
            {data.birthdays.length > 0 && (
              <div className="rounded-xl bg-brand-100 p-5 text-center shadow-sm">
                <div className="text-sm text-brand-900">Happy Birthday to</div>
                <div className="my-2 text-4xl" aria-hidden="true">🎂</div>
                <div className="text-lg font-semibold text-brand-900">{data.birthdays.join(', ')}</div>
              </div>
            )}
            <Section title="Upcoming Holidays" icon="sun" action={<Link to="/me/holidays" className="text-sm text-brand-700 underline">View all</Link>}>
              {data.holidays.length === 0 && <div className="py-4 text-sm text-slate-400">No holidays in the next months.</div>}
              {data.holidays.map((h: any) => (
                <div key={h.date} className="flex items-center gap-3 border-b border-slate-100 py-2.5 last:border-0">
                  <Icon name="calendar" className="size-5 text-brand-700" /><div className="flex-1"><div className="font-medium">{h.name}</div><div className="text-xs text-slate-500">{h.day}</div></div>
                  <span className="text-sm text-slate-700">{h.date}</span>
                </div>
              ))}
            </Section>
            <Section title="Quick Links">
              <div className="grid grid-cols-2 gap-3">
                {[['upload', 'Expense & Advances', '/me/reimbursement'], ['report', 'Payslips, salary breakups', '/me/payslips'], ['clock', 'Attendance Regularisation', '/me/requests'], ['flag', 'Leave Reports', '/me/leave-reports'],
                  ['sun', `Comp-off (${data.compOff ?? 0} available)`, '/me/comp-off'], ['folder', 'My Documents', '/me/documents']].map(([i, l, to]) => (
                  <Link key={l} to={to} className="flex items-center gap-3 rounded-lg border border-slate-100 p-3 text-[13px] shadow-sm hover:bg-slate-50">
                    <span className="grid size-9 place-items-center rounded-md bg-brand-50 text-brand-700"><Icon name={i} className="size-5" /></span>{l}
                  </Link>
                ))}
              </div>
            </Section>
          </div>
        )}
      </div>
      {regularise && <RegulariseDialog initial={regularise} onClose={() => setRegularise(null)} onSaved={reload} />}
      {siteCheckIn && <SiteCheckIn checkOut={data.today.checkedIn} onClose={() => setSiteCheckIn(false)}
        onDone={async (m) => { setSiteCheckIn(false); await app.alert(m); reload(); }} />}
    </Wrap>
  );
}

// ------------------------------------------------------------------ requests

function RegulariseDialog({ initial, onClose, onSaved }: { initial: { date: string; time: string }; onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const [f, setF] = useState({ Date: initial.date || today(), Time: initial.time || '09:00', CheckOut: false, Details: '' });
  const save = async () => {
    const r = await app.run(() => papi.post('/requests', { Type: 'Regularisation', ...f }));
    if (r) { await app.alert(r.message); onSaved(); onClose(); }
  };
  return (
    <Modal title="Attendance Regularisation" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Send</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date"><Input type="date" max={today()} value={f.Date} onChange={(e) => setF({ ...f, Date: e.target.value })} /></Field>
        <Field label="Actual time"><Input type="time" value={f.Time} onChange={(e) => setF({ ...f, Time: e.target.value })} /></Field>
        <Field label="Punch" className="col-span-2">
          <Select value={f.CheckOut ? '1' : '0'} onChange={(e) => setF({ ...f, CheckOut: e.target.value === '1' })}><option value="0">Check-In</option><option value="1">Check-Out</option></Select>
        </Field>
        <Field label="Reason" className="col-span-2"><TextArea rows={3} value={f.Details} placeholder="Forgot to punch / was at a client site / device not working" onChange={(e) => setF({ ...f, Details: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><Note>When your manager or HR approves it, this punch is added to your attendance.</Note></div>
    </Modal>
  );
}

function ExpenseDialog({ kind, onClose, onSaved }: { kind: 'Expense' | 'Advance'; onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const [f, setF] = useState({ Date: today(), Category: kind === 'Expense' ? 'Travel' : 'Salary Advance', Amount: '', Installments: 1, Details: '', Attachment: '' });
  const save = async () => {
    const r = await app.run(() => papi.post('/requests', { Type: kind, ...f, Amount: +f.Amount }));
    if (r) { await app.alert(r.message); onSaved(); onClose(); }
  };
  const photo = async (file?: File) => {
    if (!file) return;
    const b = await app.run(() => photoToBase64(file));
    if (b) setF((x) => ({ ...x, Attachment: b }));
  };
  return (
    <Modal title={kind === 'Expense' ? 'New Expense Claim' : 'Advance / Loan Request'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Send</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        {kind === 'Expense' && <Field label="Expense date"><Input type="date" max={today()} value={f.Date} onChange={(e) => setF({ ...f, Date: e.target.value })} /></Field>}
        <Field label="Category">
          <Select value={f.Category} onChange={(e) => setF({ ...f, Category: e.target.value })}>
            {(kind === 'Expense' ? ['Travel', 'Food', 'Fuel', 'Hotel', 'Phone / Internet', 'Office supplies', 'Other'] : ['Salary Advance', 'Loan', 'Travel Advance', 'Other']).map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Amount (₹)"><Input type="number" min={1} value={f.Amount} onChange={(e) => setF({ ...f, Amount: e.target.value })} /></Field>
        {kind === 'Advance' && <Field label="Recover in (months)"><Input type="number" min={1} max={36} value={f.Installments} onChange={(e) => setF({ ...f, Installments: +e.target.value })} /></Field>}
        <Field label={kind === 'Expense' ? 'What was it for' : 'Reason'} className="col-span-2"><TextArea rows={3} value={f.Details} onChange={(e) => setF({ ...f, Details: e.target.value })} /></Field>
        {kind === 'Expense' && (
          <Field label="Receipt photo (optional)" className="col-span-2">
            <input type="file" accept="image/*" capture="environment" className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-white" onChange={(e) => photo(e.target.files?.[0])} />
            {f.Attachment && <img src={`data:image/jpeg;base64,${f.Attachment}`} alt="Receipt" className="mt-2 max-h-40 rounded border" />}
          </Field>
        )}
      </div>
    </Modal>
  );
}

/** One line about a request of any type (regularisation, expense, advance, overtime, comp-off, profile change). */
export function requestText(r: any) {
  switch (r.Type) {
    case 'Overtime': return `Overtime · ${r.Amount} h · ${r.Date}`;
    case 'CompOff': return `Comp-off · ${r.Amount} day · worked ${r.Date}`;
    case 'Profile': return `Profile change · ${Object.keys(r.Changes ?? {}).map(fieldLabel).join(', ')}`;
    case 'Regularisation': return `${r.Category} ${r.Time} · ${r.Date}`;
    default: return `${r.Category} · ${r.AmountText ? `₹ ${r.AmountText}` : ''}${r.Installments ? ` · ${r.Installments} month(s)` : ''}`;
  }
}

function RequestList({ rows, onCancel, amount }: { rows: any[]; onCancel: (id: number) => void; amount?: boolean }) {
  return (
    <div className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm">
      {rows.length === 0 && <div className="p-8 text-center text-sm text-slate-400">No requests yet.</div>}
      {rows.map((r) => (
        <div key={r.Id} className="flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            {['Overtime', 'CompOff', 'Profile'].includes(r.Type)
              ? <div className="font-semibold">{requestText(r)}</div>
              : <div className="font-semibold">{r.Category}{amount ? ` · ${inr(r.Amount)}` : ` · ${r.Time}`}{r.Installments ? ` · ${r.Installments} month(s)` : ''}</div>}
            <div className="text-xs text-slate-500">{r.Type === 'Profile' ? Object.entries(r.Changes ?? {}).map(([k, v]) => `${fieldLabel(k)}: ${v || '(empty)'}`).join(' · ') : `${r.Date} · ${r.Details}`}</div>
            <div className="text-xs text-slate-500">Applied on {r.Applied}{r.DecidedBy && ` · ${r.Status} by ${r.DecidedBy} on ${r.DecidedOn}`}{r.DecisionNote && ` · "${r.DecisionNote}"`}</div>
          </div>
          {r.HasAttachment && <a className="text-sm text-brand-700 underline" href={`/api/portal/requests/${r.Id}/attachment?token=${ptoken()}`} target="_blank" rel="noreferrer">Receipt</a>}
          <StatusBadge value={r.Status} />
          {r.Status === 'Pending' && <Button variant="danger" onClick={() => onCancel(r.Id)}>Cancel</Button>}
        </div>
      ))}
    </div>
  );
}

export function MyRequests() {
  const app = useApp();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'leave' | 'Regularisation' | 'Expense' | 'Advance' | 'Overtime' | 'CompOff' | 'Profile'>('leave');
  const [leave, reloadLeave] = useLoad(() => papi.get('/leave'), []);
  const [reqs, reloadReqs] = useLoad(() => papi.get('/requests'), []);
  const [dialog, setDialog] = useState<string | null>(null);
  const cancel = async (kind: 'leave' | 'requests', id: number) => {
    if (!(await app.confirm('Cancel this request?'))) return;
    const r = await app.run(() => papi.del(`/${kind}/${id}`));
    if (r) { reloadLeave(); reloadReqs(); }
  };
  const count = (t: string) => (reqs ?? []).filter((r: any) => r.Type === t).length;
  return (
    <Wrap>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon="flag" onClick={() => navigate('/me/apply-leave')}>Apply Leave</Button>
        <Button icon="clock" onClick={() => setDialog('reg')}>Regularise attendance</Button>
        <Button icon="upload" onClick={() => setDialog('Expense')}>Expense claim</Button>
        <Button icon="report" onClick={() => setDialog('Advance')}>Advance / loan</Button>
        <Button icon="timer" onClick={() => setDialog('Overtime')}>Overtime</Button>
        <Button icon="sun" onClick={() => setDialog('CompOff')}>Comp-off</Button>
      </div>
      <Pills items={[{ key: 'leave', label: 'Leave', count: leave?.entries.length }, { key: 'Regularisation', label: 'Checkin', count: count('Regularisation') },
        { key: 'Expense', label: 'Expense', count: count('Expense') }, { key: 'Advance', label: 'Advance', count: count('Advance') },
        { key: 'Overtime', label: 'Overtime', count: count('Overtime') }, { key: 'CompOff', label: 'Comp-off', count: count('CompOff') },
        { key: 'Profile', label: 'Profile', count: count('Profile') }]} value={tab} onChange={setTab} />
      {tab === 'leave'
        ? <LeaveList rows={leave?.entries ?? []} onCancel={(id) => cancel('leave', id)} />
        : <RequestList rows={(reqs ?? []).filter((r: any) => r.Type === tab)} amount={tab === 'Expense' || tab === 'Advance'} onCancel={(id) => cancel('requests', id)} />}
      {dialog === 'reg' && <RegulariseDialog initial={{ date: today(), time: '' }} onClose={() => setDialog(null)} onSaved={reloadReqs} />}
      {(dialog === 'Expense' || dialog === 'Advance') && <ExpenseDialog kind={dialog} onClose={() => setDialog(null)} onSaved={reloadReqs} />}
      {dialog === 'Overtime' && <OvertimeDialog onClose={() => setDialog(null)} onSaved={reloadReqs} />}
      {dialog === 'CompOff' && <CompOffDialog onClose={() => setDialog(null)} onSaved={reloadReqs} />}
    </Wrap>
  );
}

function LeaveList({ rows, onCancel }: { rows: any[]; onCancel: (id: number) => void }) {
  return (
    <div className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm">
      {rows.length === 0 && <div className="p-8 text-center text-sm text-slate-400">No leave requests this year.</div>}
      {rows.map((l) => (
        <div key={l.Id} className="flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{l.TypeName} ({l.Type}) · {l.Days} day(s){l.HalfDay ? ' · half day' : ''}</div>
            <div className="text-xs text-slate-500">From <b className="text-slate-700">{l.From}</b> to <b className="text-slate-700">{l.To}</b> · {l.Reason}</div>
            <div className="text-xs text-slate-500">Applied on {l.AppliedOn || '-'}{l.DecidedBy && ` · ${l.Status} by ${l.DecidedBy} on ${l.DecidedOn}`}</div>
          </div>
          <StatusBadge value={l.Status} />
          {l.Status === 'Pending' && <Button variant="danger" onClick={() => onCancel(l.Id)}>Cancel</Button>}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ team

export function TeamRequests() {
  const app = useApp();
  const [data, reload] = useLoad(() => papi.get('/team'), []);
  const [tab, setTab] = useState<'leave' | 'other'>('leave');
  if (!data) return <Loading />;
  const decide = async (kind: string, id: number, decision: 'Approved' | 'Rejected') => {
    const note = decision === 'Rejected' ? await app.prompt('Reason for rejecting (optional)', '', 'Reject') : '';
    if (note === null) return;
    const r = await app.run(() => papi.post('/team/decide', { kind, id, decision, note }));
    if (r) reload();
  };
  const rows = tab === 'leave' ? data.leaves : data.requests;
  return (
    <Wrap>
      <Pills items={[{ key: 'leave', label: 'Leave', count: data.leaves.filter((l: any) => l.Status === 'Pending').length },
        { key: 'other', label: 'Checkin / Expense / Overtime / Comp-off', count: data.requests.filter((l: any) => l.Status === 'Pending').length }]} value={tab} onChange={setTab} />
      <div className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm">
        {rows.length === 0 && <div className="p-8 text-center text-sm text-slate-400">No requests in the last 60 days.</div>}
        {rows.map((r: any) => (
          <div key={r.Id} className="flex flex-wrap items-center gap-3 p-4">
            <Avatar me={{ name: r.Name }} size="size-10" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{r.Name} <span className="font-normal text-slate-500">({r.EnrollNo})</span></div>
              {tab === 'leave'
                ? <div className="text-xs text-slate-500">{r.TypeName} · {r.From} to {r.To} ({r.Days} day(s)) · {r.Reason}</div>
                : <div className="text-xs text-slate-500">{r.TypeName ?? r.Type} · {requestText(r)} · {r.Details}</div>}
              {r.Stage && <div className="mt-0.5 text-[11px] font-medium text-amber-700">{r.Stage}</div>}
              {r.Status !== 'Pending' && r.FirstApprovedBy && <div className="mt-0.5 text-[11px] text-slate-500">Team lead: {r.FirstApprovedBy}{r.DecidedBy ? ` · decided by ${r.DecidedBy}` : ''}</div>}
            </div>
            {r.HasAttachment && <a className="text-sm text-brand-700 underline" href={`/api/portal/requests/${r.Id}/attachment?token=${ptoken()}`} target="_blank" rel="noreferrer">Receipt</a>}
            <StatusBadge value={r.Status} />
            {r.Status === 'Pending' && r.Type === 'Profile' && <span className="text-xs text-slate-500">HR approves</span>}
            {r.Status === 'Pending' && r.Type !== 'Profile' && r.CanDecide === false && <span className="text-xs text-slate-500">{r.FirstApprovedBy ? 'With the manager' : 'With the team lead'}</span>}
            {r.Status === 'Pending' && r.Type !== 'Profile' && r.CanDecide !== false && <>
              <Button variant="success" onClick={() => decide(tab === 'leave' ? 'leave' : 'request', r.Id, 'Approved')}>{r.Step === 'first' ? 'Approve (to manager)' : 'Approve'}</Button>
              <Button variant="danger" onClick={() => decide(tab === 'leave' ? 'leave' : 'request', r.Id, 'Rejected')}>Reject</Button>
            </>}
          </div>
        ))}
      </div>
    </Wrap>
  );
}

export function TeamStats() {
  const [data] = useLoad(() => papi.get('/team'), []);
  if (!data) return <Loading />;
  return (
    <Wrap>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[['All Employees', data.total], ['Present', data.present], ['People Absent', data.absent], ['Late', data.late], ['On Leave', data.onLeave]].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-white p-4 shadow-sm"><div className="text-3xl text-brand-700">{v}</div><div className="text-sm text-slate-600">{k}</div></div>
        ))}
      </div>
      <div className="flex max-h-[65vh] flex-col overflow-hidden rounded-xl bg-white shadow-sm">
        <DataTable rows={data.members} rowKey={(r: any) => r.Id} empty="Nobody in your team."
          columns={[
            { key: 'EnrollNo', header: 'AC No' }, { key: 'Name', header: 'Name' }, { key: 'Department', header: 'Department' },
            { key: 'Status', header: 'Today', align: 'center', render: (r: any) => <StatusBadge value={r.Status} /> },
            { key: 'In', header: 'In' }, { key: 'Out', header: 'Out' }, { key: 'Late', header: 'Late' },
            { key: 'attendancePct', header: 'Attendance (month)', align: 'right', render: (r: any) => `${r.attendancePct}%` },
            { key: 'punctualityPct', header: 'Punctuality', align: 'right', render: (r: any) => `${r.punctualityPct}%` },
          ]} />
      </div>
    </Wrap>
  );
}

// ------------------------------------------------------------------ attendance calendar

const DOT: Record<string, string> = { P: 'bg-green-500', A: 'bg-red-500', HD: 'bg-amber-500', H: 'bg-indigo-500', WO: 'bg-zinc-400' };

export function AttendanceCalendar() {
  const [month, setMonth] = useState(thisMonth());
  const [data, reload] = useLoad(() => papi.get(`/attendance?month=${month}`), [month]);
  const [pick, setPick] = useState<any>(null);
  const [reg, setReg] = useState<{ date: string; time: string } | null>(null);
  if (!data) return <Loading />;
  const first = new Date(`${month}-01T00:00:00`).getDay();
  return (
    <Wrap>
      <div className="flex flex-wrap items-center gap-3">
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" />
        <div className="flex flex-wrap gap-3 text-sm text-slate-600">
          <span>Attendance <b className="text-brand-700">{data.stats.attendancePct}%</b></span>
          <span>Punctuality <b className="text-brand-700">{data.stats.punctualityPct}%</b></span>
          <span>Late days <b className="text-brand-700">{data.stats.lateDays}</b></span>
        </div>
      </div>
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-medium text-slate-500">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="mt-1.5 grid grid-cols-7 gap-1.5">
          {Array.from({ length: first }, (_, i) => <div key={`e${i}`} />)}
          {data.days.map((d: any) => (
            <button key={d.date} type="button" onClick={() => setPick(d)}
              className={`min-h-16 rounded-lg border p-1.5 text-left text-xs transition hover:border-brand-500 ${pick?.date === d.date ? 'border-brand-600 ring-2 ring-brand-100' : 'border-slate-100'}`}>
              <div className="flex items-center justify-between"><span className="font-semibold text-slate-800">{+d.date.slice(8)}</span>{d.status && <span className={`size-2 rounded-full ${DOT[d.status] ?? 'bg-purple-500'}`} />}</div>
              {d.status && <div className="mt-1"><StatusBadge value={d.status} /></div>}
              {d.in && <div className="mt-0.5 hidden text-[11px] text-slate-500 sm:block">{d.in}{d.out && `–${d.out}`}</div>}
            </button>
          ))}
        </div>
      </div>
      {pick && (
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2"><div className="flex-1 font-semibold">{pick.date} ({pick.day})</div><StatusBadge value={pick.status} /></div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>In: <b>{pick.in || '-'}</b></div><div>Out: <b>{pick.out || '-'}</b></div><div>Worked: <b>{pick.worked || '-'}</b></div><div>Late: <b>{pick.late || '-'}</b></div>
            <div>Early: <b>{pick.early || '-'}</b></div><div>OT: <b>{pick.ot || '-'}</b></div><div className="col-span-2">Punches: <b>{pick.punches.join('  ') || '-'}</b></div>
          </div>
          {pick.remark && <div className="mt-2 text-sm text-slate-600">{pick.remark}</div>}
          {pick.date <= today() && <Button className="mt-3" icon="clock" onClick={() => setReg({ date: pick.date, time: '' })}>Regularise this day</Button>}
        </div>
      )}
      {reg && <RegulariseDialog initial={reg} onClose={() => setReg(null)} onSaved={reload} />}
    </Wrap>
  );
}

// ------------------------------------------------------------------ payroll

export function Payslips() {
  const app = useApp();
  const months: string[] = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    months.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  const [busy, setBusy] = useState('');
  const get = async (m: string) => { setBusy(m); await app.run(() => papi.file(`/payslip?month=${m}`)); setBusy(''); };
  return (
    <Wrap>
      <Note tone="info">The payslip of the current month shows the days until today (the month is still in progress).</Note>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {months.map((m) => (
          <div key={m} className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm">
            <span className="grid size-10 place-items-center rounded-lg bg-brand-50 text-brand-700"><Icon name="report" className="size-5" /></span>
            <div className="flex-1 font-medium">{new Date(`${m}-01T00:00:00`).toLocaleString('en-IN', { month: 'long', year: 'numeric' })}</div>
            <Button icon="download" busy={busy === m} onClick={() => get(m)}>PDF</Button>
          </div>
        ))}
      </div>
    </Wrap>
  );
}

export function YearlyReport() {
  const [y, setY] = useState(new Date().getFullYear());
  const [data] = useLoad(() => papi.get(`/payroll/yearly?year=${y}`), [y]);
  return (
    <Wrap>
      <Input type="number" min={2000} max={2100} value={y} onChange={(e) => setY(+e.target.value)} className="w-28" aria-label="Year" />
      {!data ? <Loading /> : (
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          <DataTable rows={[...data.rows, { key: 'total', month: 'Total', ...data.total }]} rowKey={(r: any) => r.key}
            rowClass={(r: any) => (r.key === 'total' ? 'font-semibold bg-brand-50' : '')}
            columns={[
              { key: 'month', header: 'Month' }, { key: 'present', header: 'Present', align: 'right' }, { key: 'absent', header: 'Absent', align: 'right' },
              { key: 'leave', header: 'Leave', align: 'right' }, { key: 'late', header: 'Late', align: 'right' }, { key: 'paidDays', header: 'Paid Days', align: 'right' },
              { key: 'salary', header: 'Salary', align: 'right', render: (r: any) => inr(r.salary) },
              { key: 'deductions', header: 'Deductions', align: 'right', render: (r: any) => inr(r.deductions) },
              { key: 'ot', header: 'OT', align: 'right', render: (r: any) => inr(r.ot) },
              { key: 'net', header: 'Net Pay', align: 'right', render: (r: any) => <b>{inr(r.net)}</b> },
            ]} />
        </div>
      )}
    </Wrap>
  );
}

function ClaimsPage({ kind }: { kind: 'Expense' | 'Advance' }) {
  const app = useApp();
  const [rows, reload] = useLoad(() => papi.get(`/requests?type=${kind}`), []);
  const [open, setOpen] = useState(false);
  const cancel = async (id: number) => {
    if (!(await app.confirm('Cancel this request?'))) return;
    if (await app.run(() => papi.del(`/requests/${id}`))) reload();
  };
  const sum = (st: string) => (rows ?? []).filter((r: any) => r.Status === st).reduce((a: number, r: any) => a + r.Amount, 0);
  return (
    <Wrap>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" icon="add" onClick={() => setOpen(true)}>{kind === 'Expense' ? 'New expense claim' : 'Request advance / loan'}</Button>
        <span className="text-sm text-slate-600">Pending <b>{inr(sum('Pending'))}</b> · Approved <b className="text-green-700">{inr(sum('Approved'))}</b></span>
      </div>
      {rows ? <RequestList rows={rows} amount onCancel={cancel} /> : <Loading />}
      {open && <ExpenseDialog kind={kind} onClose={() => setOpen(false)} onSaved={reload} />}
    </Wrap>
  );
}

export const Reimbursement = () => <ClaimsPage kind="Expense" />;
export const Loans = () => <ClaimsPage kind="Advance" />;

export function Tax() {
  const [data] = useLoad(() => papi.get('/payroll/tax'), []);
  if (!data) return <Loading />;
  return (
    <Wrap>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-white p-5 shadow-sm"><div className="text-sm text-slate-600">Salary paid in FY {data.fy} (so far)</div><div className="text-3xl text-brand-700">{inr(data.gross)}</div></div>
        <div className="rounded-xl bg-white p-5 shadow-sm"><div className="text-sm text-slate-600">Expenses reimbursed in FY {data.fy}</div><div className="text-3xl text-brand-700">{inr(data.reimbursed)}</div></div>
      </div>
      <Note>This is your salary as calculated from attendance (April to March), to help with your income tax declaration. TDS and tax deductions are not managed in this software — please ask HR / accounts.</Note>
      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <DataTable rows={data.rows} rowKey={(r: any) => r.key}
          columns={[{ key: 'month', header: 'Month' }, { key: 'salary', header: 'Monthly salary', align: 'right', render: (r: any) => inr(r.salary) },
            { key: 'deductions', header: 'Deductions', align: 'right', render: (r: any) => inr(r.deductions) }, { key: 'ot', header: 'OT', align: 'right', render: (r: any) => inr(r.ot) },
            { key: 'net', header: 'Net pay', align: 'right', render: (r: any) => inr(r.net) }]} />
      </div>
    </Wrap>
  );
}

// ------------------------------------------------------------------ leave

export function ApplyLeave() {
  const app = useApp();
  const navigate = useNavigate();
  const [data] = useLoad(() => papi.get('/leave'), []);
  const [f, setF] = useState({ LeaveTypeId: '', FromDate: today(), ToDate: today(), IsHalfDay: false, Reason: '' });
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading />;
  const send = async () => {
    setBusy(true);
    const r = await app.run(() => papi.post('/leave', { ...f, LeaveTypeId: +f.LeaveTypeId }));
    setBusy(false);
    if (r) { await app.alert(r.message); navigate('/me/leave-reports'); }
  };
  return (
    <Wrap>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.types.map((t: any) => (
          <div key={t.Id} className="rounded-xl bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold">{t.Name} <span className="text-slate-400">({t.Code})</span></div>
            <div className="mt-1 text-3xl text-brand-700">{t.Remaining === null ? '∞' : two(t.Remaining)}</div>
            <div className="text-xs text-slate-500">{t.Remaining === null ? 'no limit' : `left of ${t.Quota}`} · taken {t.Taken}{t.Pending ? ` · pending ${t.Pending}` : ''}{t.IsPaid ? '' : ' · unpaid'}</div>
          </div>
        ))}
      </div>
      <div className="max-w-2xl rounded-xl bg-white p-5 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Leave type" className="sm:col-span-2">
            <Select value={f.LeaveTypeId} onChange={(e) => setF({ ...f, LeaveTypeId: e.target.value })}>
              <option value="">Select…</option>
              {data.types.map((t: any) => <option key={t.Id} value={t.Id}>{t.Code} - {t.Name}</option>)}
            </Select>
          </Field>
          <Field label="From"><Input type="date" value={f.FromDate} onChange={(e) => setF({ ...f, FromDate: e.target.value, ToDate: e.target.value > f.ToDate ? e.target.value : f.ToDate })} /></Field>
          <Field label="To"><Input type="date" min={f.FromDate} value={f.ToDate} onChange={(e) => setF({ ...f, ToDate: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Check label="Half day (single date)" checked={f.IsHalfDay} onChange={(v) => setF({ ...f, IsHalfDay: v, ToDate: v ? f.FromDate : f.ToDate })} /></div>
          <Field label="Reason" className="sm:col-span-2"><TextArea rows={3} value={f.Reason} onChange={(e) => setF({ ...f, Reason: e.target.value })} /></Field>
        </div>
        <Button variant="primary" className="mt-4 px-6 py-2" busy={busy} onClick={send}>Apply</Button>
        <div className="mt-3"><Note>Your manager / HR approves the request. Holidays and your weekly off inside the dates are not counted as leave.</Note></div>
      </div>
    </Wrap>
  );
}

export function Holidays() {
  const [y, setY] = useState(new Date().getFullYear());
  const [rows] = useLoad(() => papi.get(`/holidays?year=${y}`), [y]);
  return (
    <Wrap>
      <Input type="number" min={2000} max={2100} value={y} onChange={(e) => setY(+e.target.value)} className="w-28" aria-label="Year" />
      <div className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm">
        {rows?.length === 0 && <div className="p-8 text-center text-sm text-slate-400">No holidays entered for {y}.</div>}
        {rows?.map((h: any) => (
          <div key={h.iso} className={`flex items-center gap-4 p-4 ${h.past ? 'opacity-50' : ''}`}>
            <span className="grid size-12 place-items-center rounded-lg bg-brand-50 text-center text-xs leading-tight text-brand-800"><b className="text-lg">{h.iso.slice(8)}</b></span>
            <div className="flex-1"><div className="font-semibold">{h.name}</div><div className="text-xs text-slate-500">{h.day}, {h.date}</div></div>
          </div>
        ))}
      </div>
    </Wrap>
  );
}

export function LeaveReports() {
  const app = useApp();
  const [y, setY] = useState(new Date().getFullYear());
  const [data, reload] = useLoad(() => papi.get(`/leave?year=${y}`), [y]);
  const cancel = async (id: number) => {
    if (!(await app.confirm('Cancel this leave request?'))) return;
    if (await app.run(() => papi.del(`/leave/${id}`))) reload();
  };
  return (
    <Wrap>
      <Input type="number" min={2000} max={2100} value={y} onChange={(e) => setY(+e.target.value)} className="w-28" aria-label="Year" />
      {!data ? <Loading /> : <>
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          <DataTable rows={data.types} rowKey={(t: any) => t.Id}
            columns={[{ key: 'Code', header: 'Code' }, { key: 'Name', header: 'Leave type' }, { key: 'Quota', header: 'Quota / year', align: 'right', render: (t: any) => (t.Quota > 0 ? t.Quota : 'No limit') },
              { key: 'Taken', header: 'Taken', align: 'right' }, { key: 'Pending', header: 'Pending', align: 'right' },
              { key: 'Remaining', header: 'Balance', align: 'right', render: (t: any) => (t.Remaining === null ? '-' : <b>{t.Remaining}</b>) }]} />
        </div>
        <LeaveList rows={data.entries} onCancel={cancel} />
      </>}
    </Wrap>
  );
}

// ------------------------------------------------------------------ profile

export function Profile() {
  const { me } = useMe();
  const app = useApp();
  const [pwd, setPwd] = useState(false);
  const [change, setChange] = useState(false);
  const hr: Record<string, string> = me.hr ?? {};
  const rows: [string, string][] = [['AC No', me.enrollNo], ['No.', me.badgeNo], ['Department', me.department], ['Designation', me.designation], ['Shift', me.shift],
    ['Reporting manager', me.reportingManager ?? ''], ['Date of joining', me.joinDate], ['Date of birth', me.birthDate], ['Gender', me.gender], ['Mobile', me.phone],
    ['Email', me.email], ['Address', me.address]];
  const groups: [string, string[]][] = [
    ['Personal & emergency contact', ['BloodGroup', 'MaritalStatus', 'PersonalEmail', 'EmergencyName', 'EmergencyRelation', 'EmergencyPhone']],
    ['Statutory', ['Pan', 'Aadhaar', 'Uan', 'PfNo', 'EsiNo']],
    ['Bank account (salary)', ['BankName', 'AccountHolder', 'BankAccount', 'BankIfsc']],
  ];
  const dl = (list: [string, string][]) => (
    <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
      {list.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-36 shrink-0 text-slate-500">{k}</dt><dd className="font-medium break-all">{v || '-'}</dd></div>)}
    </dl>
  );
  return (
    <Wrap>
      <div className="flex flex-col gap-5 rounded-xl bg-white p-6 shadow-sm sm:flex-row">
        <Avatar me={me} size="size-28" />
        <div className="flex-1">
          <div className="text-2xl font-semibold">{me.name}</div>
          <div className="text-slate-500">{me.designation || 'Employee'}{me.role === 'TeamLead' ? ' · Team Lead' : me.isManager ? ' · Manager' : ''}</div>
          <div className="mt-4">{dl(rows)}</div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button icon="edit" variant="primary" disabled={me.pendingProfileChange} onClick={() => setChange(true)}>Request a change</Button>
            <Button icon="lock" onClick={() => setPwd(true)}>Change password</Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {me.pendingProfileChange ? 'Your profile change is waiting for HR approval (see My Requests → Profile).' : 'Changes you ask for are applied after HR approves them.'}
          </p>
        </div>
      </div>
      {groups.map(([title, keys]) => (
        <Section key={title} title={title}>{dl(keys.map((k): [string, string] => [fieldLabel(k), hr[k] ?? '']))}</Section>
      ))}
      {change && <ProfileChangeDialog onClose={() => setChange(false)} />}
      {pwd && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={() => setPwd(false)}>
          <div onClick={(e) => e.stopPropagation()}><ChangePassword onDone={async () => { setPwd(false); await app.alert('Password changed.'); }} /></div>
        </div>
      )}
    </Wrap>
  );
}
