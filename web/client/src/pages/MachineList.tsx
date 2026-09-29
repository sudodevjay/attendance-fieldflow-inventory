/** Machine List (home): devices, records received in this session, connection log, Raspberry Pi commands. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../app';
import { DataTable, type Column } from '../DataTable';
import { runAction, type Action } from '../nav';
import { Card, Icon, Page, StatusBadge, Tabs } from '../ui';

interface Device { Id: number; Name: string; Status: string; online: boolean; viaPi: boolean; MachineNumber: number; Comm: string; Baud: string; Ip: string; Port: string;
  ProductName: string | null; UserCount: number | null; AdminCount: number | null; FpCount: number | null; FaceCount: number | null; PasswordCount: number | null;
  LogCount: number | null; SerialNumber: string | null }

const MENU: ({ label: string; action: Action; icon: string; color: string } | null)[] = [
  { label: 'Connect', action: 'connect', icon: 'play', color: '#16a34a' },
  { label: 'Disconnect', action: 'disconnect', icon: 'stop', color: '#dc2626' },
  null,
  { label: 'Download attendance logs', action: 'downloadLogs', icon: 'download', color: '#16a34a' },
  { label: 'Download user info and Fp', action: 'downloadUsers', icon: 'download', color: '#2563eb' },
  { label: 'Upload user info and FP', action: 'uploadUsers', icon: 'upload', color: '#ea580c' },
  null,
  { label: 'Device Information', action: 'deviceInfo', icon: 'info', color: '#2563eb' },
  { label: 'Synchronize Time', action: 'syncTime', icon: 'sync', color: '#2563eb' },
  { label: 'Clear Attendance Logs', action: 'clearLogs', icon: 'trash', color: '#dc2626' },
  { label: 'Restart Device', action: 'restart', icon: 'refresh', color: '#696969' },
  null,
  { label: 'Edit Device', action: 'editDevice', icon: 'edit', color: '#2563eb' },
  { label: 'Delete Device', action: 'deleteDevice', icon: 'close', color: '#2563eb' },
];

export function MachineList() {
  const app = useApp();
  const [devices, setDevices] = useState<Device[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [commands, setCommands] = useState<any[]>([]);
  const [tab, setTab] = useState<'log' | 'pi'>('log');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const last = useRef({ log: 0, rec: 0 });
  const logEnd = useRef<HTMLDivElement>(null);
  const { selectedDevices, setSelectedDevices } = app;

  const loadDevices = useCallback(() => api.get('/devices').then((r) => {
    setDevices(r.devices);
    if (!r.devices.some((d: Device) => selectedDevices.includes(d.Id)) && r.devices.length) setSelectedDevices([r.devices[0].Id]);
  }).catch(() => {}), [selectedDevices, setSelectedDevices]);

  useEffect(() => { loadDevices(); }, [app.dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(loadDevices, 10_000);
    return () => clearInterval(t);
  }, [loadDevices]);

  // Connection log + received records, polled every 3 seconds.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await api.get(`/devices/events?log=${last.current.log}&rec=${last.current.rec}`);
        if (stop) return;
        if (r.logs.length) { last.current.log = r.logs[r.logs.length - 1].id; setLogs((l) => [...l, ...r.logs].slice(-500)); }
        if (r.records.length) { last.current.rec = r.records[r.records.length - 1].id; setRecords((x) => [...x, ...r.records].slice(-2000)); }
      } catch { /* server restarting */ }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  useEffect(() => { logEnd.current?.scrollIntoView({ block: 'nearest' }); }, [logs]);

  const current = devices.find((d) => selectedDevices.includes(d.Id));
  useEffect(() => {
    if (tab !== 'pi' || !current) return;
    const load = () => api.get(`/devices/${current.Id}/commands`).then(setCommands).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [tab, current?.Id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); };
  }, [menu]);

  const n = (v: number | null) => (v === null || v === undefined ? '' : String(v));
  const cols: Column<Device>[] = [
    { key: 'icon', header: '', sortable: false, render: (d) => <Icon name="sync" className="size-4" color={d.online ? '#14a028' : '#9ca3af'} /> },
    { key: 'Name', header: 'Device Name' },
    { key: 'Status', header: 'Status', align: 'center', render: (d) => <StatusBadge value={d.Status} /> },
    { key: 'MachineNumber', header: 'MachineNo', align: 'center' },
    { key: 'Comm', header: 'Comm type', align: 'center' },
    { key: 'Baud', header: 'Baud Rate', align: 'center' },
    { key: 'Ip', header: 'IP Address', align: 'center' },
    { key: 'Port', header: 'Port', align: 'center' },
    { key: 'ProductName', header: 'ProductName', align: 'center', render: (d) => d.ProductName ?? '' },
    { key: 'UserCount', header: 'UserCount', align: 'center', render: (d) => n(d.UserCount) },
    { key: 'AdminCount', header: 'Admin Count', align: 'center', render: (d) => n(d.AdminCount) },
    { key: 'FpCount', header: 'Fp Count', align: 'center', render: (d) => n(d.FpCount) },
    { key: 'FaceCount', header: 'Fc Count', align: 'center', render: (d) => n(d.FaceCount) },
    { key: 'PasswordCount', header: 'Passwo..', align: 'center', render: (d) => n(d.PasswordCount) },
    { key: 'LogCount', header: 'Log Count', align: 'center', render: (d) => n(d.LogCount) },
    { key: 'SerialNumber', header: 'Serial Number', align: 'center', render: (d) => d.SerialNumber ?? '' },
  ];

  return (
    <Page title="Machine List" icon="device" bodyClass="flex flex-col gap-3">
      <Card title="Machine List" className="min-h-40 flex-[1.1]"
        actions={<span className="text-xs text-slate-500">Right click a device for commands · double click to edit</span>}>
        <DataTable columns={cols} rows={devices} rowKey={(d) => d.Id} selected={selectedDevices} onSelect={(k) => setSelectedDevices(k as number[])}
          onDoubleClick={() => runAction('editDevice')} onContextMenu={(_d, e) => setMenu({ x: e.clientX, y: e.clientY })}
          empty="No device yet. Toolbar → Device (Add Device)." />
      </Card>

      <div className="flex min-h-48 flex-1 flex-col gap-3 lg:flex-row">
        <Card title={`Records (${records.length})`} className="min-h-40 flex-1"
          actions={records.length > 0 && <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setRecords([])}>Clear</button>}>
          <DataTable compact rows={[...records].reverse()} rowKey={(r) => r.id} empty="Punches received from the Raspberry Pi or imported from a pendrive appear here."
            columns={[
              { key: 'id', header: 'Id', align: 'right' }, { key: 'enrollNo', header: 'Ac-No' }, { key: 'name', header: 'Name' },
              { key: 'time', header: 'sTime' }, { key: 'machine', header: 'Machine' }, { key: 'verify', header: 'Verify Mode' },
            ]} />
        </Card>
        <div className="flex min-h-40 flex-col lg:w-[420px]">
          <Tabs tabs={[{ key: 'log', label: 'Connection log' }, { key: 'pi', label: 'Pi commands' }]} value={tab} onChange={setTab} />
          <Card className="flex-1 rounded-t-none border-t-0">
            {tab === 'log' ? (
              <div className="min-h-0 flex-1 overflow-auto font-mono text-xs scroll-thin">
                {logs.length === 0 && <div className="p-4 text-center text-slate-400">No messages yet.</div>}
                {logs.map((l) => (
                  <div key={l.id} className={`flex gap-2 border-b border-slate-100 px-2 py-1 ${/^failed/i.test(l.message) ? 'text-red-600' : /^succeed|online/i.test(l.message) ? 'text-green-700' : ''}`}>
                    <span className="w-7 shrink-0 text-right text-slate-400">{l.id}</span>
                    <span className="flex-1">[{l.deviceId}] {l.message}</span>
                    <span className="shrink-0 text-slate-400">{l.time}</span>
                  </div>
                ))}
                <div ref={logEnd} />
              </div>
            ) : (
              <DataTable compact rows={commands} rowKey={(c) => c.Id} empty={current?.viaPi ? 'No commands sent to this Pi yet.' : 'The selected device is not connected through a Raspberry Pi.'}
                columns={[
                  { key: 'Id', header: '#', align: 'right' }, { key: 'What', header: 'Command' },
                  { key: 'Status', header: 'Status', render: (c) => <StatusBadge value={c.Status === 'done' ? 'Approved' : c.Status === 'failed' ? 'Rejected' : 'Pending'} /> },
                  { key: 'Error', header: 'Error', render: (c) => <span className="text-red-600">{c.Error ?? ''}</span> },
                  { key: 'CreatedAt', header: 'Sent' },
                ]} />
            )}
          </Card>
        </div>
      </div>

      {menu && (
        <div className="fixed z-50 min-w-56 rounded-md border border-slate-200 bg-white py-1 shadow-xl" role="menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 380) }}>
          {MENU.map((m, i) => m === null
            ? <div key={i} className="my-1 border-t border-slate-200" />
            : (
              <button key={m.label} type="button" role="menuitem" onClick={() => { setMenu(null); runAction(m.action); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-brand-50">
                <Icon name={m.icon} className="size-3.5" color={m.color} />{m.label}
              </button>
            ))}
        </div>
      )}
    </Page>
  );
}
