/**
 * Employee self-service (web portal /me and the mobile app): the employee's own home, check-in, attendance calendar,
 * leave, holidays and payroll. Leave requests go into LeaveEntries (Pending), so the Windows program shows them too.
 */
import { exec, one, query } from '../config/db';
import { LEAVE_COLUMNS, loadHolidays, loadLeaveTypes, loadShifts, shiftLabel, toLeave } from '../models';
import { UserError } from '../utils/errors';
import { num } from '../utils/format';
import { addDays, addMonths, fmt, make, month, monthStart, mustParse, now, parse, sqlD, sqlDT, today, year, type DT } from '../utils/time';
import { hm, leaveDays, n1, process } from './attendance.service';
import * as compoff from './compoff.service';
import * as requests from './employeeRequest.service';
import { isManager, portalRole } from './hierarchy.service';
import * as notifications from './notification.service';
import { getProfile, maskAccount } from './profile.service';
import { dateText, lateRows, leaveRow, portalEmployee, stats } from './employeeView.service';
import { salarySlip } from './export.service';
import { computePay } from './payroll.service';
import { companyName, getSetting } from './settings.service';
import * as sites from './site.service';
import { PunchSource } from './sync.service';
import * as team from './team.service';

const officeName = async () => (await getSetting('Portal.OfficeName')) || (await companyName());
const checkInAllowed = async () => (await getSetting('Portal.AllowCheckIn', '1')) === '1';

/** Shown on the login screen. */
export const info = async () => ({ company: await companyName(), office: await officeName() });

export async function profile(id: number) {
  const m = await portalEmployee(id);
  const shift = m.ShiftId ? (await loadShifts()).find((s) => s.Id === m.ShiftId) : undefined;
  const p = await getProfile(id);
  return {
    id: m.Id, enrollNo: m.EnrollNo, name: m.Name, designation: m.Designation ?? '', department: m.DepartmentName ?? '',
    shift: shift ? shiftLabel(shift) : '', phone: m.Phone ?? '', email: m.Email ?? '', gender: m.Gender ?? '', badgeNo: m.BadgeNo ?? '',
    joinDate: dateText(m.JoinDate), birthDate: dateText(m.BirthDate), address: m.HomeAddress ?? '', photo: m.PhotoBase64,
    isManager: m.IsManager || (await isManager(id)),
    // Employee / TeamLead / Manager (isManager = has a team: team lead or manager).
    role: (await portalRole(id)) ?? 'Employee',
    mustChange: m.MustChange, company: await companyName(), office: await officeName(), allowCheckIn: await checkInAllowed(), checkInAtSite: await sites.siteRequired(),
    reportingManager: p.ReportingManager,
    // HR profile; the bank account and Aadhaar only with their last digits.
    hr: {
      EmergencyName: p.EmergencyName, EmergencyRelation: p.EmergencyRelation, EmergencyPhone: p.EmergencyPhone, BloodGroup: p.BloodGroup,
      MaritalStatus: p.MaritalStatus, PersonalEmail: p.PersonalEmail, Pan: p.Pan, Aadhaar: maskAccount(p.Aadhaar), Uan: p.Uan, PfNo: p.PfNo,
      EsiNo: p.EsiNo, BankName: p.BankName, BankAccount: maskAccount(p.BankAccount), BankIfsc: p.BankIfsc, AccountHolder: p.AccountHolder,
    },
    selfFields: requests.SELF_FIELDS,
    pendingProfileChange: (await requests.ofEmployee(id, 'Profile')).some((r) => r.Status === 'Pending'),
  };
}

// ------------------------------------------------------------------ notifications, comp-off

export const notificationList = (id: number) => notifications.list(id);
export const notificationsRead = (id: number, ids: number[] | 'all') => notifications.markRead(id, ids);
export const compOffBalance = (id: number) => compoff.balance(id);

/** Leave taken (approved days) and still available per leave type in a year. */
async function leaveSummary(employeeId: number, y: number) {
  const types = await loadLeaveTypes();
  const map = new Map(types.map((t) => [t.Id, t]));
  const emp = await one('SELECT ShiftId FROM Employees WHERE Id = @id', { id: employeeId });
  const shift = emp?.ShiftId ? (await loadShifts()).find((s) => s.Id === emp.ShiftId) ?? null : null;
  const start = make(y, 1, 1), end = make(y, 12, 31);
  const holidays = new Set((await loadHolidays(start, end)).keys());
  const rows = (await query(`SELECT ${LEAVE_COLUMNS} FROM LeaveEntries l WHERE l.EmployeeId = @id
    AND l.FromDate <= CAST(@e AS timestamp) AND l.ToDate >= CAST(@s AS timestamp)`,
  { id: employeeId, s: sqlD(start), e: sqlD(end) })).map((r) => toLeave(r, map));
  const days = (status: number, typeId: number) => rows.filter((l) => l.Status === status && l.LeaveTypeId === typeId)
    .flatMap((l) => leaveDays(l, shift, holidays)).filter((x) => year(x.date) === y).reduce((a, x) => a + x.days, 0);
  const perType = types.map((t) => {
    const taken = days(1, t.Id), pending = days(0, t.Id);
    return { Id: t.Id, Code: t.Code, Name: t.Name, IsPaid: t.IsPaid, Quota: t.YearlyQuota, Taken: taken, Pending: pending,
      Remaining: t.YearlyQuota > 0 ? Math.max(0, t.YearlyQuota - taken) : null };
  });
  return {
    types: perType,
    availed: perType.reduce((a, t) => a + t.Taken, 0),
    // null = no leave type has a yearly quota (nothing to count down from)
    remaining: perType.some((t) => t.Remaining !== null) ? perType.reduce((a, t) => a + (t.Remaining ?? 0), 0) : null,
    entries: rows.sort((a, b) => b.FromDate - a.FromDate),
  };
}

/** Home: today, this month's stats, leave, requests, birthdays, holidays, and the team for managers. */
export async function home(id: number) {
  const t = today();
  const first = monthStart(t);
  const days = await process(first, t, null, id);
  const todayRec = days.find((x) => x.Date === t);
  const leave = await leaveSummary(id, year(t));
  const myLeaves = leave.entries.map((l) => leaveRow(l));
  const regs = await requests.ofEmployee(id, 'Regularisation');
  const offsites = regs.filter((r) => r.Status === 'Approved' && parse(r.RequestDate)! >= first).length;

  const birthdays = (await query(`SELECT Name, to_char(BirthDate, 'YYYY-MM-DD') AS b FROM Employees WHERE IsActive = TRUE AND BirthDate IS NOT NULL`))
    .filter((r) => r.b.slice(5) === sqlD(t).slice(5)).map((r) => r.Name as string);
  const hol = await loadHolidays(t, addDays(t, 120));
  const holidays = [...hol].sort((a, b) => a[0] - b[0]).slice(0, 5).map(([day, name]) => ({ date: dateText(day), day: fmt(day, 'dddd'), name }));
  const me = await portalEmployee(id);

  return {
    unreadNotifications: await notifications.unreadCount(id),
    compOff: (await compoff.balance(id)).available,
    today: {
      date: fmt(t, 'dd MMM, yyyy'), status: todayRec?.Status ?? '', punches: (todayRec?.Punches ?? []).map((p) => fmt(p, 'hh:mm tt')),
      in: todayRec?.In ? fmt(todayRec.In, 'hh:mm tt') : '', out: todayRec?.Out ? fmt(todayRec.Out, 'hh:mm tt') : '',
      checkedIn: (todayRec?.PunchCount ?? 0) % 2 === 1, worked: hm(todayRec?.WorkedMinutes ?? 0),
    },
    leaves: { availed: leave.availed, remaining: leave.remaining },
    stats: { ...stats(days), offsites },
    requests: { late: lateRows(days), leave: myLeaves, checkin: regs },
    lastLeave: myLeaves[0] ?? null,
    birthdays,
    holidays,
    team: me.IsManager || (await isManager(id)) ? await team.summary(id) : null,
  };
}

/**
 * Web / app check-in: a punch with source Manual, when the administrator allows it. With "check-in at a work site" on
 * (the default) it needs the GPS position inside a site's radius and a selfie (see site.service); otherwise it is a plain
 * "Self check-in".
 */
export async function checkIn(id: number, checkOut: boolean, source: string, geo: sites.SiteCheckIn = {}) {
  if (!(await checkInAllowed())) throw new UserError('Check-in from the portal / app is turned off. Please punch on the device.');
  const e = await one('SELECT EnrollNo FROM Employees WHERE Id = @id', { id });
  const t = now();
  if (await one(`SELECT Id FROM AttendanceLogs WHERE EnrollNo = @e AND PunchTime > CAST(@t AS timestamp) LIMIT 1`, { e: e.EnrollNo, t: sqlDT(t - 60_000) }))
    throw new UserError('You already punched in the last minute.');
  const where = source === 'app' ? 'app' : 'web';
  if (await sites.siteRequired()) return sites.punch(id, e.EnrollNo, t, checkOut, where, await sites.verify(id, geo));
  await exec(`INSERT INTO AttendanceLogs (EnrollNo, PunchTime, VerifyMode, InOutMode, WorkCode, Source, Remark)
    VALUES (@e, CAST(@t AS timestamp), -1, @io, 0, @src, @r)`,
  { e: e.EnrollNo, t: sqlDT(t), io: checkOut ? 1 : 0, src: PunchSource.Manual, r: `Self check-${checkOut ? 'out' : 'in'} (${where})` });
  return `${checkOut ? 'Checked out' : 'Checked in'} at ${fmt(t, 'hh:mm tt')}.`;
}

/** Attendance calendar of a month ('yyyy-MM', default this month): one row per day. */
export async function attendanceMonth(id: number, ym: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  const first = m ? make(+m[1], +m[2], 1) : monthStart(today());
  const days = await process(first, addDays(addMonths(first, 1), -1), null, id);
  return {
    month: fmt(first, 'MMMM yyyy'),
    days: days.map((x) => ({
      date: sqlD(x.Date), day: fmt(x.Date, 'ddd'), status: x.Status, in: x.In !== null ? fmt(x.In, 'HH:mm') : '', out: x.Out !== null ? fmt(x.Out, 'HH:mm') : '',
      worked: hm(x.WorkedMinutes), late: hm(x.LateMinutes), early: hm(x.EarlyMinutes), ot: hm(x.OvertimeMinutes), remark: x.Remark,
      punches: x.Punches.map((p) => fmt(p, 'HH:mm')),
    })),
    stats: stats(days.filter((x) => x.Date <= today())),
  };
}

export async function leaveOverview(id: number, y: number) {
  const s = await leaveSummary(id, y);
  return { types: s.types, availed: s.availed, remaining: s.remaining, entries: s.entries.map((l) => leaveRow(l)) };
}

export interface LeaveRequestInput { LeaveTypeId?: unknown; FromDate?: unknown; ToDate?: unknown; IsHalfDay?: unknown; Reason?: unknown }

/** Leave request (Pending); tells the employee when it goes beyond the balance. */
export async function applyLeave(id: number, b: LeaveRequestInput) {
  const type = (await loadLeaveTypes()).find((t) => t.Id === Number(b.LeaveTypeId));
  if (!type) throw new UserError('Choose a leave type.');
  const from = mustParse(String(b.FromDate)), to = mustParse(String(b.ToDate));
  if (to < from) throw new UserError("The 'To' date cannot be before the 'From' date.");
  const half = !!b.IsHalfDay;
  if (half && to !== from) throw new UserError('A half-day leave can only be for a single date.');
  if ((to - from) / 86_400_000 > 90) throw new UserError('A leave request can be at most 90 days.');
  const reason = String(b.Reason ?? '').trim();
  if (!reason) throw new UserError('Please write the reason.');
  if (await one(`SELECT Id FROM LeaveEntries WHERE EmployeeId = @id AND Status IN (0, 1)
    AND FromDate <= CAST(@t AS timestamp) AND ToDate >= CAST(@f AS timestamp)`, { id, f: sqlD(from), t: sqlD(to) }))
    throw new UserError('You already have a leave request for these dates.');
  if (type.Code.toUpperCase() === compoff.COMP_OFF_CODE) await compoff.checkLeave(id, half ? 0.5 : (to - from) / 86_400_000 + 1);
  await exec(`INSERT INTO LeaveEntries (EmployeeId, LeaveTypeId, FromDate, ToDate, IsHalfDay, Reason, Status, AppliedOn)
    VALUES (@id, @lt, CAST(@f AS timestamp), CAST(@t AS timestamp), @h, @r, 0, CAST(@ap AS timestamp))`,
  { id, lt: type.Id, f: sqlD(from), t: sqlD(to), h: half, r: reason.slice(0, 200), ap: sqlD(today()) });
  await requests.notifyNewRequest(id, `${type.Code} leave request`);

  // Quota information (the request is only a request: HR decides).
  let note = '';
  if (type.IsPaid && type.YearlyQuota > 0) {
    const t = (await leaveSummary(id, year(from))).types.find((x) => x.Id === type.Id)!;
    if (t.Pending > (t.Remaining ?? 0)) note = `\nNote: your ${type.Code} balance is ${n1(t.Remaining ?? 0)} day(s); days beyond it will be unpaid (LWP) if approved.`;
  }
  return `Leave request sent (${type.Code}, ${fmt(from, 'dd MMM')}${to !== from ? ' – ' + fmt(to, 'dd MMM') : ''}). Status: Pending.${note}`;
}

export async function cancelLeave(id: number, leaveId: number) {
  const n = await exec('DELETE FROM LeaveEntries WHERE Id = @id AND EmployeeId = @e AND Status = 0', { id: leaveId, e: id });
  if (!n) throw new UserError('Only your own pending requests can be cancelled.');
}

export async function holidays(y: number) {
  const h = await loadHolidays(make(y, 1, 1), make(y, 12, 31));
  return [...h].sort((a, b) => a[0] - b[0]).map(([day, name]) => ({ date: dateText(day), iso: sqlD(day), day: fmt(day, 'dddd'), name, past: day < today() }));
}

/** Own payslip PDF of a month ('yyyy-MM'). */
export async function payslip(id: number, ym: string) {
  const first = monthStart(mustParse(`${ym}-01`, 'month'));
  if (first > today()) throw new UserError('That month has not started yet.');
  const lines = await computePay(first, await process(first, addDays(addMonths(first, 1), -1), null, id));
  if (!lines.length) throw new UserError('No salary data for this month.');
  return { buffer: await salarySlip(lines, first), name: `Salary_Slip_${fmt(first, 'yyyy_MM')}_${lines[0].employee.EnrollNo}.pdf` };
}

/** Month-by-month pay of one employee for the months of [from, to] that have started. */
async function payMonths(id: number, from: DT, to: DT) {
  const out = [];
  for (let m = monthStart(from); m <= to && m <= today(); m = addMonths(m, 1)) {
    const l = (await computePay(m, await process(m, addDays(addMonths(m, 1), -1), null, id)))[0];
    if (!l) continue;
    out.push({
      month: fmt(m, 'MMM yyyy'), key: fmt(m, 'yyyy-MM'), days: l.monthDays, paidDays: num(l.summary.PaidDays), payableDays: num(l.payableDays),
      salary: l.employee.MonthlySalary, deductions: l.totalDeductions, ot: l.otAmount, net: l.netPay, present: num(l.summary.Present),
      absent: num(l.summary.Absent), leave: num(l.summary.Leave), late: l.summary.LateCount,
    });
  }
  return out;
}

export async function yearly(id: number, y: number) {
  const rows = await payMonths(id, make(y, 1, 1), make(y, 12, 1));
  const sum = (k: 'salary' | 'deductions' | 'ot' | 'net') => rows.reduce((a, r) => a + r[k], 0);
  return { year: y, rows, total: { salary: sum('salary'), deductions: sum('deductions'), ot: sum('ot'), net: sum('net') } };
}

/** Financial year (April–March) earnings, for the income tax declaration. */
export async function tax(id: number, fyStart?: number) {
  const t = today();
  const fy = fyStart ?? (month(t) >= 4 ? year(t) : year(t) - 1);
  const rows = await payMonths(id, make(fy, 4, 1), make(fy + 1, 3, 1));
  return {
    fy: `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`, rows, gross: rows.reduce((a, r) => a + r.net, 0),
    reimbursed: await requests.reimbursedBetween(id, `${fy}-04-01`, `${fy + 1}-04-01`),
  };
}
