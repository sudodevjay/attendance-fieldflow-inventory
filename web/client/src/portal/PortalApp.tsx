/** Employee portal (/me): login, first-login password change, sidebar layout like the design (server.png). */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppProvider, useApp } from '../app';
import { Button, Icon, Input } from '../ui';
import { papi, ptoken, setPortalLogoutHandler, setPtoken } from './papi';
import { BellIcon, CompOff, Documents, Notifications } from './HrPages';
import {
  ApplyLeave, AttendanceCalendar, Holidays, Home, LeaveReports, Loans, MyRequests, Payslips, Profile, Reimbursement, Tax, TeamRequests, TeamStats, YearlyReport,
} from './PortalPages';

export interface Me {
  id: number; enrollNo: string; name: string; designation: string; department: string; shift: string; phone: string; email: string;
  gender: string; badgeNo: string; joinDate: string; birthDate: string; address: string; photo: string | null; isManager: boolean;
  mustChange: boolean; company: string; office: string; allowCheckIn: boolean;
  reportingManager?: string;
  /** HR profile (bank account and Aadhaar masked). */
  hr?: Record<string, string>;
  /** Fields the employee may ask HR to change. */
  selfFields?: string[];
  pendingProfileChange?: boolean;
}

const MeCtx = createContext<{ me: Me; reload: () => Promise<void> } | null>(null);
export const useMe = () => useContext(MeCtx)!;

export function Avatar({ me, size = 'size-8' }: { me: { name: string; photo?: string | null }; size?: string }) {
  return me.photo
    ? <img src={`data:image/jpeg;base64,${me.photo}`} alt="" className={`${size} rounded-full object-cover`} />
    : <span className={`${size} grid place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800`}>{me.name.slice(0, 1).toUpperCase()}</span>;
}

function Login({ onDone }: { onDone: () => void }) {
  const [enrollNo, setEnrollNo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ company: string }>({ company: '' });
  useEffect(() => { papi.get('/info').then(setInfo).catch(() => {}); }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await papi.post('/login', { enrollNo, password });
      setPtoken(r.token);
      onDone();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="grid min-h-full place-items-center bg-slate-100 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-7 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-lg bg-brand-700 text-sm font-bold text-white">{(info.company || 'HS').slice(0, 2).toUpperCase()}</span>
          <div>
            <div className="text-lg font-semibold text-slate-900">Employee Login</div>
            <div className="text-xs text-slate-500">{info.company}</div>
          </div>
        </div>
        <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">AC No (employee ID)</span>
          <Input value={enrollNo} inputMode="numeric" autoFocus onChange={(e) => setEnrollNo(e.target.value)} /></label>
        <label className="mt-3 block"><span className="mb-1 block text-xs font-medium text-slate-600">Password</span>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</div>}
        <Button type="submit" variant="primary" busy={busy} className="mt-5 w-full justify-center py-2">Log in</Button>
        <p className="mt-4 text-center text-xs text-slate-500">No password yet? Ask HR to create your login.</p>
      </form>
    </div>
  );
}

export function ChangePassword({ onDone, first }: { onDone: () => void; first?: boolean }) {
  const [f, setF] = useState({ current: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await papi.post('/password', f); onDone(); } catch (err: any) { setError(err.message); }
  };
  return (
    <form onSubmit={save} className="w-full max-w-sm rounded-2xl bg-white p-7 shadow-xl">
      <div className="text-lg font-semibold">{first ? 'Choose your password' : 'Change password'}</div>
      {first && <p className="mt-1 text-xs text-slate-500">You logged in with a temporary password. Choose your own (at least 6 characters).</p>}
      {(['current', 'password', 'confirm'] as const).map((k) => (
        <label key={k} className="mt-3 block"><span className="mb-1 block text-xs font-medium text-slate-600">{k === 'current' ? (first ? 'Temporary password' : 'Current password') : k === 'password' ? 'New password' : 'Confirm new password'}</span>
          <Input type="password" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
      ))}
      {error && <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</div>}
      <Button type="submit" variant="primary" className="mt-5 w-full justify-center py-2">Save</Button>
    </form>
  );
}

interface Item { label: string; to: string }
interface Group { label: string; icon: string; to?: string; items?: Item[]; manager?: boolean }

const NAV: Group[] = [
  { label: 'Home', icon: 'home', to: '/me' },
  { label: 'Requests', icon: 'person', items: [{ label: 'My Requests', to: '/me/requests' }, { label: 'Team Requests', to: '/me/team-requests' }] },
  { label: 'Team Stats', icon: 'people', to: '/me/team-stats', manager: true },
  { label: 'Attendance', icon: 'calendar', items: [{ label: 'Attendance Calendar', to: '/me/attendance' }, { label: 'Comp-off', to: '/me/comp-off' }] },
  {
    label: 'Payroll', icon: 'report', items: [
      { label: 'Payslips Download', to: '/me/payslips' }, { label: 'Yearly Report', to: '/me/yearly' }, { label: 'Reimbursement', to: '/me/reimbursement' },
      { label: 'Tax', to: '/me/tax' }, { label: 'Loans & Advances', to: '/me/loans' },
    ],
  },
  { label: 'Leave Management', icon: 'flag', items: [{ label: 'Apply Leave', to: '/me/apply-leave' }, { label: 'See Holidays', to: '/me/holidays' }, { label: 'Leave Reports', to: '/me/leave-reports' }] },
  { label: 'My Documents', icon: 'folder', to: '/me/documents' },
  { label: 'Notifications', icon: 'info', to: '/me/notifications' },
];

const TITLES: Record<string, string> = {
  '/me': 'Home', '/me/requests': 'My Requests', '/me/team-requests': 'Team Requests', '/me/team-stats': 'Team Stats', '/me/attendance': 'Attendance',
  '/me/payslips': 'Payslips Download', '/me/yearly': 'Yearly Report', '/me/reimbursement': 'Reimbursement', '/me/tax': 'Tax', '/me/loans': 'Loans & Advances',
  '/me/apply-leave': 'Apply Leave', '/me/holidays': 'Holidays', '/me/leave-reports': 'Leave Reports', '/me/profile': 'My Profile',
  '/me/comp-off': 'Comp-off', '/me/documents': 'My Documents', '/me/notifications': 'Notifications',
};

/** Unread notifications, polled every minute and after they are marked read. */
function useUnread() {
  const [n, setN] = useState(0);
  useEffect(() => {
    let stop = false;
    const load = () => papi.get('/notifications').then((d) => { if (!stop) setN(d.unread); }).catch(() => {});
    load();
    const i = setInterval(load, 60_000);
    window.addEventListener('portal:notifications', load);
    return () => { stop = true; clearInterval(i); window.removeEventListener('portal:notifications', load); };
  }, []);
  return n;
}

function Clock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i); }, []);
  return <>{t.toLocaleTimeString('en-GB')}</>;
}

function Shell() {
  const { me } = useMe();
  const { logout } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState<string[]>(['Requests', 'Attendance', 'Payroll', 'Leave Management']);
  const unread = useUnread();
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => { setMobile(false); setMenu(false); }, [location.pathname]);
  const title = TITLES[location.pathname] ?? 'Home';

  const sidebar = (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2 px-5 pt-5 pb-4">
        <span className="grid size-10 place-items-center rounded bg-brand-700 text-sm font-bold text-white">{me.company.slice(0, 2).toUpperCase()}</span>
        <span className="truncate text-sm font-semibold text-slate-800">{me.company}</span>
      </div>
      <div className="mx-5 border-b border-slate-200" />
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4 scroll-thin" aria-label="Employee menu">
        {NAV.filter((g) => !g.manager || me.isManager).map((g) => {
          const items = g.items?.filter((i) => me.isManager || i.to !== '/me/team-requests');
          const shut = !open.includes(g.label);
          const head = 'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-[14px] font-medium';
          return (
            <div key={g.label} className="mb-1">
              {g.to ? (
                <NavLink to={g.to} end className={({ isActive }) => `${head} ${isActive ? 'bg-brand-100 text-brand-800' : 'text-brand-800 hover:bg-slate-50'}`}>
                  <Icon name={g.icon} className="size-5" />{g.label}
                </NavLink>
              ) : (
                <>
                  <button type="button" className={`${head} text-brand-800 hover:bg-slate-50`} aria-expanded={!shut}
                    onClick={() => setOpen((o) => (shut ? [...o, g.label] : o.filter((x) => x !== g.label)))}>
                    <Icon name={g.icon} className="size-5" /><span className="flex-1 text-left">{g.label}</span>
                    <Icon name="chevron" className={`size-4 text-slate-400 transition ${shut ? '' : 'rotate-180'}`} />
                  </button>
                  {!shut && items?.map((i) => (
                    <NavLink key={i.to} to={i.to} className={({ isActive }) => `block rounded-md py-1.5 pr-2 pl-11 text-[13px] ${isActive ? 'bg-brand-50 font-semibold text-brand-800' : 'text-slate-700 hover:bg-slate-50'}`}>
                      {i.label}
                    </NavLink>
                  ))}
                </>
              )}
            </div>
          );
        })}
      </nav>
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid size-7 place-items-center rounded-full bg-green-500 text-white"><Icon name="check" className="size-4" /></span>
        <div>
          <div className="text-[13px] font-semibold text-slate-800">{me.office}</div>
          <div className="text-lg font-semibold text-brand-700 tabular-nums"><Clock /></div>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex h-full bg-slate-100">
      {!collapsed && <div className="hidden lg:block">{sidebar}</div>}
      {mobile && (
        <div className="fixed inset-0 z-40 flex lg:hidden" onClick={() => setMobile(false)}>
          <div onClick={(e) => e.stopPropagation()}>{sidebar}</div>
          <div className="flex-1 bg-slate-900/30" />
        </div>
      )}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-8">
          <button type="button" aria-label="Menu" onClick={() => (window.innerWidth >= 1024 ? setCollapsed((c) => !c) : setMobile(true))}
            className="grid size-8 place-items-center rounded-md bg-brand-700 text-white hover:bg-brand-800">
            <Icon name={collapsed ? 'menu' : 'chevron'} className={`size-4 ${collapsed ? '' : 'rotate-90'}`} />
          </button>
          <h1 className="flex-1 truncate text-xl font-semibold text-slate-900">{title}</h1>
          <button type="button" className="relative rounded-full p-1.5 text-brand-700 hover:bg-slate-100" aria-label={`Notifications (${unread} unread)`} onClick={() => navigate('/me/notifications')}>
            <BellIcon className="size-5" />
            {unread > 0 && <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] leading-4 font-semibold text-white">{unread > 99 ? '99+' : unread}</span>}
          </button>
          <div className="relative">
            <button type="button" onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-full py-1 pr-2 pl-1 hover:bg-slate-100">
              <Avatar me={me} /><span className="hidden text-[15px] font-medium text-slate-800 sm:inline">{me.name}</span>
            </button>
            {menu && (
              <div className="absolute right-0 z-30 mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
                <button type="button" className="block w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => navigate('/me/profile')}>My profile</button>
                <button type="button" className="block w-full px-3 py-2 text-left text-red-600 hover:bg-slate-50" onClick={logout}>Log out</button>
              </div>
            )}
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          <Routes>
            <Route path="/me" element={<Home />} />
            <Route path="/me/requests" element={<MyRequests />} />
            <Route path="/me/team-requests" element={<TeamRequests />} />
            <Route path="/me/team-stats" element={<TeamStats />} />
            <Route path="/me/attendance" element={<AttendanceCalendar />} />
            <Route path="/me/payslips" element={<Payslips />} />
            <Route path="/me/yearly" element={<YearlyReport />} />
            <Route path="/me/reimbursement" element={<Reimbursement />} />
            <Route path="/me/tax" element={<Tax />} />
            <Route path="/me/loans" element={<Loans />} />
            <Route path="/me/apply-leave" element={<ApplyLeave />} />
            <Route path="/me/holidays" element={<Holidays />} />
            <Route path="/me/leave-reports" element={<LeaveReports />} />
            <Route path="/me/profile" element={<Profile />} />
            <Route path="/me/comp-off" element={<CompOff />} />
            <Route path="/me/documents" element={<Documents />} />
            <Route path="/me/notifications" element={<Notifications />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export function PortalRoot() {
  const [me, setMe] = useState<Me | null | 'login' | 'loading'>('loading');
  const load = useCallback(async () => {
    if (!ptoken()) return setMe('login');
    try { setMe(await papi.get('/me')); } catch { setMe('login'); }
  }, []);
  useEffect(() => { setPortalLogoutHandler(() => setMe('login')); load(); }, [load]);
  const logout = useCallback(() => { papi.post('/logout').catch(() => {}); setPtoken(''); setMe('login'); }, []);

  if (me === 'loading') return <div className="grid h-full place-items-center text-slate-500">Loading…</div>;
  if (me === 'login' || me === null) return <Login onDone={load} />;
  if (me.mustChange) return <div className="grid min-h-full place-items-center bg-slate-100 p-4"><ChangePassword first onDone={load} /></div>;
  return (
    <AppProvider user={me.name} company={me.company} logout={logout}>
      <MeCtx.Provider value={{ me, reload: load }}>
        <BrowserRouter><Shell /></BrowserRouter>
      </MeCtx.Provider>
    </AppProvider>
  );
}

export function Section({ title, icon, action, children, className = '' }: { title: string; icon?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        {icon && <Icon name={icon} className="size-5 text-slate-900" />}
        <h2 className="flex-1 text-lg font-semibold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
