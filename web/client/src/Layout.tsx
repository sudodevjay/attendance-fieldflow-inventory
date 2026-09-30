/** Main window: blue sidebar with every header / menu / left-panel item, title bar, content, status bar. */
import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api';
import { useApp } from './app';
import { AdminDialog, AttendanceRuleDialog, BackupDialog, DeviceDialog, HelpDialog, ImportDialog, SalaryRuleDialog } from './dialogs';
import { NAV, type Action, type NavGroup } from './nav';
import { Icon } from './ui';

const COLLAPSE_KEY = 'zk.nav.collapsed';

function loadCollapsed(): string[] {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]'); } catch { return []; }
}

export function Layout() {
  const app = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<string[]>(loadCollapsed);
  const [open, setOpen] = useState<{ kind: string; device?: any } | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [devices, setDevices] = useState<{ total: number; online: number }>({ total: 0, online: 0 });
  const [mobileNav, setMobileNav] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const loadDevices = useCallback(() => {
    api.get('/devices').then((r) => setDevices({ total: r.devices.length, online: r.connected })).catch(() => {});
  }, []);
  useEffect(() => {
    loadDevices();
    const t = setInterval(loadDevices, 20_000);
    return () => clearInterval(t);
  }, [loadDevices, app.dataVersion]);
  useEffect(() => { setMobileNav(false); }, [location.pathname]);
  // HR notifications (new requests): count in the header bell.
  const { can } = app;
  const loadUnread = useCallback(() => {
    if (can('portal')) api.get('/notifications').then((r) => setUnread(r.unread)).catch(() => {});
  }, [can]);
  useEffect(() => {
    loadUnread();
    const t = setInterval(loadUnread, 60_000);
    window.addEventListener('zk:notifications', loadUnread);
    return () => { clearInterval(t); window.removeEventListener('zk:notifications', loadUnread); };
  }, [loadUnread]);
  // Screens (Machine List right click, ...) run the same actions as the sidebar.
  useEffect(() => {
    const on = (e: Event) => act((e as CustomEvent<Action>).detail);
    window.addEventListener('zk:action', on);
    return () => window.removeEventListener('zk:action', on);
  });

  const toggle = (g: NavGroup) => setCollapsed((c) => {
    const next = c.includes(g.title) ? c.filter((x) => x !== g.title) : [...c, g.title];
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  /** Selected devices of the Machine List; if none, the first device. */
  const targets = async (): Promise<any[]> => {
    const r = await api.get('/devices');
    const list = r.devices.filter((d: any) => app.selectedDevices.includes(d.Id));
    if (list.length === 0 && r.devices.length) list.push(r.devices[0]);
    if (!list.length) throw new Error('Add a device to the Machine List first (Toolbar → Device).');
    return list;
  };

  const deviceAction = (action: string, confirmText?: string) => app.run(async () => {
    if (confirmText && !(await app.confirm(confirmText))) return;
    for (const d of await targets()) {
      try {
        const r = await api.post(`/devices/${d.Id}/action`, { action });
        if (r.message) await app.alert(r.message, d.Name);
      } catch (e: any) { await app.alert(e.message, 'Error'); }
    }
    app.dataChanged();
  });

  async function act(a: Action) {
    switch (a) {
      case 'addDevice': return setOpen({ kind: 'device' });
      case 'editDevice': return app.run(async () => setOpen({ kind: 'device', device: (await targets())[0] }));
      case 'deleteDevice': return app.run(async () => {
        const ids = app.selectedDevices;
        if (!ids.length) { await app.alert('Select the device(s) to delete in the Machine List first.'); return navigate('/machines'); }
        if (!(await app.confirm(`Delete ${ids.length} device(s) from the Machine List?\n(Attendance data will remain in the database.)`))) return;
        await api.post('/devices/delete', { ids });
        app.setSelectedDevices([]);
        app.dataChanged();
      });
      case 'connect': return deviceAction('connect');
      case 'disconnect': return deviceAction('disconnect');
      case 'downloadLogs': return deviceAction('download-logs');
      case 'syncTime': return deviceAction('sync-time');
      case 'deviceInfo': return deviceAction('info');
      case 'clearLogs': return deviceAction('clear-logs', 'All attendance records on the selected device will be deleted.\nThey will be downloaded first, then cleared. Continue?');
      case 'restart': return deviceAction('restart', 'Restart the selected device?');
      case 'downloadUsers': return app.run(async () => {
        const overwrite = await app.confirm('Overwrite employee names that already exist in the software with the names from the device?\n\n(No = only new users and empty names will be updated.)');
        for (const d of await targets()) {
          const r = await api.post('/employees/device/download', { deviceId: d.Id, overwrite });
          await app.alert(r.message, d.Name);
        }
        app.dataChanged();
      });
      case 'uploadUsers': return app.run(async () => {
        const emps = await api.get('/employees/options?active=1');
        if (!(await app.confirm(`Upload ${emps.length} active employee(s) (names, passwords, cards) to the selected device?\n(To upload only some employees, use the Employees window.)`))) return;
        for (const d of await targets()) {
          const r = await api.post('/employees/device/upload', { deviceId: d.Id, ids: emps.map((e: any) => e.Id) });
          await app.alert(r.message, d.Name);
        }
      });
      case 'manualPunch': return navigate('/aclog?manual=1');
      case 'exit': {
        if (await app.confirm('Are you sure you want to exit Attendance Management Program?')) app.logout();
        return;
      }
      case 'about': return app.alert('Attendance Management Program (web)\n\nReact + Tailwind CSS, Node.js + TypeScript, PostgreSQL (own database, Supabase in the cloud).\nDevices: ZKTeco LX50 through a Raspberry Pi; pendrive file import.');
      case 'noPhoto':
      case 'noAccess': return app.alert('ZKTeco LX50 has no camera / access control, so this option is not available for this device.');
      default: return setOpen({ kind: a });
    }
  }

  const close = () => setOpen(null);

  const sidebar = (
    <nav className="flex h-full w-60 shrink-0 flex-col bg-gradient-to-b from-nav to-nav-dark p-1.5" aria-label="Main menu">
      <div className="mb-1.5 flex items-center gap-2 rounded-md bg-white/10 px-2 py-2 text-white">
        <Icon name="finger" className="size-6 text-amber-300" />
        <div className="leading-tight">
          <div className="text-[13px] font-semibold">Attendance</div>
          <div className="text-[11px] text-white/70">Management Program</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5 scroll-thin">
        {NAV.map((g) => {
          const shut = collapsed.includes(g.title);
          return (
            <section key={g.title} className="overflow-hidden rounded-md bg-white shadow-sm">
              <button type="button" onClick={() => toggle(g)} aria-expanded={!shut}
                className="flex w-full items-center gap-2 bg-gradient-to-r from-white to-brand-100 px-2.5 py-1.5 text-left text-[13px] font-semibold text-brand-900">
                <span className="flex-1">{g.title}</span>
                <span className={`grid size-4 place-items-center rounded-full border border-brand-200 bg-white transition ${shut ? '' : 'rotate-180'}`}>
                  <Icon name="chevron" className="size-3" />
                </span>
              </button>
              {!shut && (
                <ul className="bg-brand-50/60 py-1">
                  {g.items.filter((it) => !it.area || app.can(it.area, !!it.write)).map((it) => {
                    const cls = 'flex w-full items-center gap-2 px-3 py-[3px] text-left text-[12.5px] text-[#10328a] hover:text-orange-700 hover:underline';
                    const icon = <Icon name={it.icon} className="size-3.5" color={it.color} />;
                    return (
                      <li key={it.label}>
                        {it.to
                          ? <NavLink to={it.to} end className={({ isActive }) => `${cls} ${isActive ? 'font-semibold text-orange-700' : ''}`}>{icon}{it.label}</NavLink>
                          : <button type="button" className={cls} onClick={() => act(it.action!)}>{icon}{it.label}</button>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </nav>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 bg-gradient-to-r from-brand-900 to-brand-700 px-3 py-1.5 text-white">
        <button type="button" className="rounded p-1 hover:bg-white/15 lg:hidden" onClick={() => setMobileNav((v) => !v)} aria-label="Menu">
          <Icon name="menu" />
        </button>
        <Icon name="finger" className="size-4 text-amber-300" />
        <span className="flex-1 truncate text-[13px] font-medium">Housys</span>
        <span className="hidden truncate text-xs text-white/70 sm:inline">{app.company}</span>
        <NavLink to="/notifications" className="relative rounded p-1 hover:bg-white/15" aria-label={`Notifications, ${unread} unread`} title="Notifications">
          <Icon name="bell" className="size-4" />
          {unread > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-amber-400 px-1 text-center text-[10px] font-bold leading-4 text-brand-900">{unread > 99 ? '99+' : unread}</span>}
        </NavLink>
        <button type="button" onClick={() => act('exit')} className="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-white/15">
          <Icon name="logout" className="size-3.5" />Exit
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div className="hidden lg:block">{sidebar}</div>
        {mobileNav && (
          <div className="absolute inset-0 z-40 flex lg:hidden" onClick={() => setMobileNav(false)}>
            <div onClick={(e) => e.stopPropagation()}>{sidebar}</div>
            <div className="flex-1 bg-slate-900/30" />
          </div>
        )}
        <main className="min-w-0 flex-1 bg-slate-100">
          <Outlet />
        </main>
      </div>

      <footer className="flex items-center border-t border-slate-300 bg-gradient-to-b from-slate-100 to-slate-200 text-xs text-slate-700">
        <span className="w-56 truncate px-3 py-1">{app.user}{app.role !== 'Admin' && <span className="ml-1 text-slate-500">({app.role})</span>}</span>
        <span className="w-32 border-l border-slate-300 px-3 py-1">{clock.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        <span className="flex-1 truncate border-l border-slate-300 px-3 py-1">Devices: {devices.total}   Online: {devices.online}</span>
      </footer>

      {open?.kind === 'device' && <DeviceDialog device={open.device ?? null} onClose={close} onSaved={() => { app.dataChanged(); loadDevices(); }} />}
      {open?.kind === 'import' && <ImportDialog onClose={close} />}
      {open?.kind === 'backup' && <BackupDialog onClose={close} />}
      {open?.kind === 'admin' && <AdminDialog onClose={close} />}
      {open?.kind === 'attendanceRule' && <AttendanceRuleDialog onClose={close} />}
      {open?.kind === 'salaryRule' && <SalaryRuleDialog onClose={close} />}
      {open?.kind === 'help' && <HelpDialog onClose={close} />}
    </div>
  );
}
