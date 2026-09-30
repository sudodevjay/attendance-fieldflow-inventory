/**
 * Team leads and managers in the portal / app: their team (everybody below them — see hierarchy.service) today, and
 * deciding its requests. Two steps when the employee has a team lead and a manager: the team lead approves first
 * (FirstApprovedBy, the item stays pending), then the manager decides. A rejection is always final.
 */
import { exec, one, query } from '../config/db';
import { byEnroll, LEAVE_COLUMNS, loadLeaveTypes, toLeave } from '../models';
import { UserError } from '../utils/errors';
import { addDays, fmt, monthStart, sqlD, today } from '../utils/time';
import { hm, process, Status } from './attendance.service';
import * as compoff from './compoff.service';
import * as requests from './employeeRequest.service';
import { notifyDecision } from './employeeRequest.service';
import { leaveRow, portalEmployee, stats } from './employeeView.service';
import { approvalChain, isManager, portalRole, stageFor, teamIds, type Chain } from './hierarchy.service';
import { notify } from './notification.service';

export { teamIds };

export async function requireManager(employeeId: number) {
  const m = await portalEmployee(employeeId);
  if (!m.IsManager && !(await isManager(employeeId))) throw new UserError('Only team leads and managers can see team data.', 403);
  return { ...m, IsManager: true, Role: (await portalRole(employeeId)) ?? 'Employee' };
}

/**
 * Adds what the viewer may do with each pending item: Step 'first' (team lead approval) / 'final' / null, CanDecide,
 * and a Stage text ("Waiting for team lead", "Approved by team lead X — waiting for manager").
 */
async function withStage<T extends { EmployeeId: number; Status: string; FirstApprovedBy?: string | null }>(actorId: number, items: T[]) {
  const chains = new Map<number, Chain>();
  const out = [];
  for (const it of items) {
    if (it.Status !== 'Pending') { out.push({ ...it, Step: null, CanDecide: false, Stage: '' }); continue; }
    if (!chains.has(it.EmployeeId)) chains.set(it.EmployeeId, await approvalChain(it.EmployeeId));
    const c = chains.get(it.EmployeeId)!;
    const step = await stageFor(actorId, it.EmployeeId, it.FirstApprovedBy || null, c);
    const stage = it.FirstApprovedBy ? `Approved by team lead ${it.FirstApprovedBy} — waiting for manager`
      : c.teamLead !== null && c.managers.length ? 'Waiting for team lead' : '';
    out.push({ ...it, Step: step, CanDecide: step !== null, Stage: stage });
  }
  return out;
}

/** Leave rows of a team (pending only, or everything that ended in the last 60 days). */
async function teamLeaves(ids: number[], pendingOnly: boolean) {
  if (!ids.length) return [];
  const types = new Map((await loadLeaveTypes()).map((x) => [x.Id, x]));
  const rows = await query(`SELECT ${LEAVE_COLUMNS}, e.Name, e.EnrollNo FROM LeaveEntries l JOIN Employees e ON e.Id = l.EmployeeId
    WHERE l.EmployeeId = ANY(@ids) AND ${pendingOnly ? 'l.Status = 0' : 'l.ToDate >= CAST(@f AS timestamp)'}
    ORDER BY ${pendingOnly ? 'l.FromDate' : 'l.Status, l.FromDate DESC'}`, { ids, f: sqlD(addDays(today(), -60)) });
  return rows.map((r) => ({ ...leaveRow(toLeave(r, types)), Name: r.Name as string, EnrollNo: r.EnrollNo as string, EmployeeId: r.EmployeeId as number }));
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
    leaveRequests: await withStage(managerId, await teamLeaves(ids, true)),
    otherRequests: await withStage(managerId, await requests.ofEmployees(ids, 'pending')),
  };
}

/** Team Requests / Team Stats: members today with their month's stats, and requests of the last 60 days. */
export async function overview(managerId: number) {
  const m = await requireManager(managerId);
  const ids = await teamIds(managerId);
  const t = today();
  const days = ids.length ? (await process(t, t)).filter((x) => ids.includes(x.EmployeeId)) : [];
  const month = ids.length ? (await process(monthStart(t), t)).filter((x) => ids.includes(x.EmployeeId)) : [];
  const members = days.sort(byEnroll).map((x) => ({
    Id: x.EmployeeId, EnrollNo: x.EnrollNo, Name: x.Name, Department: x.Department, Status: x.Status, In: x.In !== null ? fmt(x.In, 'hh:mm tt') : '',
    Out: x.Out !== null ? fmt(x.Out, 'hh:mm tt') : '', Late: hm(x.LateMinutes), ...stats(month.filter((y) => y.EmployeeId === x.EmployeeId)),
  }));
  return {
    role: m.Role,
    total: ids.length, present: days.filter((x) => x.PunchCount > 0).length,
    absent: days.filter((x) => x.PunchCount === 0 && x.Status === Status.Absent).length, late: days.filter((x) => x.LateMinutes > 0).length,
    onLeave: days.filter((x) => x.IsLeave).length, members,
    leaves: await withStage(managerId, await teamLeaves(ids, false)),
    requests: await withStage(managerId, await requests.ofEmployees(ids, 'recent')),
  };
}

/** The team lead approved: the item stays pending for the manager, who is told; the employee too. */
async function firstApproval(table: 'LeaveEntries' | 'EmployeeRequests', id: number, employeeId: number, what: string, by: string, note: string | null) {
  await exec(`UPDATE ${table} SET FirstApprovedBy = @by, FirstApprovedOn = LOCALTIMESTAMP WHERE Id = @id AND Status = 0`, { by: by.slice(0, 100), id });
  const e = await one('SELECT EnrollNo, Name FROM Employees WHERE Id = @id', { id: employeeId });
  const c = await approvalChain(employeeId);
  for (const mgr of c.managers)
    await notify(mgr, `${what} from ${e?.Name ?? ''} (${e?.EnrollNo ?? ''})`, `Approved by team lead ${by}${note ? ': ' + note : ''}. Waiting for your decision.`, 'team');
  await notify(employeeId, `${what}: approved by team lead`, `By ${by}${note ? ': ' + note : ''}. Waiting for the manager.`, table === 'LeaveEntries' ? 'leave' : 'requests');
}

/** Approve / reject a team member's pending leave or request (step 1 for a team lead, else the final decision). */
export async function decide(managerId: number, kind: string, id: number, approve: boolean, note: string | null) {
  const m = await requireManager(managerId);
  if (kind === 'leave') {
    const l = await one(`SELECT l.EmployeeId, l.Status, l.FirstApprovedBy, t.Code FROM LeaveEntries l
      LEFT JOIN LeaveTypes t ON t.Id = l.LeaveTypeId WHERE l.Id = @id`, { id });
    if (!l) throw new UserError('Leave not found.', 404);
    if (l.Status !== 0) throw new UserError('This leave has already been decided.');
    const step = await stageFor(m.Id, l.EmployeeId, l.FirstApprovedBy);
    if (!step) throw new UserError(l.FirstApprovedBy ? 'You already approved it; the manager decides now.' : 'This leave is not waiting for you.', 403);
    const what = `${l.Code ?? ''} leave`.trim();
    if (approve && l.Code === compoff.COMP_OFF_CODE && (await compoff.balance(l.EmployeeId)).uncovered > 0)
      throw new UserError('Not enough comp-off balance for this leave.');
    if (approve && step === 'first') {
      await firstApproval('LeaveEntries', id, l.EmployeeId, what, m.Name, note);
      return 'Approved. It now goes to the manager.';
    }
    await exec(`UPDATE LeaveEntries SET Status = @st, ApprovedBy = @by, ApprovedOn = CAST(@on AS timestamp),
      Reason = CASE WHEN CAST(@note AS text) IS NULL THEN Reason ELSE LEFT(COALESCE(Reason, '') || ' | ' || @note, 200) END WHERE Id = @id`,
    { st: approve ? 1 : 2, by: m.Name.slice(0, 100), on: sqlD(today()), note, id });
    await notifyDecision(l.EmployeeId, what, approve, m.Name, note, 'leave');
  } else {
    const r = await one('SELECT EmployeeId, Type, FirstApprovedBy FROM EmployeeRequests WHERE Id = @id AND Status = 0', { id });
    if (!r) throw new UserError('This request is not pending.', 404);
    if (r.Type === 'Profile') throw new UserError('Profile changes are approved by HR.', 403);
    const step = await stageFor(m.Id, r.EmployeeId, r.FirstApprovedBy);
    if (!step) throw new UserError(r.FirstApprovedBy ? 'You already approved it; the manager decides now.' : 'This request is not waiting for you.', 403);
    if (approve && step === 'first') {
      await firstApproval('EmployeeRequests', id, r.EmployeeId, requests.typeName(r.Type), m.Name, note);
      return 'Approved. It now goes to the manager.';
    }
    await requests.decide(id, approve, m.Name, note);
  }
  return approve ? 'Approved.' : 'Rejected.';
}

/** May this employee see the receipt of this request (their own, or of their team as a team lead / manager)? */
export async function canSeeRequest(employeeId: number, ownerId: number) {
  if (ownerId === employeeId) return true;
  return (await teamIds(employeeId)).includes(ownerId);
}
