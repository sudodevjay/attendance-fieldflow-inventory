/** Maintenance Timetables (shifts) and Employee Schedule (bulk shift assignment). */
import { exec, one, query, transaction, type Tx } from '../config/db';
import { inScope } from '../utils/scope';
import type * as MSSQL from 'mssql';
import { byEnroll, crossesMidnight, durationMinutes, hhmm, loadShifts, shiftLabel, workMinutes } from '../models';
import { UserError } from '../utils/errors';
import { withChildren } from './department.service';

export async function list() {
  const counts = new Map((await query('SELECT ShiftId, COUNT(*) c FROM Employees GROUP BY ShiftId')).map((r) => [r.ShiftId, r.c]));
  const shifts = (await loadShifts()).sort((a, b) => a.Name.localeCompare(b.Name));
  return shifts.map((s) => ({
    Id: s.Id, Name: s.Name, Start: hhmm(s.start), End: hhmm(s.end), Hours: hhmm(durationMinutes(s)), LateGraceMinutes: s.LateGraceMinutes,
    EarlyGraceMinutes: s.EarlyGraceMinutes, HalfDayMinutes: s.HalfDayMinutes, MinOvertimeMinutes: s.MinOvertimeMinutes,
    WeeklyOffs: s.WeeklyOffs, Employees: counts.get(s.Id) ?? 0, Label: shiftLabel(s), BreakMinutes: s.BreakMinutes,
    BreakStart: s.breakStart !== null ? hhmm(s.breakStart) : '', BreakEnd: s.breakEnd !== null ? hhmm(s.breakEnd) : '', DeductBreak: s.DeductBreak,
    WorkHours: hhmm(workMinutes(s)), NightShift: crossesMidnight(s),
  }));
}

export interface ShiftInput {
  Name?: unknown; Start?: unknown; End?: unknown; LateGraceMinutes?: unknown; EarlyGraceMinutes?: unknown;
  HalfDayMinutes?: unknown; MinOvertimeMinutes?: unknown; WeeklyOffs?: unknown;
  BreakMinutes?: unknown; BreakStart?: unknown; BreakEnd?: unknown; DeductBreak?: unknown;
}

function params(b: ShiftInput) {
  const name = String(b.Name ?? '').trim();
  if (!name) throw new UserError('Shift name is required.');
  const time = (v: unknown, what: string) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? ''));
    if (!m || +m[1] > 23 || +m[2] > 59) throw new UserError(`${what} must be HH:mm.`);
    return `${m[1].padStart(2, '0')}:${m[2]}:00`;
  };
  const int = (v: unknown, max: number, what: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > max) throw new UserError(`${what} must be 0 to ${max}.`);
    return n;
  };
  return {
    n: name.slice(0, 100), s: time(b.Start, 'Start time'), e: time(b.End, 'End time'),
    lg: int(b.LateGraceMinutes, 600, 'Late grace'), eg: int(b.EarlyGraceMinutes, 600, 'Early grace'),
    hd: int(b.HalfDayMinutes, 1440, 'Half day'), ot: int(b.MinOvertimeMinutes, 1440, 'OT counted after'),
    wo: (Array.isArray(b.WeeklyOffs) ? b.WeeklyOffs.join(',') : String(b.WeeklyOffs ?? '')).slice(0, 100),
  };
}

/** Break of the shift (ShiftExtras): minutes allowed, optional window (both or none), deducted from worked time or not. */
function breakParams(b: ShiftInput) {
  const minutes = Number(b.BreakMinutes ?? 0);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 480) throw new UserError('Break must be 0 to 480 minutes.');
  const t = (v: unknown, what: string) => {
    const s = String(v ?? '').trim();
    if (!s) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m || +m[1] > 23 || +m[2] > 59) throw new UserError(`${what} must be HH:mm.`);
    return `${m[1].padStart(2, '0')}:${m[2]}:00`;
  };
  const bs = t(b.BreakStart, 'Break start'), be = t(b.BreakEnd, 'Break end');
  if ((bs === null) !== (be === null)) throw new UserError('Enter both break start and break end, or neither.');
  return { bm: minutes, bs, be, db: b.DeductBreak !== false };
}

async function saveBreak(id: number, b: ShiftInput, tx: Tx) {
  await exec(`INSERT INTO ShiftExtras (ShiftId, BreakMinutes, BreakStart, BreakEnd, DeductBreak)
      VALUES (@id, @bm, CAST(@bs AS time), CAST(@be AS time), @db)
    ON CONFLICT (ShiftId) DO UPDATE SET BreakMinutes = EXCLUDED.BreakMinutes, BreakStart = EXCLUDED.BreakStart,
      BreakEnd = EXCLUDED.BreakEnd, DeductBreak = EXCLUDED.DeductBreak`, { id, ...breakParams(b) }, tx);
}

export async function create(b: ShiftInput) {
  const p = params(b);
  breakParams(b);
  return transaction(async (tx) => {
    const r = await one(`INSERT INTO Shifts (Name, StartTime, EndTime, LateGraceMinutes, EarlyGraceMinutes, HalfDayMinutes, MinOvertimeMinutes, WeeklyOffs)
      VALUES (@n, CAST(@s AS time), CAST(@e AS time), @lg, @eg, @hd, @ot, @wo) RETURNING Id`, p, tx);
    await saveBreak(r!.Id, b, tx);
    return r!.Id as number;
  });
}

export async function update(id: number, b: ShiftInput) {
  const p = params(b);
  breakParams(b);
  await transaction(async (tx) => {
    await exec(`UPDATE Shifts SET Name = @n, StartTime = CAST(@s AS time), EndTime = CAST(@e AS time), LateGraceMinutes = @lg,
      EarlyGraceMinutes = @eg, HalfDayMinutes = @hd, MinOvertimeMinutes = @ot, WeeklyOffs = @wo WHERE Id = @id`, { ...p, id }, tx);
    await saveBreak(id, b, tx);
  });
}

/** Employees on a deleted shift are left without one; roster days on it are removed. */
export async function remove(id: number) {
  await exec(`UPDATE Employees SET ShiftId = NULL WHERE ShiftId = @id; DELETE FROM ShiftRoster WHERE ShiftId = @id;
    DELETE FROM ShiftExtras WHERE ShiftId = @id; DELETE FROM Shifts WHERE Id = @id`, { id });
}

/** Employee Schedule grid: active employees (of a department and its sub-departments) with their shift. */
export async function schedule(departmentId: number | null) {
  const ids = departmentId ? await withChildren(departmentId) : null;
  const shifts = new Map((await loadShifts()).map((s) => [s.Id, s]));
  const rows = await query(`SELECT e.Id, e.EnrollNo, e.Name, d.Name Department, e.ShiftId, e.DepartmentId FROM Employees e
    LEFT JOIN Departments d ON d.Id = e.DepartmentId WHERE e.IsActive = TRUE`);
  return rows.filter((r) => inScope(r.Id) && (!ids || (r.DepartmentId !== null && ids.includes(r.DepartmentId)))).sort(byEnroll).map((r) => {
    const s = r.ShiftId ? shifts.get(r.ShiftId) : undefined;
    return { Id: r.Id, EnrollNo: r.EnrollNo, Name: r.Name, Department: r.Department, Shift: s ? shiftLabel(s) : '', WeeklyOff: s?.WeeklyOffs ?? '' };
  });
}

export async function assign(employeeIds: number[], shiftId: number | null) {
  if (!employeeIds.length) throw new UserError('Select employees first.');
  await exec('UPDATE Employees SET ShiftId = @s WHERE Id = ANY(@ids)', { s: shiftId, ids: employeeIds });
  return `Shift assigned to ${employeeIds.length} employee(s).`;
}
