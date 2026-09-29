/** Monthly pay, salary sheet and yearly leave balance (PayrollService.cs of the Windows program). */
import { query } from '../config/db';
import {
  FALLBACK_SHIFT, loadEmployees, loadHolidays, loadLeaveTypes, loadShifts, LEAVE_COLUMNS, toLeave, workMinutes,
  type Employee, type ReportResult, type Shift,
} from '../models';
import { daysInMonth, fmt, make, month, parse, sqlD, sqlDT, year, type DT } from '../utils/time';
import { EMPTY_PROFILE, getProfiles, type Profile } from './profile.service';
import { advanceInstallments, breakdown, loadComponents, loadOverrides, loadStatutory, type Line } from './salaryStructure.service';
import { hm, leaveDays, summarize, type DayRecord, type MonthlySummary } from './attendance.service';
import { money, num, round2 } from '../utils/format';
import { lateCutDays, loadPayrollRules } from './settings.service';


export interface PayLine {
  employee: Employee;
  shift: Shift | null;
  summary: MonthlySummary;
  monthDays: number;
  perDay: number;
  unpaidDays: number;
  unpaidDeduction: number;
  lateCutDays: number;
  lateDeduction: number;
  salary: number;
  otRate: number;
  /** OT paid: all overtime, or only the approved hours when overtime needs approval. */
  paidOtMinutes: number;
  otAmount: number;
  netPay: number;
  remark: string;
  payableDays: number;
  totalDeductions: number;
  grossEarnings: number;
  /** Salary structure: full-month earnings (add up to the monthly salary). */
  earnings: Line[];
  /** PF, ESI, PT, TDS, advance recovery and fixed deduction components. */
  otherDeductions: Line[];
  pf: number; esi: number; pt: number; tds: number; advance: number;
  pfWages: number; esiWages: number; employerPf: number; employerEsi: number;
  profile: Profile;
}

/**
 * Per day = salary ÷ days in the month. Salary = monthly salary − unpaid days × per day − late cut × per day, where unpaid
 * days = month days − paid days. OT = OT hours × rate; rate 0 on the employee = per day ÷ shift hours × OT multiplier.
 * Then the statutory deductions on the earned salary: PF on the earned Basic (up to the wage cap), ESI on earned salary + OT
 * when the monthly salary is within the ESI ceiling, Professional Tax above its threshold, the employee's monthly TDS,
 * advance installments and fixed deduction components. Net = salary + OT − those deductions.
 */
export async function computePay(first: DT, days: DayRecord[]): Promise<PayLine[]> {
  const rules = await loadPayrollRules();
  const stat = await loadStatutory();
  const monthDays = daysInMonth(year(first), month(first));
  const ids = [...new Set(days.map((d) => d.EmployeeId))];
  const emps = new Map((await loadEmployees({ activeOnly: false })).filter((e) => ids.includes(e.Id)).map((e) => [e.Id, e]));
  const shifts = new Map((await loadShifts()).map((s) => [s.Id, s]));
  const comps = await loadComponents();
  const overrides = await loadOverrides(ids);
  const profiles = await getProfiles(ids);
  const advances = stat.advanceRecovery ? await advanceInstallments(ids, year(first), month(first)) : new Map<number, number>();
  const approvedOt = rules.otRequiresApproval ? await approvedOvertime(ids, days) : null;

  return summarize(days).map((s) => {
    const e = emps.get(s.EmployeeId)!;
    const shift = (e.ShiftId && shifts.get(e.ShiftId)) || null;
    const perDay = e.MonthlySalary / monthDays;
    const unpaidDays = Math.max(0, monthDays - s.PaidDays);
    const lateCut = lateCutDays(rules, s.LateCount);
    const unpaidDeduction = round2(perDay * unpaidDays);
    const lateDeduction = Math.min(round2(perDay * lateCut), e.MonthlySalary - unpaidDeduction);
    const salary = e.MonthlySalary - unpaidDeduction - lateDeduction;
    const shiftHours = workMinutes(shift ?? FALLBACK_SHIFT) / 60;
    const otRate = e.OtRatePerHour > 0 ? e.OtRatePerHour : shiftHours > 0 ? round2((perDay / shiftHours) * rules.otMultiplier) : 0;
    const paidOtMinutes = approvedOt
      ? days.filter((d) => d.EmployeeId === e.Id).reduce((a, d) => a + Math.min(d.OvertimeMinutes, approvedOt.get(`${e.Id}|${d.Date}`) ?? 0), 0)
      : s.OvertimeMinutes;
    const otAmount = round2((paidOtMinutes / 60) * otRate);

    // Salary structure and statutory deductions on what was earned this month.
    const profile = profiles.get(e.Id) ?? EMPTY_PROFILE;
    const b = breakdown(e.MonthlySalary, comps, overrides.get(e.Id));
    const earnedRatio = e.MonthlySalary > 0 ? salary / e.MonthlySalary : 0;
    const earnedBasic = round2(b.basic * earnedRatio);
    const pfWages = stat.pfEnabled && profile.PfApplicable ? (stat.pfWageCap > 0 ? Math.min(earnedBasic, stat.pfWageCap) : earnedBasic) : 0;
    const pf = Math.round((pfWages * stat.pfPct) / 100);
    const employerPf = Math.round((pfWages * stat.pfEmployerPct) / 100);
    const esiWages = stat.esiEnabled && profile.EsiApplicable && e.MonthlySalary <= stat.esiCeiling ? round2(salary + otAmount) : 0;
    const esi = Math.ceil(round2((esiWages * stat.esiPct) / 100));
    const employerEsi = Math.ceil(round2((esiWages * stat.esiEmployerPct) / 100));
    const pt = stat.ptEnabled && profile.PtApplicable && salary + otAmount > stat.ptThreshold ? stat.ptAmount : 0;
    const tds = profile.TdsMonthly;
    const advance = advances.get(e.Id) ?? 0;
    const lines: Line[] = [
      ...(pf ? [{ id: -1, name: `Provident Fund (${num(stat.pfPct)}%)`, amount: pf }] : []),
      ...(esi ? [{ id: -2, name: `ESI (${stat.esiPct}%)`, amount: esi }] : []),
      ...(pt ? [{ id: -3, name: 'Professional Tax', amount: pt }] : []),
      ...(tds ? [{ id: -4, name: 'TDS (Income Tax)', amount: tds }] : []),
      ...(advance ? [{ id: -5, name: 'Advance / Loan recovery', amount: advance }] : []),
      ...(e.MonthlySalary > 0 ? b.deductions : []),
    ];
    // Never more than what is paid this month.
    let room = round2(salary + otAmount);
    const otherDeductions = lines.map((l) => {
      const amount = Math.min(l.amount, Math.max(0, room));
      room = round2(room - amount);
      return { ...l, amount };
    }).filter((l) => l.amount > 0);
    const other = round2(otherDeductions.reduce((a, l) => a + l.amount, 0));

    const remark: string[] = [];
    if (e.MonthlySalary === 0) remark.push('Salary not set (Employees → Addition)');
    if (lateCut > 0) remark.push(`${s.LateCount} late = ${num(lateCut)} day(s) deducted`);
    if (s.Leave > s.PaidLeave) remark.push(`${num(s.Leave - s.PaidLeave)} day(s) of leave unpaid`);
    if (s.PendingLeave > 0) remark.push(`${num(s.PendingLeave)} day(s) of leave PENDING: approve it, counted as absent for now`);
    if (approvedOt && paidOtMinutes < s.OvertimeMinutes) remark.push(`${hm(s.OvertimeMinutes - paidOtMinutes)} h overtime not approved`);

    return {
      employee: e, shift, summary: s, monthDays, perDay, unpaidDays, unpaidDeduction, lateCutDays: lateCut, lateDeduction, salary,
      otRate, paidOtMinutes, otAmount, netPay: round2(salary + otAmount - other), remark: remark.join('; '),
      payableDays: Math.max(0, s.PaidDays - lateCut), totalDeductions: round2(unpaidDeduction + lateDeduction + other),
      grossEarnings: e.MonthlySalary + otAmount, earnings: b.earnings, otherDeductions,
      pf, esi, pt, tds, advance, pfWages, esiWages, employerPf, employerEsi, profile,
    };
  });
}

/** Approved overtime per employee and day (EmployeeRequests, Type Overtime, Amount = hours) in minutes, keyed `${employeeId}|${date}`. */
async function approvedOvertime(employeeIds: number[], days: DayRecord[]) {
  const out = new Map<string, number>();
  if (!employeeIds.length || !days.length) return out;
  const from = days.reduce((m, d) => Math.min(m, d.Date), Infinity), to = days.reduce((m, d) => Math.max(m, d.Date), -Infinity);
  const rows = await query(`SELECT EmployeeId, CONVERT(varchar(10), RequestDate, 120) d, CAST(Amount AS float) h FROM EmployeeRequests
    WHERE Type = 'Overtime' AND Status = 1 AND RequestDate >= @f AND RequestDate <= @t AND EmployeeId IN (SELECT value FROM OPENJSON(@ids))`,
  { f: sqlD(from), t: sqlD(to), ids: employeeIds });
  for (const r of rows) {
    const k = `${r.EmployeeId}|${parse(r.d)}`;
    out.set(k, (out.get(k) ?? 0) + Math.round(r.h * 60));
  }
  return out;
}

export async function salarySheet(title: string, period: string, first: DT, days: DayRecord[]): Promise<ReportResult> {
  const rules = await loadPayrollRules();
  const lines = await computePay(first, days);
  const monthDays = daysInMonth(year(first), month(first));
  const columns = ['Emp ID', 'Name', 'Department', 'Monthly Salary', 'Month Days', 'Paid Days', 'Late Days', 'Late Cut Days',
    'Payable Days', 'Per Day', 'Salary', 'OT Hrs', 'OT Rate/Hr', 'OT Amount', 'PF / ESI / PT / TDS / Other', 'Net Pay', 'Remark'];
  const other = (l: PayLine) => l.otherDeductions.reduce((a, x) => a + x.amount, 0);
  const rows: (string | number)[][] = lines.map((l) => [l.summary.EnrollNo, l.summary.Name, l.summary.Department,
    money(l.employee.MonthlySalary), l.monthDays, num(l.summary.PaidDays), l.summary.LateCount, num(l.lateCutDays),
    num(l.payableDays), money(round2(l.perDay)), money(l.salary), hm(l.paidOtMinutes), money(l.otRate),
    money(l.otAmount), money(other(l)), money(l.netPay), l.remark]);
  const sum = (f: (l: PayLine) => number) => lines.reduce((a, l) => a + f(l), 0);
  if (rows.length) rows.push(['', 'TOTAL', '', '', '', '', '', '', '', '', money(sum((l) => l.salary)), '', '',
    money(sum((l) => l.otAmount)), money(sum(other)), money(sum((l) => l.netPay)), '']);
  const rule = rules.lateCountForHalfDay > 0 ? `every ${rules.lateCountForHalfDay} late = ½ day deducted` : 'late deduction off';
  const mult = String(Math.round(rules.otMultiplier * 100) / 100);
  return { title, subtitle: `${period}   (Per day = Salary ÷ ${monthDays}; ${rule}; OT × ${mult})`, columns, rows, statusColumns: [] };
}

/** Payroll register: the salary structure, earned amounts and every deduction per employee. */
export async function payrollRegister(title: string, period: string, first: DT, days: DayRecord[]): Promise<ReportResult> {
  const lines = await computePay(first, days);
  const earnNames = [...new Set(lines.flatMap((l) => l.earnings.map((e) => e.name)))];
  const dedNames = [...new Set(lines.flatMap((l) => l.otherDeductions.map((e) => e.name)))];
  const columns = ['Emp ID', 'Name', 'Department', 'Payable Days', ...earnNames, 'Gross (month)', 'Absent / Unpaid', 'Late Cut', 'Earned',
    'OT Amount', ...dedNames, 'Total Deductions', 'Net Pay'];
  const amountOf = (list: Line[], name: string) => list.filter((x) => x.name === name).reduce((a, x) => a + x.amount, 0);
  const rows: (string | number)[][] = lines.map((l) => [l.summary.EnrollNo, l.summary.Name, l.summary.Department, num(l.payableDays),
    ...earnNames.map((n) => money(amountOf(l.earnings, n))), money(l.employee.MonthlySalary), money(l.unpaidDeduction), money(l.lateDeduction),
    money(l.salary), money(l.otAmount), ...dedNames.map((n) => money(amountOf(l.otherDeductions, n))), money(l.totalDeductions), money(l.netPay)]);
  if (rows.length) {
    const sum = (f: (l: PayLine) => number) => money(lines.reduce((a, l) => a + f(l), 0));
    rows.push(['', 'TOTAL', '', '', ...earnNames.map((n) => sum((l) => amountOf(l.earnings, n))), sum((l) => l.employee.MonthlySalary),
      sum((l) => l.unpaidDeduction), sum((l) => l.lateDeduction), sum((l) => l.salary), sum((l) => l.otAmount),
      ...dedNames.map((n) => sum((l) => amountOf(l.otherDeductions, n))), sum((l) => l.totalDeductions), sum((l) => l.netPay)]);
  }
  return { title, subtitle: period, columns, rows, statusColumns: [] };
}

/** Bank transfer statement: net pay with the bank account of each employee (for the bank's bulk upload). */
export async function bankTransfer(title: string, period: string, first: DT, days: DayRecord[]): Promise<ReportResult> {
  const lines = (await computePay(first, days)).filter((l) => l.netPay > 0);
  const columns = ['Sr', 'Emp ID', 'Name', 'Account Holder', 'Bank', 'Account No', 'IFSC', 'Net Pay', 'Remark'];
  const rows: (string | number)[][] = lines.map((l, i) => {
    const p = l.profile;
    const missing = !p.BankAccount || !p.BankIfsc;
    return [i + 1, l.summary.EnrollNo, l.summary.Name, p.AccountHolder || l.summary.Name, p.BankName, p.BankAccount, p.BankIfsc,
      money(l.netPay), missing ? 'Bank details missing (Employees → HR Profile)' : `Salary ${fmt(first, 'MMM yyyy')}`];
  });
  if (rows.length) rows.push(['', '', 'TOTAL', '', '', '', '', money(lines.reduce((a, l) => a + l.netPay, 0)), `${lines.length} employee(s)`]);
  return { title, subtitle: period, columns, rows, statusColumns: [] };
}

/** PF / ESI / PT / TDS of the month, employee and employer share. */
export async function statutoryReport(title: string, period: string, first: DT, days: DayRecord[]): Promise<ReportResult> {
  const lines = await computePay(first, days);
  const columns = ['Emp ID', 'Name', 'UAN', 'PF No', 'ESI No', 'PAN', 'Earned', 'PF Wages', 'PF (Employee)', 'PF (Employer)', 'ESI Wages',
    'ESI (Employee)', 'ESI (Employer)', 'Prof. Tax', 'TDS'];
  const rows: (string | number)[][] = lines.map((l) => [l.summary.EnrollNo, l.summary.Name, l.profile.Uan, l.profile.PfNo, l.profile.EsiNo,
    l.profile.Pan, money(l.salary), money(l.pfWages), money(l.pf), money(l.employerPf), money(l.esiWages), money(l.esi), money(l.employerEsi),
    money(l.pt), money(l.tds)]);
  if (rows.length) {
    const sum = (f: (l: PayLine) => number) => money(lines.reduce((a, l) => a + f(l), 0));
    rows.push(['', 'TOTAL', '', '', '', '', sum((l) => l.salary), sum((l) => l.pfWages), sum((l) => l.pf), sum((l) => l.employerPf),
      sum((l) => l.esiWages), sum((l) => l.esi), sum((l) => l.employerEsi), sum((l) => l.pt), sum((l) => l.tds)]);
  }
  const s = await loadStatutory();
  const on = [s.pfEnabled && `PF ${s.pfPct}%`, s.esiEnabled && `ESI ${s.esiPct}%`, s.ptEnabled && `PT Rs. ${s.ptAmount}`].filter(Boolean).join(', ');
  return { title, subtitle: `${period}   (${on || 'PF / ESI / PT are turned off in Salary Rule'})`, columns, rows, statusColumns: [] };
}

/** Leave taken per type in a year (holidays / weekly offs inside a leave are not counted) against the yearly quota. */
export async function leaveBalance(title: string, y: number, departmentId: number | null, employeeId: number | null): Promise<ReportResult> {
  const types = await loadLeaveTypes();
  const typeMap = new Map(types.map((t) => [t.Id, t]));
  const emps = await loadEmployees({ departmentId, employeeId });
  const shifts = new Map((await loadShifts()).map((s) => [s.Id, s]));
  const start = make(y, 1, 1), end = make(y, 12, 31);
  const all = emps.length
    ? (await query(`SELECT ${LEAVE_COLUMNS} FROM LeaveEntries l WHERE l.EmployeeId IN (SELECT value FROM OPENJSON(@ids))
        AND l.FromDate <= CONVERT(datetime2, @e, 120) AND l.ToDate >= CONVERT(datetime2, @s, 120)`,
      { ids: emps.map((e) => e.Id), s: sqlDT(start), e: sqlDT(end) })).map((r) => toLeave(r, typeMap))
    : [];
  const holidays = new Set((await loadHolidays(start, end)).keys());

  const columns = ['Emp ID', 'Name', 'Department'];
  for (const lt of types) {
    if (lt.YearlyQuota > 0) columns.push(`${lt.Code} Quota`, `${lt.Code} Taken`, `${lt.Code} Balance`);
    else columns.push(`${lt.Code} Taken`);
  }
  columns.push('Over quota (LWP)', 'Pending (not approved)');

  const rows = emps.map((e) => {
    const shift = (e.ShiftId && shifts.get(e.ShiftId)) || null;
    const daysOf = (status: number, typeId?: number) => all
      .filter((l) => l.EmployeeId === e.Id && l.Status === status && (typeId === undefined || l.LeaveTypeId === typeId))
      .flatMap((l) => leaveDays(l, shift, holidays)).filter((x) => year(x.date) === y).reduce((a, x) => a + x.days, 0);
    const row: (string | number)[] = [e.EnrollNo, e.Name, e.DepartmentName ?? ''];
    let over = 0;
    for (const lt of types) {
      const taken = daysOf(1, lt.Id);
      if (lt.YearlyQuota > 0) {
        row.push(num(lt.YearlyQuota), num(taken), num(Math.max(0, lt.YearlyQuota - taken)));
        over += Math.max(0, taken - lt.YearlyQuota);
      } else row.push(num(taken));
    }
    row.push(num(over), num(daysOf(0)));
    return row;
  });
  return { title, subtitle: `Year ${y}  (approved leave only, including future approved leave)`, columns, rows, statusColumns: [] };
}

/** Quota and approved days of one leave type in a year (for the quota warning when a leave is approved). */
export async function leaveQuota(employeeId: number, leaveTypeId: number, y: number, excludeLeaveId: number | null) {
  const type = (await loadLeaveTypes()).find((t) => t.Id === leaveTypeId);
  const emp = (await loadEmployees({ employeeId, activeOnly: false }))[0];
  if (!type || !emp) return { quota: 0, taken: 0 };
  const shift = emp.ShiftId ? (await loadShifts()).find((s) => s.Id === emp.ShiftId) ?? null : null;
  const start = make(y, 1, 1), end = make(y, 12, 31);
  const holidays = new Set((await loadHolidays(start, end)).keys());
  const rows = await query(`SELECT ${LEAVE_COLUMNS} FROM LeaveEntries l WHERE l.EmployeeId = @emp AND l.LeaveTypeId = @lt
    AND l.FromDate <= CONVERT(datetime2, @e, 120) AND l.ToDate >= CONVERT(datetime2, @s, 120) AND l.Status = 1 AND l.Id <> @ex`,
    { emp: employeeId, lt: leaveTypeId, s: sqlDT(start), e: sqlDT(end), ex: excludeLeaveId ?? 0 });
  const taken = rows.map((r) => toLeave(r)).flatMap((l) => leaveDays(l, shift, holidays))
    .filter((x) => year(x.date) === y).reduce((a, x) => a + x.days, 0);
  return { quota: type.YearlyQuota, taken, type, emp, shift, holidays };
}

