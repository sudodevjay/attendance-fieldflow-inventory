/**
 * Raw punches -> daily attendance, the same rules as AttendanceProcessor.cs in the Windows program:
 * first punch in the shift window = IN, last punch = OUT; late / early / overtime / half day from the shift; holidays,
 * weekly offs and approved leave (with yearly quota) decide the status of days without punches.
 * Web additions: the shift roster (rotating shifts: a shift or a day off per date overrides the employee's shift) and the
 * shift break (break taken from the punches in between, or the fixed break; not working time when "deduct" is set).
 */
import { query } from '../config/db';
import {
  crossesMidnight, FALLBACK_SHIFT, isWeeklyOff, loadEmployees, loadHolidays, loadLeaveTypes, loadRoster, loadShifts,
  LEAVE_COLUMNS, rosterKey, toLeave, workMinutes, type Employee, type LeaveEntry, type Shift,
} from '../models';
import { loadAttendanceRules } from './settings.service';
import { addDays, dateOf, DAY, dayOfWeek, make, MINUTE, parse, sqlDT, today, year, type DT } from '../utils/time';

export const Status = { Present: 'P', Absent: 'A', HalfDay: 'HD', Holiday: 'H', WeeklyOff: 'WO', NotJoined: '-' } as const;

export interface DayRecord {
  EmployeeId: number;
  EnrollNo: string;
  Name: string;
  Department: string;
  ShiftName: string;
  Date: DT;
  In: DT | null;
  Out: DT | null;
  PunchCount: number;
  Punches: DT[];
  WorkedMinutes: number;
  LateMinutes: number;
  EarlyMinutes: number;
  OvertimeMinutes: number;
  /** Break taken (punches in between) or the fixed break deducted. */
  BreakMinutes: number;
  /** P, A, HD, H, WO, "-", "" (future) or a leave code (CL, SL, ½CL ...). */
  Status: string;
  IsLeave: boolean;
  IsPaidLeave: boolean;
  LeaveDays: number;
  PaidLeaveDays: number;
  PendingLeaveDays: number;
  Remark: string;
}

export const presentValue = (d: DayRecord) => (d.Status === Status.Present ? 1 : d.Status === Status.HalfDay ? 0.5 : 0);

export interface MonthlySummary {
  EmployeeId: number;
  EnrollNo: string;
  Name: string;
  Department: string;
  Present: number;
  Absent: number;
  Leave: number;
  PaidLeave: number;
  PendingLeave: number;
  Holidays: number;
  WeeklyOffs: number;
  LateCount: number;
  LateMinutes: number;
  EarlyCount: number;
  WorkedMinutes: number;
  OvertimeMinutes: number;
  PaidDays: number;
}

const join = (a: string, b: string) => (!a ? b : !b ? a : `${a}; ${b}`);
/** .NET "0.#" */
export const n1 = (v: number) => String(Math.round(v * 10) / 10);
const minutesBetween = (a: DT, b: DT) => Math.trunc((b - a) / MINUTE);

export interface ProcessContext {
  employees: Employee[];
  shifts: Map<number, Shift>;
}

export async function process(from: DT, to: DT, departmentId?: number | null, employeeId?: number | null) {
  from = dateOf(from);
  to = dateOf(to);
  const rules = await loadAttendanceRules();
  const employees = await loadEmployees({ departmentId, employeeId });
  const shifts = new Map((await loadShifts()).map((s) => [s.Id, s]));
  const types = new Map((await loadLeaveTypes()).map((t) => [t.Id, t]));
  const roster = await loadRoster(from, to, employees.map((e) => e.Id));

  // Wide range so night shifts and early punches are covered.
  const logs = new Map<string, DT[]>();
  if (employees.length) {
    const rows = await query<{ EnrollNo: string; t: string }>(
      `SELECT a.EnrollNo, CONVERT(varchar(19), a.PunchTime, 120) t FROM AttendanceLogs a
       WHERE a.PunchTime >= CONVERT(datetime2, @f, 120) AND a.PunchTime < CONVERT(datetime2, @t, 120)
         AND a.EnrollNo IN (SELECT value FROM OPENJSON(@ids))`,
      { f: sqlDT(addDays(from, -1)), t: sqlDT(addDays(to, 2)), ids: employees.map((e) => e.EnrollNo) });
    for (const r of rows) {
      const list = logs.get(r.EnrollNo) ?? [];
      list.push(parse(r.t)!);
      logs.set(r.EnrollNo, list);
    }
    for (const l of logs.values()) l.sort((a, b) => a - b);
  }

  // Leave quotas are per calendar year, so leave taken earlier in the year is needed too.
  const yearStart = make(year(from), 1, 1);
  const holidays = await loadHolidays(from, to);
  const quotaHolidays = new Set((await loadHolidays(yearStart, to)).keys());
  const empIds = employees.map((e) => e.Id);
  const leaveRows = empIds.length
    ? await query(`SELECT ${LEAVE_COLUMNS} FROM LeaveEntries l WHERE l.EmployeeId IN (SELECT value FROM OPENJSON(@ids))
        AND l.FromDate <= CONVERT(datetime2, @to, 120) AND l.ToDate >= CONVERT(datetime2, @ys, 120) AND l.Status IN (0, 1)`,
      { ids: empIds, to: sqlDT(to), ys: sqlDT(yearStart) })
    : [];
  const all = leaveRows.map((r) => toLeave(r, types));
  const leaves = all.filter((l) => l.Status === 1);
  const pendingLeaves = all.filter((l) => l.Status === 0 && l.ToDate >= from);

  const result: DayRecord[] = [];
  const now = today();

  for (const emp of employees) {
    const baseShift = (emp.ShiftId && shifts.get(emp.ShiftId)) || FALLBACK_SHIFT;
    const empLogs = logs.get(emp.EnrollNo) ?? [];

    // Days of quota-limited leave, to know how much quota is left on a given date.
    const quotaUse = leaves.filter((l) => l.EmployeeId === emp.Id && (l.type?.YearlyQuota ?? 0) > 0)
      .flatMap((l) => leaveDays(l, baseShift, quotaHolidays).map((x) => ({ typeId: l.LeaveTypeId, date: x.date, days: x.days })));
    const quotaLeft = (l: LeaveEntry, d: DT) => {
      const quota = l.type?.YearlyQuota ?? 0;
      if (quota <= 0) return Number.MAX_VALUE;
      return quota - quotaUse.filter((u) => u.typeId === l.LeaveTypeId && year(u.date) === year(d) && u.date < d)
        .reduce((a, u) => a + u.days, 0);
    };

    for (let d = from; d <= to; d = addDays(d, 1)) {
      const planned = roster.get(rosterKey(emp.Id, d));
      const shift = (planned?.ShiftId && shifts.get(planned.ShiftId)) || baseShift;
      const rec: DayRecord = {
        EmployeeId: emp.Id, EnrollNo: emp.EnrollNo, Name: emp.Name, Department: emp.DepartmentName ?? '', ShiftName: shift.Name,
        Date: d, In: null, Out: null, PunchCount: 0, Punches: [], WorkedMinutes: 0, LateMinutes: 0, EarlyMinutes: 0,
        OvertimeMinutes: 0, BreakMinutes: 0, Status: Status.Absent, IsLeave: false, IsPaidLeave: false, LeaveDays: 0, PaidLeaveDays: 0,
        PendingLeaveDays: 0, Remark: '',
      };
      result.push(rec);

      if (emp.JoinDate !== null && d < dateOf(emp.JoinDate)) { rec.Status = Status.NotJoined; continue; }

      const shiftStart = d + shift.start * MINUTE;
      const shiftEnd = d + shift.end * MINUTE + (crossesMidnight(shift) ? DAY : 0);
      const windowStart = shiftStart - rules.windowBeforeHours * 60 * MINUTE;
      const windowEnd = windowStart + DAY;

      rec.Punches = removeRepeats(empLogs.filter((t) => t >= windowStart && t < windowEnd), rules.duplicateMinutes);
      rec.PunchCount = rec.Punches.length;

      const holidayName = holidays.get(d);
      const holiday = holidayName !== undefined;
      const weeklyOff = planned ? planned.IsOff : isWeeklyOff(shift, dayOfWeek(d));
      const leave = leaves.find((l) => l.EmployeeId === emp.Id && dateOf(l.FromDate) <= d && dateOf(l.ToDate) >= d);

      if (rec.PunchCount > 0) {
        rec.In = rec.Punches[0];
        if (rec.PunchCount > 1) rec.Out = rec.Punches[rec.PunchCount - 1];
        rec.Status = Status.Present;

        if (rec.Out !== null) {
          rec.WorkedMinutes = minutesBetween(rec.In, rec.Out);
          applyBreak(rec, shift, d);
        } else {
          rec.Remark = 'Out punch missing';
          if (rules.singlePunch === 'Half Day') rec.Status = Status.HalfDay;
          else if (rules.singlePunch === 'Absent') rec.Status = Status.Absent;
        }

        if (holiday || weeklyOff) {
          rec.OvertimeMinutes = rec.WorkedMinutes;
          rec.Remark = join(rec.Remark, holiday ? `Worked on holiday (${holidayName})` : 'Worked on weekly off');
        } else {
          const late = minutesBetween(shiftStart, rec.In);
          if (late > shift.LateGraceMinutes) rec.LateMinutes = late;

          if (rec.Out !== null) {
            const early = minutesBetween(rec.Out, shiftEnd);
            if (early > shift.EarlyGraceMinutes) rec.EarlyMinutes = early;
            const extra = rec.WorkedMinutes - workMinutes(shift);
            if (extra >= shift.MinOvertimeMinutes && shift.MinOvertimeMinutes >= 0) rec.OvertimeMinutes = extra;
            if (shift.HalfDayMinutes > 0 && rec.WorkedMinutes < shift.HalfDayMinutes) rec.Status = Status.HalfDay;
          }

          if (leave) {
            if (leave.IsHalfDay) {
              rec.Status = Status.HalfDay;
              applyLeave(rec, leave, 0.5, true, quotaLeft(leave, d));
            } else rec.Remark = join(rec.Remark, `Punched during ${leave.type?.Code ?? ''} leave`);
          }
        }
      } else if (d > now) rec.Status = '';
      else if (holiday) { rec.Status = Status.Holiday; rec.Remark = holidayName ?? ''; }
      else if (weeklyOff) rec.Status = Status.WeeklyOff;
      else if (leave) applyLeave(rec, leave, leave.IsHalfDay ? 0.5 : 1, false, quotaLeft(leave, d));
      else {
        rec.Status = Status.Absent;
        const pending = pendingLeaves.find((l) => l.EmployeeId === emp.Id && dateOf(l.FromDate) <= d && dateOf(l.ToDate) >= d);
        if (pending) {
          rec.PendingLeaveDays = pending.IsHalfDay ? 0.5 : 1;
          rec.Remark = join(rec.Remark, `${pending.type?.Code ?? ''} leave pending approval`);
        }
      }
    }
  }
  return result;
}

export function summarize(days: DayRecord[]): MonthlySummary[] {
  const groups = new Map<number, DayRecord[]>();
  for (const d of days) {
    const g = groups.get(d.EmployeeId) ?? [];
    g.push(d);
    groups.set(d.EmployeeId, g);
  }
  return [...groups.values()].map((g) => {
    const f = g[0];
    const s: MonthlySummary = {
      EmployeeId: f.EmployeeId, EnrollNo: f.EnrollNo, Name: f.Name, Department: f.Department, Present: 0, Absent: 0, Leave: 0,
      PaidLeave: 0, PendingLeave: 0, Holidays: 0, WeeklyOffs: 0, LateCount: 0, LateMinutes: 0, EarlyCount: 0, WorkedMinutes: 0,
      OvertimeMinutes: 0, PaidDays: 0,
    };
    for (const d of g) {
      s.Present += presentValue(d);
      if (d.Status === Status.Absent) s.Absent += 1;
      if (d.IsLeave) {
        s.Leave += d.LeaveDays;
        s.PaidLeave += d.PaidLeaveDays;
        // Half-day leave with no punches: the other half is absent.
        if (d.LeaveDays < 1 && d.Status !== Status.HalfDay) s.Absent += 1 - d.LeaveDays;
      }
      s.PendingLeave += d.PendingLeaveDays;
      if (d.Status === Status.Holiday) s.Holidays++;
      if (d.Status === Status.WeeklyOff) s.WeeklyOffs++;
      if (d.LateMinutes > 0) { s.LateCount++; s.LateMinutes += d.LateMinutes; }
      if (d.EarlyMinutes > 0) s.EarlyCount++;
      s.WorkedMinutes += d.WorkedMinutes;
      s.OvertimeMinutes += d.OvertimeMinutes;
    }
    s.PaidDays = s.Present + s.PaidLeave + s.Holidays + s.WeeklyOffs;
    return s;
  });
}

/**
 * Shift break: with 4+ punches the gaps between the pairs (out for break, back in) are the break taken; otherwise the fixed
 * break is assumed when the day covers the break window (or is longer than twice the break when no window is set). When the
 * break is not working time it comes off the worked minutes; a break longer than allowed is noted in the remark.
 */
function applyBreak(rec: DayRecord, shift: Shift, day: DT) {
  if (shift.BreakMinutes <= 0 || rec.In === null || rec.Out === null) return;
  const p = rec.Punches;
  let taken = 0;
  if (p.length >= 4) for (let i = 1; i + 1 < p.length; i += 2) taken += minutesBetween(p[i], p[i + 1]);
  else if (shift.breakStart !== null && shift.breakEnd !== null) {
    const bs = day + shift.breakStart * MINUTE + (shift.breakStart < shift.start ? DAY : 0);
    const be = day + shift.breakEnd * MINUTE + (shift.breakEnd < shift.start ? DAY : 0);
    if (rec.In <= bs && rec.Out >= be) taken = shift.BreakMinutes;
  } else if (rec.WorkedMinutes > shift.BreakMinutes * 2) taken = shift.BreakMinutes;
  if (taken > shift.BreakMinutes) rec.Remark = join(rec.Remark, `Break ${taken} min (allowed ${shift.BreakMinutes})`);
  rec.BreakMinutes = taken;
  if (shift.DeductBreak) rec.WorkedMinutes = Math.max(0, rec.WorkedMinutes - taken);
}

/** Drops punches made within `minutes` of the previous kept punch (double finger press). */
function removeRepeats(punches: DT[], minutes: number): DT[] {
  const list: DT[] = [];
  for (const t of punches)
    if (list.length === 0 || (t - list[list.length - 1]) / MINUTE >= minutes || minutes <= 0) list.push(t);
  return list;
}

function applyLeave(rec: DayRecord, leave: LeaveEntry, days: number, keepStatus: boolean, quotaLeft: number) {
  rec.IsLeave = true;
  rec.LeaveDays = days;
  const paid = leave.type?.IsPaid ?? true;
  rec.PaidLeaveDays = paid ? Math.min(Math.max(quotaLeft, 0), days) : 0;
  rec.IsPaidLeave = rec.PaidLeaveDays > 0;
  const code = leave.type?.Code ?? 'L';
  const overQuota = paid && rec.PaidLeaveDays < days;
  const shown = overQuota && rec.PaidLeaveDays === 0 ? 'LWP' : code;
  if (!keepStatus) rec.Status = days < 1 ? `½${shown}` : shown;
  rec.Remark = join(rec.Remark,
    overQuota ? `${code} quota used up: ${n1(days - rec.PaidLeaveDays)} day(s) unpaid (LWP)`
      : days < 1 ? `Half day ${code}` : leave.Reason ?? '');
}

/** Working days a leave covers: the employee's weekly offs and holidays inside it are not counted. */
export function leaveDays(leave: LeaveEntry, shift: Shift | null | undefined, holidays: Set<DT>) {
  const s = shift ?? FALLBACK_SHIFT;
  const out: { date: DT; days: number }[] = [];
  for (let d = dateOf(leave.FromDate); d <= dateOf(leave.ToDate); d = addDays(d, 1))
    if (!holidays.has(d) && !isWeeklyOff(s, dayOfWeek(d))) out.push({ date: d, days: leave.IsHalfDay ? 0.5 : 1 });
  return out;
}

/** "HH:mm" of a minute count, "" for zero. */
export const hm = (minutes: number) =>
  minutes <= 0 ? '' : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
