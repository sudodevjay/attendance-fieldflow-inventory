/** Leave entries: list, add / edit, approve / reject with the yearly quota warning, delete (LeavePage.cs). */
import { exec, one, query } from '../config/db';
import { assertInScope, filterScope } from '../utils/scope';
import { LEAVE_COLUMNS, LEAVE_STATUS, loadHolidays, toLeave } from '../models';
import { UserError } from '../utils/errors';
import { fmt, mustParse, sqlD, today, year, type DT } from '../utils/time';
import { leaveDays, n1 } from './attendance.service';
import { excel } from './export.service';
import { leaveBalance, leaveQuota } from './payroll.service';
import * as compoff from './compoff.service';
import { notifyDecision } from './employeeRequest.service';
import { getSetting, setSetting } from './settings.service';

const d = (t: DT | null) => (t === null ? '' : fmt(t, 'dd-MM-yyyy'));

/** Leave that touches the year, pending first. */
export async function list(y: number) {
  const rows = await query(`SELECT ${LEAVE_COLUMNS}, e.EnrollNo, e.Name, t.Code FROM LeaveEntries l
      LEFT JOIN Employees e ON e.Id = l.EmployeeId LEFT JOIN LeaveTypes t ON t.Id = l.LeaveTypeId
    WHERE l.FromDate <= CAST(@to AS timestamp) AND l.ToDate >= CAST(@from AS timestamp)
    ORDER BY CASE WHEN l.Status = 0 THEN 0 ELSE 1 END, l.FromDate DESC`, { from: `${y}-01-01`, to: `${y}-12-31` });
  return filterScope(rows, (r) => r.EmployeeId).map((r) => {
    const l = toLeave(r);
    return {
      Id: l.Id, EmployeeId: l.EmployeeId, LeaveTypeId: l.LeaveTypeId, Status: LEAVE_STATUS[l.Status] ?? String(l.Status),
      StatusValue: l.Status, EnrollNo: r.EnrollNo, Name: r.Name, Type: r.Code, From: d(l.FromDate), To: d(l.ToDate),
      FromIso: sqlD(l.FromDate), ToIso: sqlD(l.ToDate), Days: l.IsHalfDay ? 0.5 : (l.ToDate - l.FromDate) / 86_400_000 + 1,
      HalfDay: l.IsHalfDay, AppliedOn: d(l.AppliedOn), AppliedOnIso: l.AppliedOn !== null ? sqlD(l.AppliedOn) : '',
      ApprovedBy: l.ApprovedBy ?? '', DecidedOn: d(l.ApprovedOn), Reason: l.Reason ?? '',
      FirstApprovedBy: r.FirstApprovedBy ?? '',
    };
  });
}

export const lastApprover = () => getSetting('Leave.LastApprover');

interface QuotaCheck { Id: number | null; EmployeeId: number; LeaveTypeId: number; FromDate: DT; ToDate: DT; IsHalfDay: boolean }

/** Warning text when approving would go beyond the yearly quota (the extra days become unpaid); null when fine. */
async function quotaWarning(entry: QuotaCheck) {
  const q = await leaveQuota(entry.EmployeeId, entry.LeaveTypeId, year(entry.FromDate), entry.Id);
  if (!q.type || !q.type.IsPaid || q.type.YearlyQuota <= 0) return null;
  if (year(entry.FromDate) !== year(entry.ToDate)) return null;
  const holidays = new Set((await loadHolidays(entry.FromDate, entry.ToDate)).keys());
  const days = leaveDays({ ...entry, Id: entry.Id ?? 0, Reason: null, Status: 1, AppliedOn: null, ApprovedBy: null, ApprovedOn: null, FirstApprovedBy: null, FirstApprovedOn: null }, q.shift, holidays)
    .reduce((a, x) => a + x.days, 0);
  const left = Math.max(0, q.quota - q.taken);
  if (days <= left) return null;
  return `${q.type.Code} balance: ${n1(left)} day(s) (quota ${n1(q.quota)}, already taken ${n1(q.taken)}).\n` +
    `${n1(days - left)} of the ${n1(days)} day(s) of this leave will be unpaid (LWP).`;
}

export interface LeaveInput {
  Id?: unknown; EmployeeId?: unknown; LeaveTypeId?: unknown; FromDate?: unknown; ToDate?: unknown; IsHalfDay?: unknown;
  Status?: unknown; ApprovedBy?: unknown; AppliedOn?: unknown; Reason?: unknown; confirmQuota?: unknown;
}

/**
 * Add (no Id) or edit a leave. Approving beyond the quota returns `needsConfirm` (the question for the user) unless
 * `confirmQuota` is set.
 */
export async function save(b: LeaveInput): Promise<{ ok: true } | { needsConfirm: string }> {
  const id = b.Id ? Number(b.Id) : null;
  const emp = Number(b.EmployeeId), type = Number(b.LeaveTypeId);
  if (!emp || !type) throw new UserError('Select an employee and a leave type.');
  assertInScope(emp);
  if (id) assertInScope((await one('SELECT EmployeeId FROM LeaveEntries WHERE Id = @id', { id }))?.EmployeeId);
  const from = mustParse(String(b.FromDate)), to = mustParse(String(b.ToDate));
  if (to < from) throw new UserError("The 'To' date cannot be before the 'From' date.");
  const half = !!b.IsHalfDay;
  if (half && to !== from) throw new UserError('A half-day leave can only be for a single date.');
  const status = Math.max(0, LEAVE_STATUS.indexOf(b.Status as any));
  const by = String(b.ApprovedBy ?? '').trim();
  if (status !== 0 && !by) throw new UserError('Enter the name of the person who approved / rejected it.');
  const applied = b.AppliedOn ? mustParse(String(b.AppliedOn)) : null;

  if (status === 1 && !b.confirmQuota) {
    const warning = await quotaWarning({ Id: id, EmployeeId: emp, LeaveTypeId: type, FromDate: from, ToDate: to, IsHalfDay: half });
    if (warning) return { needsConfirm: warning + '\n\nSave anyway?' };
  }
  const old = id ? await one("SELECT Status, to_char(ApprovedOn, 'YYYY-MM-DD') AS ApprovedOn FROM LeaveEntries WHERE Id = @id", { id }) : null;
  if (!id && (await compoff.compOffTypeId()) === type) await compoff.checkLeave(emp, half ? 0.5 : (to - from) / 86_400_000 + 1);
  const decidedOn = status === 0 ? null : old && old.Status === status && old.ApprovedOn ? old.ApprovedOn : sqlD(today());
  const p = {
    emp, type, f: sqlD(from), t: sqlD(to), h: half, r: String(b.Reason ?? '').trim().slice(0, 200) || null, st: status,
    ap: applied !== null ? sqlD(applied) : null, by: status === 0 ? null : by.slice(0, 100), on: decidedOn, id,
  };
  if (id)
    await exec(`UPDATE LeaveEntries SET EmployeeId = @emp, LeaveTypeId = @type, FromDate = CAST(@f AS timestamp),
      ToDate = CAST(@t AS timestamp), IsHalfDay = @h, Reason = @r, Status = @st, AppliedOn = CAST(@ap AS timestamp),
      ApprovedBy = @by, ApprovedOn = CAST(@on AS timestamp) WHERE Id = @id`, p);
  else
    await exec(`INSERT INTO LeaveEntries (EmployeeId, LeaveTypeId, FromDate, ToDate, IsHalfDay, Reason, Status, AppliedOn, ApprovedBy, ApprovedOn)
      VALUES (@emp, @type, CAST(@f AS timestamp), CAST(@t AS timestamp), @h, @r, @st, CAST(@ap AS timestamp), @by,
        CAST(@on AS timestamp))`, p);
  if (status !== 0) await setSetting('Leave.LastApprover', by);
  if (status !== 0 && (!old || old.Status !== status)) await notifyDecision(emp, 'Leave', status === 1, by, null, 'leave');
  return { ok: true };
}

/** Approve / reject; entries beyond their quota are skipped and returned as warnings unless their id is in `confirmed`. */
export async function decide(ids: number[], approve: boolean, by: string, confirmed: number[]) {
  if (!ids.length) throw new UserError('Select a leave request first.');
  by = by.trim();
  if (!by) throw new UserError(`Enter who ${approve ? 'approved' : 'rejected'} it.`);
  const ok = new Set(confirmed);
  const rows = await query(`SELECT ${LEAVE_COLUMNS} FROM LeaveEntries l WHERE l.Id = ANY(@ids)`, { ids });
  for (const r of rows) assertInScope(r.EmployeeId);
  const warnings: { id: number; text: string }[] = [];
  let changed = 0;
  for (const r of rows) {
    const l = toLeave(r);
    if (approve && l.Status !== 1 && !ok.has(l.Id)) {
      const w = await quotaWarning(l);
      if (w) { warnings.push({ id: l.Id, text: w }); continue; }
    }
    const st = approve ? 1 : 2;
    await exec(`UPDATE LeaveEntries SET Status = @st, ApprovedBy = @by,
        ApprovedOn = CASE WHEN Status <> @st OR ApprovedOn IS NULL THEN CAST(@on AS timestamp) ELSE ApprovedOn END WHERE Id = @id`,
    { st, by: by.slice(0, 100), on: sqlD(today()), id: l.Id });
    if (l.Status !== st) await notifyDecision(l.EmployeeId, 'Leave', approve, by, null, 'leave');
    changed++;
  }
  await setSetting('Leave.LastApprover', by);
  return { changed, warnings };
}

export async function removeMany(ids: number[]) {
  for (const r of await query('SELECT EmployeeId FROM LeaveEntries WHERE Id = ANY(@ids)', { ids })) assertInScope(r.EmployeeId);
  await exec('DELETE FROM LeaveEntries WHERE Id = ANY(@ids)', { ids });
}

export const balance = (y: number) => leaveBalance('Leave Balance', y, null, null);

export async function balanceExcel(y: number) {
  return { buffer: await excel(await balance(y)), name: `Leave_Balance_${y}.xlsx` };
}
