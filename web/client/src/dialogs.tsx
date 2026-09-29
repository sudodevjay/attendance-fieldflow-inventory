/** Dialogs opened from the sidebar: device, import, backup, administrator, attendance / salary rule, help. */
import { useEffect, useState } from 'react';
import { api } from './api';
import { useApp } from './app';
import { Button, Check, Field, Input, Modal, Note, Select } from './ui';

export const KINDS = ['USB', 'Serial Port/RS485', 'Ethernet', 'ADMS (Push / Cloud)'];

export function DeviceDialog({ device, onClose, onSaved }: { device: any | null; onClose: () => void; onSaved: () => void }) {
  const { run } = useApp();
  const [f, setF] = useState(() => ({
    Name: device?.Name ?? '', Kind: KINDS[device?.Kind ?? 0], MachineNumber: device?.MachineNumber ?? 1, ComPort: device?.ComPort ?? 'COM3',
    BaudRate: String(device?.BaudRate ?? 115200), IpAddress: device?.IpAddress ?? '192.168.1.201', TcpPort: device?.TcpPort ?? 4370,
    CommPassword: device?.CommPassword ?? 0, SerialNumber: device?.SerialNumber ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const k = KINDS.indexOf(f.Kind);
  const save = async () => {
    setBusy(true);
    const ok = await run(() => (device ? api.put(`/devices/${device.Id}`, f) : api.post('/devices', f)));
    setBusy(false);
    if (ok) { onSaved(); onClose(); }
  };
  return (
    <Modal title={device ? 'Edit Device' : 'Add Device'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>OK</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Device Name" className="col-span-2"><Input value={f.Name} onChange={(e) => set('Name', e.target.value)} /></Field>
        <Field label="Comm type"><Select value={f.Kind} onChange={(e) => set('Kind', e.target.value)}>{KINDS.map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Machine No."><Input type="number" min={1} max={255} value={f.MachineNumber} disabled={k === 3} onChange={(e) => set('MachineNumber', +e.target.value)} /></Field>
        <Field label="Port (COM)"><Input value={f.ComPort} disabled={k !== 1} onChange={(e) => set('ComPort', e.target.value)} /></Field>
        <Field label="Baud Rate"><Select value={f.BaudRate} disabled={k !== 1} onChange={(e) => set('BaudRate', e.target.value)}>{['9600', '19200', '38400', '57600', '115200'].map((b) => <option key={b}>{b}</option>)}</Select></Field>
        <Field label="IP Address"><Input value={f.IpAddress} disabled={k !== 2} onChange={(e) => set('IpAddress', e.target.value)} /></Field>
        <Field label="Port (TCP)"><Input type="number" value={f.TcpPort} disabled={k !== 2} onChange={(e) => set('TcpPort', +e.target.value)} /></Field>
        <Field label="Comm Key (Password)"><Input type="number" value={f.CommPassword} disabled={k === 3} onChange={(e) => set('CommPassword', +e.target.value)} /></Field>
        <Field label="Serial Number"><Input value={f.SerialNumber} onChange={(e) => set('SerialNumber', e.target.value)} /></Field>
      </div>
      <div className="mt-3">
        <Note>{'LX50 on a Raspberry Pi: keep Comm type = USB; the serial number is filled in by itself when the Pi first reports (it links the Pi to this row).\n' +
          'USB / Serial / Ethernet on a Windows PC and ADMS (Push / Cloud) devices are driven by the Windows program. Comm Key must match the device (default 0).'}</Note>
      </div>
    </Modal>
  );
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { run, alert, dataChanged } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!file) return;
    setBusy(true);
    const r = await run(() => api.upload('/logs/import', file));
    setBusy(false);
    if (r) { dataChanged(); onClose(); await alert(r.message); }
  };
  return (
    <Modal title="Import Attendance Checking Data" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!file} onClick={go}>Import</Button></>}>
      <Note tone="info">{'USB flash drive: on the device, Menu → USB Manager → Download attendance data. Then choose the file here:\n1_attlog.dat, GLG_001.TXT or a CSV with user id and date-time.'}</Note>
      <input type="file" accept=".dat,.txt,.csv" className="mt-3 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-white"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
    </Modal>
  );
}

export function BackupDialog({ onClose }: { onClose: () => void }) {
  const { run, alert } = useApp();
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/settings/backup/default').then((r) => setPath(r.path)).catch(() => {}); }, []);
  const go = async () => {
    setBusy(true);
    const r = await run(() => api.post('/settings/backup', { path }));
    setBusy(false);
    if (r) { onClose(); await alert(r.message); }
  };
  return (
    <Modal title="Backup Database" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={go}>Backup</Button></>}>
      <Field label="Backup file (on the SQL Server computer)"><Input value={path} onChange={(e) => setPath(e.target.value)} /></Field>
      <div className="mt-3"><Note>The backup file is written by the SQL Server service, so the folder must exist on the SQL Server computer and the service needs write permission to it.</Note></div>
    </Modal>
  );
}

export function AdminDialog({ onClose }: { onClose: () => void }) {
  const { run, alert } = useApp();
  const [has, setHas] = useState<boolean | null>(null);
  const [f, setF] = useState({ current: '', password: '', confirm: '' });
  useEffect(() => { api.get('/auth/status').then((r) => setHas(r.passwordRequired)); }, []);
  const go = async () => {
    const r = await run(() => api.put('/settings/admin-password', f));
    if (r) { onClose(); await alert(r.message); }
  };
  return (
    <Modal title="Administrator" onClose={onClose} width="max-w-sm"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={go}>OK</Button></>}>
      <Note>{has ? 'Change the Supervisor password. Leave the password empty to turn off login.' : 'Set a Supervisor password. The password will then be required to log in (web and Windows program).'}</Note>
      <div className="mt-3 space-y-3">
        {has && <Field label="Current password"><Input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>}
        <Field label="New password"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Field label="Confirm password"><Input type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function AttendanceRuleDialog({ onClose }: { onClose: () => void }) {
  const { run, dataChanged } = useApp();
  const [f, setF] = useState<any>(null);
  useEffect(() => { api.get('/settings/attendance-rule').then(setF); }, []);
  const go = async () => {
    if (await run(() => api.put('/settings/attendance-rule', f))) { dataChanged(); onClose(); }
  };
  return (
    <Modal title="Attendance Rule" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={go} disabled={!f}>OK</Button></>}>
      <Note>Late / early grace, half day and overtime are set per shift (Maintenance Timetables). These are the company-wide rules:</Note>
      {f && (
        <div className="mt-3 space-y-3">
          <Field label="Punch window starts (hours before shift)"><Input type="number" min={0} max={12} value={f.windowBeforeHours} onChange={(e) => setF({ ...f, windowBeforeHours: +e.target.value })} /></Field>
          <Field label="Ignore repeat punch within (minutes)"><Input type="number" min={0} max={120} value={f.duplicateMinutes} onChange={(e) => setF({ ...f, duplicateMinutes: +e.target.value })} /></Field>
          <Field label="Only one punch in a day counts as">
            <Select value={f.singlePunch} onChange={(e) => setF({ ...f, singlePunch: e.target.value })}>{['Present', 'Half Day', 'Absent'].map((x) => <option key={x}>{x}</option>)}</Select>
          </Field>
          <Note>{'Example: shift 09:00 and window 4 hours = punches from 05:00 to 05:00 the next day count for that day.\nRepeat punch: if someone punches twice within 2 minutes, it is counted as one punch.'}</Note>
        </div>
      )}
    </Modal>
  );
}

export function SalaryRuleDialog({ onClose }: { onClose: () => void }) {
  const { run, dataChanged } = useApp();
  const [f, setF] = useState<any>(null);
  useEffect(() => { api.get('/settings/salary-rule').then(setF); }, []);
  const go = async () => {
    if (await run(() => api.put('/settings/salary-rule', f))) { dataChanged(); onClose(); }
  };
  return (
    <Modal title="Salary Rule" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={go} disabled={!f}>OK</Button></>}>
      <Note>{'Monthly salary: per day = Salary ÷ days in month. Pay = per day × (Paid Days − late deduction).\nEnter the salary and OT rate in each employee\'s \'Addition\' tab.'}</Note>
      {f && (
        <div className="mt-3 space-y-3">
          <Field label="Late arrivals per ½ day deduction (0 = off)"><Input type="number" min={0} max={31} value={f.lateCountForHalfDay} onChange={(e) => setF({ ...f, lateCountForHalfDay: +e.target.value })} /></Field>
          <Field label="OT multiplier (for employees with OT rate 0)"><Input type="number" min={0} max={5} step={0.5} value={f.otMultiplier} onChange={(e) => setF({ ...f, otMultiplier: +e.target.value })} /></Field>
          <Check label="Overtime needs approval (pay only the approved OT hours of each day)" checked={!!f.otRequiresApproval} onChange={(v) => setF({ ...f, otRequiresApproval: v })} />
          <Note>{'Example: 3 → 3 late arrivals in a month = ½ day, 6 = 1 day deducted.\nOT multiplier 1 = normal hourly pay, 2 = double. If the employee has their own OT rate, that rate is used.\nWith approval on, employees / managers ask for overtime in the portal or app; unapproved OT is shown in the salary sheet remark.\nSalary structure, PF / ESI / PT: Payroll Setup.'}</Note>
        </div>
      )}
    </Modal>
  );
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('Loading…');
  useEffect(() => { api.get('/settings/readme').then((r) => setText(r.text)).catch((e) => setText(e.message)); }, []);
  return (
    <Modal title="Help (README)" onClose={onClose} width="max-w-4xl" footer={<Button onClick={onClose}>Close</Button>}>
      <pre className="whitespace-pre-wrap font-[Consolas,ui-monospace,monospace] text-xs leading-relaxed">{text}</pre>
    </Modal>
  );
}

/** Checkbox list of weekdays (shift weekly off). */
export function DayChecks({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {days.map((d) => (
        <Check key={d} label={d} checked={value.includes(d)} onChange={(on) => onChange(on ? [...value, d] : value.filter((x) => x !== d))} />
      ))}
    </div>
  );
}
