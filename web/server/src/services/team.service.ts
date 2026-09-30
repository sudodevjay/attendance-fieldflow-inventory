/** Managers: their team (direct reports, or their department — see hierarchy.service) today, and deciding its requests. */
import { exec, one, query } from '../config/db';
import { byEnroll, LEAVE_COLUMNS, loadLeaveTypes, toLeave } from '../models';
import { UserError } from '../utils/errors';
import { addDays, fmt, monthStart, sqlD, today } from '../utils/time';
import { hm, process, Status } from './attendance.service';
import * as requests from './employeeRequest.service';
import { leaveRow, portalEmployee, stats } from './employeeView.service';
import * as compoff from './compoff.service';
import { isManager, teamIds } from './hierarchy.service';
import { notifyDecision } from './employeeRequest.service';

export { teamIds };

export async function requireManager(employeeId: number) {
  const m = await portalEmployee(employeeId);
  if (!m.IsManager && !(await isManager(employeeId))) throw new UserError('Only managers can see team data.', 403);
  return { ...m, IsManager: true };
}

/** Leave rows of a team (pending only, or everything that ended in the last 60 days). */
async function teamLeaves(ids: number[], pendingOnly: boolean) {
  if (!ids.length) return [];
  const types = new Map((await loadLeaveTypes()).map((x) => [x.Id, x]));
  const rows = await query(`SELECT ${LEAVE_COLUMNS}, e.Name, e.EnrollNo FROM LeaveEntries l JOIN Employees e ON e.Id = l.EmployeeId
    WHERE l.EmployeeId = ANY(@ids) AND ${pendingOnly ? 'l.Status = 0' : 'l.ToDate >= CAST(@f AS timestamp)'}
    ORDER BY ${pendingOnly ? 'l.FromDate' : 'l.Status, l.FromDate DESC'}`, { ids, f: sqlD(addDays(today(), -60)) });
  return rows.map((r) => leaveRow(toLeave(r, types), { Name: r.Name, EnrollNo: r.EnrollNo, EmployeeId: r.EmployeeId }));
}

/** Today's counts of the team and its pending requests (Home → Team Space). */
export async function summary(managerId: number) {
  const ids = await teamIds(managerId);
  const t = today();
  const days = ids.length ? (await process(t, t)).filter((x) => ids.includes(x.EmployeeId)) : [];
  return {
    total: ids.length,
    present: days.filter((x) => x.PunchCount > 0).length,
    absent: days.filter((x) => x.PunchCount === 0 && x.Status === Status.Absent).length,
    late: days.filter((x) => x.LateMinutes > 0).length,
    onLeave: days.filter((x) => x.IsLeave).length,
    leaveRequests: await teamLeaves(ids, true),
    otherRequests: await requests.ofEmployees(ids, 'pending'),
  };
}

/** Team Requests / Team Stats: members today with their month's stats, and requests of the last 60 days. */
export async function overview(managerId: number) {
  await requireManager(managerId);
  const ids = await teamIds(managerId);
  const t = today();
  const days = ids.length ? (await process(t, t)).filter((x) => ids.includes(x.EmployeeId)) : [];
  const month = ids.length ? (await process(monthStart(t), t)).filter((x) => ids.includes(x.EmployeeId)) : [];
  const members = days.sort(byEnroll).map((x) => ({
    Id: x.EmployeeId, EnrollNo: x.EnrollNo, Name: x.Name, Department: x.Department, Status: x.Status, In: x.In !== null ? fmt(x.In, 'hh:mm tt') : '',
    Out: x.Out !== null ? fmt(x.Out, 'hh:mm tt') : '', Late: hm(x.LateMinutes), ...stats(month.filter((y) => y.EmployeeId === x.EmployeeId)),
  }));
  return {
    total: ids.length, present: days.filter((x) => x.PunchCount > 0).length,
    absent: days.filter((x) => x.PunchCount === 0 && x.Status === Status.Absent).length, late: days.filter((x) => x.LateMinutes > 0).length,
    onLeave: days.filter((x) => x.IsLeave).length, members, leaves: await teamLeaves(ids, false), requests: await requests.ofEmployees(ids, 'recent'),
  };
}

/** Approve / reject a team member's pending leave or request. */
export async function decide(managerId: number, kind: string, id: number, approve: boolean, note: string | null) {
  const m = await requireManager(managerId);
  const ids = await teamIds(m.Id);
  if (kind === 'leave') {
    const l = await one(`SELECT l.EmployeeId, l.Status, t.Code, to_char(l.FromDate, 'YYYY-MM-DD') AS f FROM LeaveEntries l
      LEFT JOIN LeaveTypes t ON t.Id = l.LeaveTypeId WHERE l.Id = @id`, { id });
    if (!l || !ids.includes(l.EmployeeId)) throw new UserError('This leave is not from your team.', 403);
    if (l.Status !== 0) throw new UserError('This leave has already been decided.');
    if (approve && l.Code === compoff.COMP_OFF_CODE && (await compoff.balance(l.EmployeeId)).uncovered > 0)
      throw new UserError('Not enough comp-off balance for this leave.');
    await exec(`UPDATE LeaveEntries SET Status = @st, ApprovedBy = @by, ApprovedOn = CAST(@on AS timestamp),
      Reason = CASE WHEN CAST(@note AS text) IS NULL THEN Reason ELSE LEFT(COALESCE(Reason, '') || ' | ' || @note, 200) END WHERE Id = @id`,
    { st: approve ? 1 : 2, by: m.Name.slice(0, 100), on: sqlD(today()), note, id });
    await notifyDecision(l.EmployeeId, `${l.Code ?? ''} leave`.trim(), approve, m.Name, note, 'leave');
  } else {
    const owner = await requests.pendingOwner(id);
    if (owner === null || !ids.includes(owner)) throw new UserError('This request is not a pending request of your team.', 403);
    if ((await requests.typeOf(id)) === 'Profile') throw new UserError('Profile changes are approved by HR.', 403);
    await requests.decide(id, approve, m.Name, note);
  }
  return approve ? 'Approved.' : 'Rejected.';
}

/** May this employee see the receipt of this request (their own, or of their team as a manager)? */
export async function canSeeRequest(employeeId: number, ownerId: number) {
  if (ownerId === employeeId) return true;
  return (await teamIds(employeeId)).includes(ownerId);
}
