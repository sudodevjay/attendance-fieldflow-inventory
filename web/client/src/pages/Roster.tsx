/** Shift Roster: rotating shifts — a month grid of employees × days, single-day changes and a rotation generator. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, isoDate, qs } from '../api';
import { useApp } from '../app';
import { DayChecks } from '../dialogs';
import { Button, Check, Field, Input, Modal, Note, Page, Select } from '../ui';

interface Cell { value: string; planned: boolean; text: string }
interface Row { Id: number; EnrollNo: string; Name: string; Department: string; cells: Cell[] }
interface Grid { days: { date: string; label: string; day: string }[]; rows: Row[]; shifts: { Id: number; Name: string; Short: string }[] }

const lastDay = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};
const COLORS = ['bg-sky-100 text-sky-800', 'bg-amber-100 text-amber-800', 'bg-indigo-100 text-indigo-800', 'bg-teal-100 text-teal-800', 'bg-rose-100 text-rose-800', 'bg-lime-100 text-lime-800'];

export function Roster() {
  const app = useApp();
  const [month, setMonth] = useState(isoDate().slice(0, 7));
  const [dept, setDept] = useState('');
  const [depts, setDepts] = useState<any[]>([]);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<number[]>([]);
  const [rotate, setRotate] = useState(false);

  useEffect(() => { api.get('/departments').then((r) => setDepts([...r.departments].sort((a: any, b: any) => a.Name.localeCompare(b.Name)))); }, []);
  const from = `${month}-01`, to = lastDay(month);
  const load = useCallback(() => api.get<Grid>('/roster' + qs({ from, to, dept })).then((g) => { setGrid(g); setChanges({}); }), [from, to, dept]);
  useEffect(() => { app.run(load); }, [load, app.dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const color = useMemo(() => new Map((grid?.shifts ?? []).map((s, i) => [String(s.Id), COLORS[i % COLORS.length]])), [grid]);
  const dirty = Object.keys(changes).length;

  const save = async () => {
    const cells = Object.entries(changes).map(([k, value]) => {
      const [employeeId, date] = k.split('|');
      return { employeeId: +employeeId, date, value };
    });
    const r = await app.run(() => api.post('/roster', { cells }));
    if (r) { await load(); app.dataChanged(); }
  };
  const clear = async () => {
    if (!sel.length) return app.alert('Tick the employees first.');
    if (!(await app.confirm(`Remove the roster of ${sel.length} employee(s) for ${month}? They go back to their own shift.`))) return;
    const r = await app.run(() => api.post('/roster/clear', { ids: sel, from, to }));
    if (r) { await load(); app.dataChanged(); await app.alert(r.message); }
  };
  const leave = async () => !dirty || (await app.confirm('Discard the unsaved roster changes?'));

  const toolbar = (
    <>
      <label className="flex items-center gap-1.5">Month
        <Input type="month" value={month} className="w-40" onChange={async (e) => { if (await leave()) setMonth(e.target.value); }} />
      </label>
      <label className="flex items-center gap-1.5">Department
        <Select value={dept} className="w-48" onChange={async (e) => { const v = e.target.value; if (await leave()) setDept(v); }}>
          <option value="">All departments</option>
          {depts.map((d) => <option key={d.Id} value={d.Id}>{d.Name}</option>)}
        </Select>
      </label>
      <Button variant="primary" icon="save" disabled={!dirty} onClick={save}>Save{dirty ? ` (${dirty})` : ''}</Button>
      <Button icon="sync" onClick={() => (sel.length ? setRotate(true) : app.alert('Tick the employees for the rotation first.'))}>Rotation…</Button>
      <Button icon="trash" variant="danger" onClick={clear}>Clear month</Button>
    </>
  );

  return (
    <Page title="Shift Roster (rotating shifts)" icon="calendar" toolbar={toolbar} bodyClass="flex flex-col gap-2">
      <Note>
        {'Each cell is the shift of that day. Coloured = planned in the roster; grey = the employee\'s own shift (WO = its weekly off). ' +
          'Choose OFF for a day off, or "(own shift)" to remove the plan. Night shifts count on the day they start.'}
      </Note>
      {grid && (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm scroll-thin">
          <table className="border-collapse text-[12px]">
            <thead className="sticky top-0 z-10 bg-slate-100">
              <tr>
                <th className="sticky left-0 z-20 min-w-52 border-b border-r border-slate-200 bg-slate-100 px-2 py-1 text-left">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="accent-brand-600" checked={!!grid.rows.length && sel.length === grid.rows.length}
                      onChange={(e) => setSel(e.target.checked ? grid.rows.map((r) => r.Id) : [])} />Employee
                  </label>
                </th>
                {grid.days.map((d) => (
                  <th key={d.date} className={`min-w-14 border-b border-r border-slate-200 px-1 py-1 text-center font-medium ${d.day === 'Sun' ? 'text-red-600' : ''}`}>
                    {d.label}<div className="text-[10px] font-normal text-slate-500">{d.day}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((r) => (
                <tr key={r.Id} className="hover:bg-brand-50/40">
                  <td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-2 py-1 whitespace-nowrap">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" className="accent-brand-600" checked={sel.includes(r.Id)}
                        onChange={(e) => setSel((s) => (e.target.checked ? [...s, r.Id] : s.filter((x) => x !== r.Id)))} />
                      <span className="text-slate-400">{r.EnrollNo}</span> {r.Name}
                    </label>
                  </td>
                  {r.cells.map((c, i) => {
                    const key = `${r.Id}|${grid.days[i].date}`;
                    const v = changes[key] ?? c.value;
                    const changed = key in changes;
                    const cls = v === 'OFF' ? 'bg-zinc-200 text-zinc-700' : v ? color.get(v) ?? '' : 'bg-white text-slate-400';
                    return (
                      <td key={key} className={`border-b border-r border-slate-100 p-0 ${changed ? 'outline outline-2 -outline-offset-2 outline-amber-400' : ''}`}>
                        <select aria-label={`${r.Name} ${grid.days[i].date}`} value={v} title={c.planned || changed ? '' : `Own shift: ${c.text}`}
                          onChange={(e) => setChanges((x) => {
                            const n = { ...x };
                            if (e.target.value === c.value) delete n[key]; else n[key] = e.target.value;
                            return n;
                          })}
                          className={`h-7 w-full cursor-pointer appearance-none px-1 text-center text-[11px] font-semibold outline-none ${cls}`}>
                          <option value="">{v === '' ? c.text || '—' : '(own shift)'}</option>
                          <option value="OFF">OFF</option>
                          {grid.shifts.map((s) => <option key={s.Id} value={String(s.Id)}>{s.Short} – {s.Name}</option>)}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!grid.rows.length && <tr><td colSpan={grid.days.length + 1} className="px-3 py-8 text-center text-slate-400">No active employees.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {grid && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          {grid.shifts.map((s) => <span key={s.Id} className={`rounded px-1.5 py-0.5 font-semibold ${color.get(String(s.Id))}`}>{s.Short} = {s.Name}</span>)}
          <span className="rounded bg-zinc-200 px-1.5 py-0.5 font-semibold text-zinc-700">OFF = day off</span>
        </div>
      )}
      {rotate && grid && <RotationDialog ids={sel} shifts={grid.shifts} from={from} onClose={() => setRotate(false)} onDone={() => { load(); app.dataChanged(); }} />}
    </Page>
  );
}

function RotationDialog({ ids, shifts, from, onClose, onDone }: { ids: number[]; shifts: Grid['shifts']; from: string; onClose: () => void; onDone: () => void }) {
  const app = useApp();
  const [pattern, setPattern] = useState<string[]>(shifts.slice(0, 2).map((s) => String(s.Id)));
  const [f, setF] = useState({ from, to: lastDay(from.slice(0, 7)), everyDays: 7, offDays: ['Sunday'] as string[], stagger: false });
  const go = async () => {
    const r = await app.run(() => api.post('/roster/rotate', { employeeIds: ids, pattern, ...f }));
    if (r) { onDone(); onClose(); await app.alert(r.message); }
  };
  return (
    <Modal title={`Rotation for ${ids.length} employee(s)`} onClose={onClose} width="max-w-xl"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={go} disabled={!pattern.length}>Generate</Button></>}>
      <div className="space-y-3">
        <Field label="Shifts in order">
          <div className="space-y-1.5">
            {pattern.map((p, i) => (
              <div key={i} className="flex gap-2">
                <span className="w-6 pt-1.5 text-right text-xs text-slate-500">{i + 1}.</span>
                <Select value={p} onChange={(e) => setPattern((x) => x.map((y, j) => (j === i ? e.target.value : y)))}>
                  <option value="OFF">OFF (days off)</option>
                  {shifts.map((s) => <option key={s.Id} value={String(s.Id)}>{s.Name}</option>)}
                </Select>
                <Button icon="close" aria-label="Remove" onClick={() => setPattern((x) => x.filter((_, j) => j !== i))} />
              </div>
            ))}
            <Button icon="add" onClick={() => setPattern((x) => [...x, String(shifts[0]?.Id ?? 'OFF')])}>Add step</Button>
          </div>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="From"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="To"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          <Field label="Change every (days)"><Input type="number" min={1} max={31} value={f.everyDays} onChange={(e) => setF({ ...f, everyDays: +e.target.value })} /></Field>
        </div>
        <Field label="Weekly days off (in every week)"><DayChecks value={f.offDays} onChange={(v) => setF({ ...f, offDays: v })} /></Field>
        <Check label="Stagger: each next employee starts one step later (the team covers every shift)" checked={f.stagger} onChange={(v) => setF({ ...f, stagger: v })} />
        <Note>Example: Morning → Evening → Night, every 7 days = one week on each shift. Existing roster days in the period are replaced.</Note>
      </div>
    </Modal>
  );
}
