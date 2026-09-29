/** How the portal / app shows an employee's own data: profile, leave rows, monthly stats, late days. */
import { one } from '../config/db';
import { EMPLOYEE_COLUMNS, LEAVE_STATUS, toEmployee, type LeaveEntry } from '../models';
import { UserError } from '../utils/errors';
import { fmt, sqlD, type DT } from '../utils/time';
import { Status, type DayRecord } from './attendance.service';

/** "29 Sep 2026" (empty for no date). */
export const dateText = (t: DT | null) => (t === null ? '' : fmt(t, 'dd MMM yyyy'));

/** The logged-in employee with their portal account flags. */
export async function portalEmployee(id: number) {
  const r = await one(`SELECT ${EMPLOYEE_COLUMNS}, e.PhotoBase64, a.IsManager, a.MustChange FROM Employees e
    LEFT JOIN Departments d ON d.Id = e.DepartmentId JOIN PortalAccounts a ON a.EmployeeId = e.Id WHERE e.Id = @id`, { id });
  if (!r) throw new UserError('Account not found.', 401);
  return { ...toEmployee(r), PhotoBase64: r.PhotoBase64 as string | null, IsManager: !!r.IsManager, MustChange: !!r.MustChange };
}

export function leaveRow(l: LeaveEntry, extra: Record<string, unknown> = {}) {
  return {
    Id: l.Id, Type: l.type?.Code ?? '', TypeName: l.type?.Name ?? '', From: dateText(l.FromDate), To: dateText(l.ToDate), FromIso: sqlD(l.FromDate),
    ToIso: sqlD(l.ToDate), HalfDay: l.IsHalfDay, Days: l.IsHalfDay ? 0.5 : (l.ToDate - l.FromDate) / 86_400_000 + 1,
    Status: LEAVE_STATUS[l.Status] ?? '', Reason: l.Reason ?? '', AppliedOn: dateText(l.AppliedOn), DecidedBy: l.ApprovedBy ?? '',
    DecidedOn: dateText(l.ApprovedOn), ...extra,
  };
}

/** Late days in a period (the "Late" tab), newest first. */
export function lateRows(days: DayRecord[]) {
  return days.filter((x) => x.LateMinutes > 0).sort((a, b) => b.Date - a.Date).map((x) => ({
    Date: dateText(x.Date), DateIso: sqlD(x.Date),
    LateBy: x.LateMinutes >= 60 ? `${Math.floor(x.LateMinutes / 60)} hrs ${x.LateMinutes % 60} mins` : `${x.LateMinutes} mins`,
    CheckIn: x.In !== null ? fmt(x.In, 'hh:mm tt') : '', Minutes: x.LateMinutes,
  }));
}

/** Attendance % (present + paid leave of the working days) and punctuality % (on-time days of the days punched). */
export function stats(days: DayRecord[]) {
  const working = days.filter((x) => x.Status !== '' && x.Status !== Status.NotJoined && x.Status !== Status.Holiday && x.Status !== Status.WeeklyOff);
  const present = working.reduce((a, x) => a + (x.Status === Status.Present ? 1 : x.Status === Status.HalfDay ? 0.5 : 0) + (x.IsPaidLeave ? x.PaidLeaveDays : 0), 0);
  const came = days.filter((x) => x.PunchCount > 0 && x.Status !== Status.Holiday && x.Status !== Status.WeeklyOff);
  const onTime = came.filter((x) => x.LateMinutes === 0).length;
  return {
    attendancePct: working.length ? Math.round((present / working.length) * 100) : 0,
    punctualityPct: came.length ? Math.round((onTime / came.length) * 100) : 100,
    lateDays: came.length - onTime,
    workingDays: working.length,
  };
}
