/**
 * Compensatory off. An employee who worked on a holiday or weekly off asks for a comp-off credit (EmployeeRequests,
 * Type CompOff, Amount = 1 or 0.5 day); once approved it can be used as leave of type CO within the expiry
 * (Leave.CompOffExpiryDays, default 90 days). Credits are used oldest first (FIFO).
 */
import { query } from '../config/db';
import { LEAVE_COLUMNS, loadLeaveTypes, toLeave } from '../models';
import { UserError } from '../utils/errors';
import { addDays, dateOf, fmt, parse, today, type DT } from '../utils/time';
import { process, Status } from './attendance.service';
import { getSetting } from './settings.service';

export const COMP_OFF_CODE = 'CO';

export async function expiryDays() {
  const v = Number(await getSetting('Leave.CompOffExpiryDays', '90'));
  return Number.isInteger(v) && v > 0 ? v : 90;
}

export async function compOffTypeId(): Promise<number | null> {
  return (await loadLeaveTypes()).find((t) => t.Code.toUpperCase() === COMP_OFF_CODE)?.Id ?? null;
}

/** Checks that the employee worked on that day and it was a holiday / weekly off; returns the days that can be claimed. */
export async function claimable(employeeId: number, day: DT) {
  if (day > today()) throw new UserError('The day cannot be in the future.');
  if (day < addDays(today(), -(await expiryDays()))) throw new UserError('This day is too long ago for a comp-off.');
  const rec = (await process(day, day, null, employeeId))[0];
  if (!rec) throw new UserError('Employee not found.');
  const off = /Worked on (holiday|weekly off)/.test(rec.Remark);
  if (!off) throw new UserError(`${fmt(day, 'dd MMM yyyy')} was not a holiday or weekly off with punches, so no comp-off can be claimed.`);
  if (rec.Status !== Status.Present && rec.Status !== Status.HalfDay) throw new UserError('No work was recorded on that day.');
  return { worked: rec.WorkedMinutes, days: rec.Status === Status.HalfDay ? 0.5 : 1 };
}

interface Credit { date: DT; expires: DT; days: number; left: number }

/** Credits (approved requests) and CO leave (approved + pending) of an employee, matched FIFO. */
export async function balance(employeeId: number) {
  const expiry = await expiryDays();
  const creditRows = await query(`SELECT to_char(RequestDate, 'YYYY-MM-DD') AS d, CAST(Amount AS float) a FROM EmployeeRequests
    WHERE EmployeeId = @e AND Type = 'CompOff' AND Status = 1 ORDER BY RequestDate`, { e: employeeId });
  const credits: Credit[] = creditRows.map((r) => {
    const date = parse(r.d)!;
    return { date, expires: addDays(date, expiry), days: r.a, left: r.a };
  });
  const typeId = await compOffTypeId();
  const leaveRows = typeId ? await query(`SELECT ${LEAVE_COLUMNS} FROM LeaveEntries l WHERE l.EmployeeId = @e AND l.LeaveTypeId = @t
    AND l.Status IN (0, 1) ORDER BY l.FromDate`, { e: employeeId, t: typeId }) : [];
  const usages = leaveRows.map((r) => toLeave(r)).flatMap((l) => {
    const out: { date: DT; days: number; pending: boolean }[] = [];
    for (let d = dateOf(l.FromDate); d <= dateOf(l.ToDate); d = addDays(d, 1)) out.push({ date: d, days: l.IsHalfDay ? 0.5 : 1, pending: l.Status === 0 });
    return out;
  });
  let used = 0, pending = 0, uncovered = 0;
  for (const u of usages) {
    let need = u.days;
    for (const c of credits) {
      if (need <= 0) break;
      if (c.left <= 0 || c.date > u.date || c.expires < u.date) continue;
      const take = Math.min(c.left, need);
      c.left -= take;
      need -= take;
    }
    if (u.pending) pending += u.days; else used += u.days;
    uncovered += need;
  }
  const t = today();
  const available = credits.filter((c) => c.expires >= t).reduce((a, c) => a + c.left, 0);
  const expired = credits.filter((c) => c.expires < t).reduce((a, c) => a + c.left, 0);
  const next = credits.filter((c) => c.expires >= t && c.left > 0).sort((a, b) => a.expires - b.expires)[0];
  return {
    earned: credits.reduce((a, c) => a + c.days, 0), used, pending, available, expired, uncovered, expiryDays: expiry,
    nextExpiry: next ? fmt(next.expires, 'dd MMM yyyy') : '',
  };
}

/** A new CO leave must be covered by the available balance (pending CO leave already counts as used). */
export async function checkLeave(employeeId: number, days: number) {
  const b = await balance(employeeId);
  if (days > b.available + 1e-9) throw new UserError(`Comp-off balance is ${b.available} day(s); this leave needs ${days}.`);
}
