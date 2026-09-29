/** Maintenance Timetables / Shifts (with break timing and night shifts). */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../app';
import { DataTable } from '../DataTable';
import { DayChecks } from '../dialogs';
import { Button, Check, Field, Input, Modal, Note, Page } from '../ui';

const NEW = { Id: 0, Name: '', Start: '09:00', End: '18:00', LateGraceMinutes: 10, EarlyGraceMinutes: 10, HalfDayMinutes: 240, MinOvertimeMinutes: 30, WeeklyOffs: 'Sunday',
  BreakMinutes: 0, BreakStart: '', BreakEnd: '', DeductBreak: true };

export function Shifts() {
  const app = useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<number[]>([]);
  const [edit, setEdit] = useState<any | null>(null);

  const load = useCallback(() => api.get('/shifts').then(setRows), []);
  useEffect(() => { app.run(load); }, [load, app.dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = rows.find((r) => r.Id === sel[0]);
  const del = async () => {
    if (!current || !(await app.confirm('Delete this shift? Employees on this shift will have no shift assigned.'))) return;
    if (await app.run(() => api.del(`/shifts/${current.Id}`))) { setSel([]); await load(); app.dataChanged(); }
  };

  const toolbar = (
    <>
      <Button variant="primary" icon="add" onClick={() => setEdit({ ...NEW })}>Add Shift</Button>
      <Button icon="edit" disabled={!current} onClick={() => setEdit({ ...current })}>Edit</Button>
      <Button icon="trash" variant="danger" disabled={!current} onClick={del}>Delete</Button>
      <span className="text-xs text-slate-500">For a night shift, set the End time earlier than the Start time (e.g. 22:00 → 06:00).</span>
    </>
  );

  return (
    <Page title="Shifts" icon="timer" toolbar={toolbar} bodyClass="flex flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <DataTable rows={rows} rowKey={(r) => r.Id} selected={sel} onSelect={(k) => setSel(k as number[])} onDoubleClick={(r) => setEdit({ ...r })}
          columns={[
            { key: 'Name', header: 'Name', render: (r) => <>{r.Name}{r.NightShift && <span className="ml-1.5 rounded bg-indigo-100 px-1 text-[11px] text-indigo-800">night</span>}</> },
            { key: 'Start', header: 'Start' }, { key: 'End', header: 'End' }, { key: 'Hours', header: 'Hours' },
            { key: 'BreakMinutes', header: 'Break', render: (r) => (r.BreakMinutes ? `${r.BreakMinutes} min${r.BreakStart ? ` (${r.BreakStart}-${r.BreakEnd})` : ''}` : '') },
            { key: 'WorkHours', header: 'Work Hrs' },
            { key: 'LateGraceMinutes', header: 'Late Grace (min)', align: 'right' }, { key: 'EarlyGraceMinutes', header: 'Early Grace (min)', align: 'right' },
            { key: 'HalfDayMinutes', header: 'Half Day below (min)', align: 'right' }, { key: 'MinOvertimeMinutes', header: 'Min OT (min)', align: 'right' },
            { key: 'WeeklyOffs', header: 'Weekly Off' }, { key: 'Employees', header: 'Employees', align: 'right' },
          ]} />
      </div>
      {edit && <ShiftDialog shift={edit} onClose={() => setEdit(null)} onSaved={() => { load(); app.dataChanged(); }} />}
    </Page>
  );
}

function ShiftDialog({ shift, onClose, onSaved }: { shift: any; onClose: () => void; onSaved: () => void }) {
  const app = useApp();
  const [f, setF] = useState({ ...shift, WeeklyOffs: String(shift.WeeklyOffs ?? '').split(',').map((s: string) => s.trim()).filter(Boolean) });
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  const save = async () => {
    if (await app.run(() => (f.Id ? api.put(`/shifts/${f.Id}`, f) : api.post('/shifts', f)))) { onSaved(); onClose(); }
  };
  const num = (k: string, label: string, max: number) => (
    <Field label={label}><Input type="number" min={0} max={max} value={f[k]} onChange={(e) => set(k, +e.target.value)} /></Field>
  );
  return (
    <Modal title={f.Id ? 'Edit Shift' : 'Add Shift'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>OK</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Shift name *" className="col-span-2"><Input value={f.Name} onChange={(e) => set('Name', e.target.value)} /></Field>
        <Field label="Start time"><Input type="time" value={f.Start} onChange={(e) => set('Start', e.target.value)} /></Field>
        <Field label="End time"><Input type="time" value={f.End} onChange={(e) => set('End', e.target.value)} /></Field>
        {num('LateGraceMinutes', 'Late grace (min)', 600)}
        {num('EarlyGraceMinutes', 'Early grace (min)', 600)}
        {num('HalfDayMinutes', 'Half day if worked < (min)', 1440)}
        {num('MinOvertimeMinutes', 'OT counted after (min)', 1440)}
        <Field label="Weekly off" className="col-span-2"><DayChecks value={f.WeeklyOffs} onChange={(v) => set('WeeklyOffs', v)} /></Field>
        <fieldset className="col-span-2 grid grid-cols-3 gap-3 rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium text-slate-600">Break</legend>
          {num('BreakMinutes', 'Break allowed (min)', 480)}
          <Field label="Break from (optional)"><Input type="time" value={f.BreakStart} onChange={(e) => set('BreakStart', e.target.value)} /></Field>
          <Field label="Break to"><Input type="time" value={f.BreakEnd} onChange={(e) => set('BreakEnd', e.target.value)} /></Field>
          <div className="col-span-3"><Check label="Break is not working time (deduct it from worked hours)" checked={f.DeductBreak} onChange={(v) => set('DeductBreak', v)} /></div>
        </fieldset>
      </div>
      <div className="mt-3"><Note>{"Late = arrived after shift start + grace. OT = work beyond the shift hours, when the extra time exceeds 'OT counted after'.\n" +
        'Break: with 4 punches (in, out for break, back, out) the real break is used and a longer break than allowed is shown in the remark; ' +
        'with 2 punches the allowed break is deducted when the day covers the break time. Rotating shifts: Shift Roster.'}</Note></div>
    </Modal>
  );
}
