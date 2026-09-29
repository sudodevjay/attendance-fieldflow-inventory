/** AC Log: raw punches with the employee photo, newest first. Opens on today; while today is shown it refreshes every 30 s. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, isoDate, qs } from '../api';
import { useApp } from '../app';
import { DataTable } from '../DataTable';
import { Button, Check, Field, Icon, Input, Modal, Page, Select } from '../ui';

const REFRESH = 30;

export function AcLog() {
  const app = useApp();
  const [params, setParams] = useSearchParams();
  const today = isoDate();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [emp, setEmp] = useState('');
  const [emps, setEmps] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState('');
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<number[]>([]);
  const [live, setLive] = useState(true);
  const [updated, setUpdated] = useState('');
  const [manual, setManual] = useState(params.get('manual') === '1');
  const shown = useRef('');
  const [reload, setReload] = useState(0);

  useEffect(() => { api.get('/employees/options').then(setEmps); }, [app.dataVersion]);

  const load = useCallback(async (force: boolean) => {
    const r = await api.get('/logs' + qs({ from, to, emp }));
    const state = `${r.lastId}|${r.rows.length}`;
    setSummary(r.summary);
    setUpdated(new Date().toLocaleTimeString('en-GB'));
    if (!force && state === shown.current) return;
    shown.current = state;
    setRows(r.rows);
    const missing = [...new Set<string>(r.rows.map((x: any) => x.EnrollNo))].filter((n) => !(n in photos));
    if (missing.length) {
      const p = await api.post('/employees/photos', { enrollNos: missing });
      setPhotos((old) => ({ ...old, ...Object.fromEntries(missing.map((n) => [n, p[n] ?? ''])) }));
    }
  }, [from, to, emp, photos]);

  useEffect(() => { app.run(() => load(true)); }, [app.dataVersion, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const showsToday = from <= today && to >= today;
  useEffect(() => {
    if (!live || !showsToday) return;
    const t = setInterval(() => { load(false).catch(() => {}); }, REFRESH * 1000);
    return () => clearInterval(t);
  }, [live, showsToday, load]);

  const del = async () => {
    if (!sel.length) return app.alert('Select punches first.');
    if (!(await app.confirm(`Delete ${sel.length} punch(es)?`))) return;
    if (await app.run(() => api.post('/logs/delete', { ids: sel }))) { setSel([]); await load(true); app.dataChanged(); }
  };

  const toolbar = (
    <>
      <label className="flex items-center gap-1.5">From <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" /></label>
      <label className="flex items-center gap-1.5">To <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" /></label>
      <Select value={emp} onChange={(e) => setEmp(e.target.value)} className="w-56" aria-label="Employee">
        <option value="">All employees</option>
        {emps.map((e) => <option key={e.Id} value={e.Id}>{e.EnrollNo} - {e.Name}</option>)}
      </Select>
      <Button variant="primary" icon="search" onClick={() => setReload((x) => x + 1)}>Show</Button>
      <Button onClick={() => { setFrom(today); setTo(today); setReload((x) => x + 1); }}>Today</Button>
      <Button icon="add" onClick={() => setManual(true)}>Manual Punch</Button>
      <Button icon="trash" variant="danger" onClick={del}>Delete</Button>
      <Button icon="export" onClick={() => app.run(() => api.download('/logs/export' + qs({ from, to, emp })))}>Excel</Button>
      <Check label={`Live (every ${REFRESH} sec)`} checked={live} onChange={setLive} />
      <span className="text-xs text-slate-500">
        {rows.length} punches{summary && `   |   ${summary}`}{showsToday && live && updated && `   |   Updated ${updated}`}
      </span>
    </>
  );

  return (
    <Page title="Attendance Logs (Raw Punches)" icon="clock" toolbar={toolbar} bodyClass="flex flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <DataTable rows={rows} rowKey={(r) => r.Id} selected={sel} onSelect={(k) => setSel(k as number[])} empty="No punches in this period."
          columns={[
            { key: 'Date', header: 'Date', value: (r) => r.Id }, { key: 'Time', header: 'Time' }, { key: 'EnrollNo', header: 'Emp ID' },
            { key: 'Name', header: 'Name' },
            { key: 'InOut', header: 'IN / OUT', align: 'center', render: (r) => <span className={`font-semibold ${r.InOut === 'IN' ? 'text-green-600' : 'text-amber-600'}`}>{r.InOut}</span> },
            {
              key: 'Photo', header: 'Photo', sortable: false, align: 'center',
              render: (r) => photos[r.EnrollNo]
                ? <img src={`data:image/jpeg;base64,${photos[r.EnrollNo]}`} alt="" className="mx-auto h-20 w-20 rounded object-cover" />
                : <span className="mx-auto grid h-20 w-20 place-items-center rounded bg-slate-50"><Icon name="person" className="size-10 text-slate-300" /></span>,
            },
            { key: 'Verify', header: 'Verify' }, { key: 'Source', header: 'Source' }, { key: 'Remark', header: 'Remark' },
          ]} />
      </div>
      {manual && <ManualPunch emps={emps.filter((e) => e.IsActive)} initial={emp} onClose={() => { setManual(false); if (params.get('manual')) setParams({}); }}
        onSaved={() => { load(true); app.dataChanged(); }} />}
    </Page>
  );
}

function ManualPunch({ emps, initial, onClose, onSaved }: { emps: any[]; initial: string; onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const [f, setF] = useState({ employeeId: initial || String(emps[0]?.Id ?? ''), time: `${isoDate()}T09:00`, checkOut: false, remark: 'Forgot to punch' });
  const save = async () => {
    if (!f.employeeId) return app.alert('Select an employee.');
    if (await app.run(() => api.post('/logs/manual', { ...f, employeeId: +f.employeeId, time: f.time.replace('T', ' ') + ':00' }))) { onSaved(); onClose(); }
  };
  return (
    <Modal title="Manual Punch" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>OK</Button></>}>
      <div className="space-y-3">
        <Field label="Employee">
          <Select value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
            {emps.map((e) => <option key={e.Id} value={e.Id}>{e.EnrollNo} - {e.Name}</option>)}
          </Select>
        </Field>
        <Field label="Punch time"><Input type="datetime-local" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
        <Field label="Type">
          <Select value={f.checkOut ? '1' : '0'} onChange={(e) => setF({ ...f, checkOut: e.target.value === '1' })}><option value="0">Check-In</option><option value="1">Check-Out</option></Select>
        </Field>
        <Field label="Reason"><Input value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
