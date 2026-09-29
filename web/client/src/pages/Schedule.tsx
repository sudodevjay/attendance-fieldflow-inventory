/** Employee Schedule: assign a shift (timetable) to many employees at once. */
import { useCallback, useEffect, useState } from 'react';
import { api, qs } from '../api';
import { useApp } from '../app';
import { DataTable } from '../DataTable';
import { Button, Page, Select } from '../ui';

export function Schedule() {
  const app = useApp();
  const [depts, setDepts] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [dept, setDept] = useState('');
  const [shift, setShift] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<number[]>([]);

  useEffect(() => {
    api.get('/departments').then((r) => setDepts([...r.departments].sort((a: any, b: any) => a.Name.localeCompare(b.Name))));
    api.get('/shifts').then((s) => { setShifts(s); setShift((v) => v || String(s[0]?.Id ?? '')); });
  }, [app.dataVersion]);
  const load = useCallback(() => api.get('/schedule' + qs({ dept })).then(setRows), [dept]);
  useEffect(() => { app.run(load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const assign = async () => {
    if (!sel.length) return app.alert('Select employees first.');
    const r = await app.run(() => api.post('/schedule', { ids: sel, shiftId: shift ? +shift : null }));
    if (r) { await load(); app.dataChanged(); await app.alert(r.message); }
  };

  const toolbar = (
    <>
      <label className="flex items-center gap-1.5">Department:
        <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-48">
          <option value="">All departments</option>
          {depts.map((d) => <option key={d.Id} value={d.Id}>{d.Name}</option>)}
        </Select>
      </label>
      <label className="flex items-center gap-1.5">Shift:
        <Select value={shift} onChange={(e) => setShift(e.target.value)} className="w-56">
          <option value="">(none)</option>
          {shifts.map((s) => <option key={s.Id} value={s.Id}>{s.Label}</option>)}
        </Select>
      </label>
      <Button variant="success" icon="check" onClick={assign}>Assign</Button>
      <Button icon="table" onClick={() => setSel(rows.map((r) => r.Id))}>Select All</Button>
      <span className="text-xs text-slate-500">Select employees (Ctrl / Shift for multiple), choose a shift and click 'Assign'.</span>
    </>
  );

  return (
    <Page title="Employee Schedule" icon="table" toolbar={toolbar} bodyClass="flex flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <DataTable rows={rows} rowKey={(r) => r.Id} selected={sel} onSelect={(k) => setSel(k as number[])}
          columns={[{ key: 'EnrollNo', header: 'AC No' }, { key: 'Name', header: 'Name' }, { key: 'Department', header: 'Department' },
            { key: 'Shift', header: 'Shift' }, { key: 'WeeklyOff', header: 'Weekly Off' }]} />
      </div>
    </Page>
  );
}
