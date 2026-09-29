import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';
import { AppProvider, type Permissions } from './app';
import './index.css';
import { Layout } from './Layout';
import { AcLog } from './pages/AcLog';
import { AuditLog, Notifications, Users } from './pages/Admin';
import { Dashboard } from './pages/Dashboard';
import { PayrollSetup } from './pages/PayrollSetup';
import { Roster } from './pages/Roster';
import { Departments } from './pages/Departments';
import { Employees } from './pages/Employees';
import { Leave } from './pages/Leave';
import { MachineList } from './pages/MachineList';
import { Reports } from './pages/Reports';
import { Schedule } from './pages/Schedule';
import { Settings } from './pages/Settings';
import { Shifts } from './pages/Shifts';
import { PortalAdmin } from './pages/PortalAdmin';
import { PortalRoot } from './portal/PortalApp';
import { Button, Icon, Input } from './ui';

function Login({ onDone }: { onDone: (user: string) => void }) {
  const [user, setUser] = useState('Supervisor');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/auth/login', { user, password });
      setToken(r.token);
      onDone(r.user);
    } catch (err: any) {
      setError(err.message);
    } finally { setBusy(false); }
  };
  return (
    <div className="grid h-full place-items-center bg-gradient-to-br from-brand-900 via-brand-700 to-nav p-4">
      <form onSubmit={submit} className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center gap-3 bg-gradient-to-r from-brand-800 to-brand-600 px-5 py-4 text-white">
          <Icon name="finger" className="size-8 text-amber-300" />
          <div>
            <div className="font-semibold">Attendance Management Program</div>
            <div className="text-xs text-white/75">Login</div>
          </div>
        </div>
        <div className="space-y-3 p-5">
          <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">User</span>
            <Input value={user} onChange={(e) => setUser(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Password</span>
            <Input type="password" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} /></label>
          {error && <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</div>}
          <Button type="submit" variant="primary" busy={busy} className="w-full justify-center">Login</Button>
        </div>
      </form>
    </div>
  );
}

function Root() {
  const [state, setState] = useState<{ user: string; role: string; permissions: Permissions; company: string } | 'login' | 'loading' | { error: string }>('loading');

  const start = useCallback(async () => {
    try {
      const status = await api.get('/auth/status');
      if (!status.passwordRequired && !getToken()) {
        const r = await api.post('/auth/login', { user: 'Supervisor', password: '' });
        setToken(r.token);
      }
      if (!getToken()) return setState('login');
      const me = await api.get('/auth/me');
      setState({ user: me.user, role: me.role, permissions: me.permissions, company: status.company });
    } catch (e: any) {
      if (e.status === 401) { setToken(''); setState('login'); } else setState({ error: e.message });
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { setToken(''); setState('login'); });
    start();
  }, [start]);

  const logout = useCallback(() => {
    api.post('/auth/logout').catch(() => {});
    setToken('');
    setState('login');
  }, []);

  if (state === 'loading') return <div className="grid h-full place-items-center text-slate-500">Loading…</div>;
  if (state === 'login') return <Login onDone={() => start()} />;
  if ('error' in state)
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md rounded-lg border border-red-200 bg-white p-5 shadow">
          <div className="font-semibold text-red-700">Cannot start</div>
          <p className="mt-2 text-sm text-slate-600">{state.error}</p>
          <Button className="mt-4" onClick={() => { setState('loading'); start(); }}>Try again</Button>
        </div>
      </div>
    );

  return (
    <AppProvider user={state.user} role={state.role} permissions={state.permissions} company={state.company} logout={logout}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="machines" element={<MachineList />} />
            <Route path="roster" element={<Roster />} />
            <Route path="payroll" element={<PayrollSetup />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="users" element={<Users />} />
            <Route path="audit" element={<AuditLog />} />
            <Route path="employees" element={<Employees />} />
            <Route path="aclog" element={<AcLog />} />
            <Route path="reports" element={<Reports />} />
            <Route path="departments" element={<Departments />} />
            <Route path="shifts" element={<Shifts />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="leave" element={<Leave />} />
            <Route path="settings" element={<Settings />} />
            <Route path="portal-admin" element={<PortalAdmin />} />
            <Route path="*" element={<Dashboard />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}

// /me = employee portal (own login); everything else = the administrator program.
const portal = location.pathname === '/me' || location.pathname.startsWith('/me/');
createRoot(document.getElementById('root')!).render(<StrictMode>{portal ? <PortalRoot /> : <Root />}</StrictMode>);
