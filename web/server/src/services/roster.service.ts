/**
 * Shift roster (rotating shifts): a month grid of employees × days with the shift (or day off) of each day, single-day
 * changes, and a rotation generator (e.g. Morning → Evening → Night, changing every 7 days).
 */
import { exec, query, transaction } from '../config/db';
import { byEnroll, isWeeklyOff, loadRoster, loadShifts, rosterKey } from '../models';
import { UserError } from '../utils/errors';
import { addDays, dayOfWeek, fmt, mustParse, sqlD, type DT } from '../utils/time';
import { withChildren } from './department.service';

const OFF = 'OFF';

/** Grid of [from, to] (max 62 days): per employee and day the planned shift, or its own shift when nothing is planned. */
export async function grid(from: DT, to: DT, departmentId: number | null) {
  if (to < from) throw new UserError("The 'To' date is before the 'From' date.");
  if ((to - from) / 86_400_000 > 62) throw new UserError('The roster shows at most 62 days at a time.');
  const ids = departmentId ? await withChildren(departmentId) : null;
  const emps = (await query(`SELECT e.Id, e.EnrollNo, e.Name, e.ShiftId, e.DepartmentId, d.Name Department FROM Employees e
      LEFT JOIN Departments d ON d.Id = e.DepartmentId WHERE e.IsActive = 1`))
    .filter((r) => !ids || (r.DepartmentId !== null && ids.includes(r.DepartmentId))).sort(byEnroll);
  const shifts = await loadShifts();
  const byId = new Map(shifts.map((s) => [s.Id, s]));
  const roster = await loadRoster(from, to, emps.map((e) => e.Id));
  const days: { date: string; label: string; day: string }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push({ date: sqlD(d), label: fmt(d, 'dd'), day: fmt(d, 'ddd') });

  const rows = emps.map((e) => ({
    Id: e.Id, EnrollNo: e.EnrollNo, Name: e.Name, Department: e.Department ?? '', DefaultShiftId: e.ShiftId,
    cells: days.map(({ date }) => {
      const d = mustParse(date);
      const r = roster.get(rosterKey(e.Id, d));
      const own = e.ShiftId ? byId.get(e.ShiftId) : undefined;
      if (r?.IsOff) return { value: OFF, planned: true, text: 'OFF' };
      if (r?.ShiftId && byId.has(r.ShiftId)) return { value: String(r.ShiftId), planned: true, text: short(byId.get(r.ShiftId)!.Name) };
      if (own && isWeeklyOff(own, dayOfWeek(d))) return { value: '', planned: false, text: 'WO' };
      return { value: '', planned: false, text: own ? short(own.Name) : '' };
    }),
  }));
  return { days, rows, shifts: shifts.map((s) => ({ Id: s.Id, Name: s.Name, Short: short(s.Name) })) };
}

const short = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 3) || name.slice(0, 3);

export interface RosterCell { employeeId: number; date: string; value: string }

/** Sets cells: value = shift id, 'OFF' (day off) or '' (back to the employee's own shift). */
export async function setCells(cells: RosterCell[]) {
  if (!cells.length) throw new UserError('Nothing to save.');
  if (cells.length > 5000) throw new UserError('Too many changes at once (max 5000).');
  const shiftIds = new Set((await loadShifts()).map((s) => s.Id));
  await transaction(async (tx) => {
    for (const c of cells) {
      const d = sqlD(mustParse(c.date));
      const off = c.value === OFF;
      const shift = off || c.value === '' ? null : Number(c.value);
      if (shift !== null && !shiftIds.has(shift)) throw new UserError('Unknown shift.');
      if (!off && shift === null) await exec('DELETE FROM ShiftRoster WHERE EmployeeId = @e AND [Date] = @d', { e: c.employeeId, d }, tx);
      else await exec(`MERGE ShiftRoster AS t USING (SELECT @e EmployeeId, CONVERT(date, @d) [Date]) AS s
          ON t.EmployeeId = s.EmployeeId AND t.[Date] = s.[Date]
        WHEN MATCHED THEN UPDATE SET ShiftId = @s, IsOff = @off
        WHEN NOT MATCHED THEN INSERT (EmployeeId, [Date], ShiftId, IsOff) VALUES (@e, CONVERT(date, @d), @s, @off);`,
      { e: c.employeeId, d, s: shift, off }, tx);
    }
  });
  return `${cells.length} roster day(s) saved.`;
}

export interface RotationInput {
  employeeIds?: unknown; pattern?: unknown; from?: unknown; to?: unknown; everyDays?: unknown; offDays?: unknown; stagger?: unknown;
}

/**
 * Fills the roster from a rotation: `pattern` = list of shift ids (or 'OFF') used one after another, each for `everyDays`
 * days. `offDays` (day names) are days off in every week. `stagger` starts each next employee one step later in the
 * pattern, so a team covers all shifts at once.
 */
export async function rotate(b: RotationInput) {
  const ids = (Array.isArray(b.employeeIds) ? b.employeeIds : []).map(Number).filter(Number.isInteger);
  if (!ids.length) throw new UserError('Select employees first.');
  const pattern = (Array.isArray(b.pattern) ? b.pattern : []).map(String).filter(Boolean);
  if (!pattern.length) throw new UserError('Choose the shifts of the rotation.');
  const from = mustParse(String(b.from)), to = mustParse(String(b.to));
  if (to < from) throw new UserError("The 'To' date is before the 'From' date.");
  if ((to - from) / 86_400_000 > 366) throw new UserError('A rotation can be generated for at most one year at a time.');
  const every = Number(b.everyDays ?? 7);
  if (!Number.isInteger(every) || every < 1 || every > 31) throw new UserError('Change the shift every 1 to 31 days.');
  const offDays = (Array.isArray(b.offDays) ? b.offDays : []).map(String);

  const cells: RosterCell[] = [];
  ids.forEach((employeeId, i) => {
    const offset = b.stagger ? i : 0;
    for (let d = from, n = 0; d <= to; d = addDays(d, 1), n++) {
      const value = offDays.includes(dayOfWeek(d)) ? OFF : pattern[(Math.floor(n / every) + offset) % pattern.length];
      cells.push({ employeeId, date: sqlD(d), value });
    }
  });
  for (let i = 0; i < cells.length; i += 5000) await setCells(cells.slice(i, i + 5000));
  return `Rotation saved for ${ids.length} employee(s), ${fmt(from, 'dd MMM')} – ${fmt(to, 'dd MMM yyyy')}.`;
}

/** Removes the plan of these employees in [from, to] (they go back to their own shift). */
export async function clear(employeeIds: number[], from: DT, to: DT) {
  if (!employeeIds.length) throw new UserError('Select employees first.');
  const n = await exec(`DELETE FROM ShiftRoster WHERE EmployeeId IN (SELECT value FROM OPENJSON(@ids)) AND [Date] >= @f AND [Date] <= @t`,
    { ids: employeeIds, f: sqlD(from), t: sqlD(to) });
  return `${n} roster day(s) removed.`;
}
