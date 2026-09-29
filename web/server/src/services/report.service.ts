/** Attendance reports (ReportService.cs of the Windows program); pay and leave balance are in payroll.service. */
import { byEnroll, type ReportResult } from '../models';
import { num } from '../utils/format';
import { UserError } from '../utils/errors';
import { addDays, addMonths, fmt, monthStart, year, type DT } from '../utils/time';
import { one, query } from '../config/db';
import { excel, pdf, salarySlip } from './export.service';
import { hm, process, summarize, Status, type DayRecord } from './attendance.service';
import * as compoff from './compoff.service';
import { bankTransfer, computePay, leaveBalance, payrollRegister, salarySheet, statutoryReport } from './payroll.service';
import { adminList } from './employeeRequest.service';
import { sqlD, today } from '../utils/time';

export type { ReportResult };

export type ReportKind =
  | 'DailyAttendance' | 'AttendanceRegister' | 'MonthlyMuster' | 'MonthlySummary' | 'LateArrival' | 'EarlyDeparture'
  | 'Overtime' | 'Absent' | 'PunchLog' | 'SalarySheet' | 'LeaveBalance' | 'DepartmentSummary' | 'PayrollRegister' | 'BankTransfer'
  | 'Statutory' | 'Requests' | 'CompOff';

/** kind, name, monthly (the "From" picker is a month), yearly, single date */
export const CATALOG: { kind: ReportKind; name: string; period: 'date' | 'range' | 'month' | 'year' }[] = [
  { kind: 'DailyAttendance', name: 'Daily Attendance', period: 'date' },
  { kind: 'AttendanceRegister', name: 'Attendance Register (Date Range)', period: 'range' },
  { kind: 'MonthlyMuster', name: 'Monthly Muster Roll', period: 'month' },
  { kind: 'MonthlySummary', name: 'Monthly Summary / Payroll Days', period: 'month' },
  { kind: 'LateArrival', name: 'Late Arrival Report', period: 'range' },
  { kind: 'EarlyDeparture', name: 'Early Departure Report', period: 'range' },
  { kind: 'Overtime', name: 'Overtime Report', period: 'range' },
  { kind: 'Absent', name: 'Absent Report', period: 'range' },
  { kind: 'PunchLog', name: 'Punch Log (All Punches)', period: 'range' },
  { kind: 'SalarySheet', name: 'Salary Sheet (Monthly Pay)', period: 'month' },
  { kind: 'LeaveBalance', name: 'Leave Balance (Yearly)', period: 'year' },
  { kind: 'DepartmentSummary', name: 'Department-wise Attendance', period: 'range' },
  { kind: 'PayrollRegister', name: 'Payroll Register (Salary Structure)', period: 'month' },
  { kind: 'BankTransfer', name: 'Bank Transfer Statement', period: 'month' },
  { kind: 'Statutory', name: 'PF / ESI / PT / TDS Report', period: 'month' },
  { kind: 'Requests', name: 'Approvals: Regularisation / Overtime / Comp-off / Claims', period: 'range' },
  { kind: 'CompOff', name: 'Comp-off Balance', period: 'date' },
];


export async function buildReport(kind: ReportKind, from: DT, to: DT, departmentId: number | null, employeeId: number | null): Promise<ReportResult> {
  const entry = CATALOG.find((c) => c.kind === kind);
  if (!entry) throw new UserError('Unknown report');
  if (kind === 'LeaveBalance') return leaveBalance(entry.name, year(from), departmentId, employeeId);
  if (kind === 'Requests') return requestsReport(entry.name, from, to, departmentId, employeeId);
  if (kind === 'CompOff') return compOffReport(entry.name, departmentId, employeeId);
  if (kind === 'DailyAttendance') to = from;
  if (entry.period === 'month') {
    from = monthStart(from);
    to = addDays(addMonths(from, 1), -1);
  }
  if (entry.period === 'range') {
    if (to < from) throw new UserError("The 'To' date is before the 'From' date.");
    if ((to - from) / 86_400_000 > 400) throw new UserError('A report can cover at most 400 days at a time.');
  }

  const days = await process(from, to, departmentId, employeeId);
  const period = kind === 'DailyAttendance' ? fmt(from, 'dddd, dd MMM yyyy')
    : entry.period === 'month' ? fmt(from, 'MMMM yyyy') : `${fmt(from, 'dd MMM yyyy')} to ${fmt(to, 'dd MMM yyyy')}`;
  const name = entry.name;

  switch (kind) {
    case 'DailyAttendance': return daily(name, period, days, false);
    case 'AttendanceRegister': return daily(name, period, days, true);
    case 'MonthlyMuster': return muster(name, period, days, from, to);
    case 'MonthlySummary': return summaryReport(name, period, days);
    case 'LateArrival': return daily(name, period, days.filter((d) => d.LateMinutes > 0), true);
    case 'EarlyDeparture': return daily(name, period, days.filter((d) => d.EarlyMinutes > 0), true);
    case 'Overtime': return daily(name, period, days.filter((d) => d.OvertimeMinutes > 0), true);
    case 'Absent': return daily(name, period, days.filter((d) => d.Status === Status.Absent), true);
    case 'SalarySheet': return salarySheet(name, period, from, days);
    case 'PayrollRegister': return payrollRegister(name, period, from, days);
    case 'BankTransfer': return bankTransfer(name, period, from, days);
    case 'Statutory': return statutoryReport(name, period, from, days);
    case 'DepartmentSummary': return departmentSummary(name, period, days);
    default: return punchLog(name, period, days);
  }
}

const byDateThenEnroll = (a: DayRecord, b: DayRecord) => a.Date - b.Date || byEnroll(a, b);

function daily(title: string, period: string, days: DayRecord[], withDate: boolean): ReportResult {
  const columns = [...(withDate ? ['Date'] : []), 'Emp ID', 'Name', 'Department', 'Shift', 'In', 'Out', 'Worked', 'Late', 'Early', 'OT', 'Status', 'Remark'];
  const rows = days.filter((d) => d.Status !== '' && d.Status !== Status.NotJoined).sort(byDateThenEnroll).map((d) => [
    ...(withDate ? [fmt(d.Date, 'dd-MM-yyyy ddd')] : []),
    d.EnrollNo, d.Name, d.Department, d.ShiftName, d.In !== null ? fmt(d.In, 'HH:mm') : '', d.Out !== null ? fmt(d.Out, 'HH:mm') : '',
    hm(d.WorkedMinutes), hm(d.LateMinutes), hm(d.EarlyMinutes), hm(d.OvertimeMinutes), d.Status, d.Remark,
  ]);
  return { title, subtitle: period, columns, rows, statusColumns: ['Status'] };
}

function muster(title: string, period: string, days: DayRecord[], from: DT, to: DT): ReportResult {
  const dayCols: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dayCols.push(fmt(d, 'dd'));
  const columns = ['Emp ID', 'Name', ...dayCols, 'P', 'A', 'L', 'H', 'WO', 'Late', 'OT Hrs', 'Paid Days'];
  const summaries = new Map(summarize(days).map((s) => [s.EnrollNo, s]));
  const groups = new Map<string, DayRecord[]>();
  for (const d of days) groups.set(d.EnrollNo, [...(groups.get(d.EnrollNo) ?? []), d]);
  const rows = [...groups].map(([enroll, g]) => {
    const s = summaries.get(enroll)!;
    return [enroll, g[0].Name, ...g.sort((a, b) => a.Date - b.Date).map((d) => d.Status),
      num(s.Present), num(s.Absent), num(s.Leave), s.Holidays, s.WeeklyOffs, s.LateCount, hm(s.OvertimeMinutes), num(s.PaidDays)];
  });
  return { title, subtitle: period, columns, rows, statusColumns: dayCols };
}

function summaryReport(title: string, period: string, days: DayRecord[]): ReportResult {
  const columns = ['Emp ID', 'Name', 'Department', 'Present', 'Absent', 'Leave', 'Paid Leave', 'Holidays', 'Weekly Off', 'Late Days',
    'Late Hrs', 'Early Days', 'Worked Hrs', 'OT Hrs', 'Paid Days'];
  const rows = summarize(days).map((s) => [s.EnrollNo, s.Name, s.Department, num(s.Present), num(s.Absent), num(s.Leave),
    num(s.PaidLeave), s.Holidays, s.WeeklyOffs, s.LateCount, hm(s.LateMinutes), s.EarlyCount, hm(s.WorkedMinutes),
    hm(s.OvertimeMinutes), num(s.PaidDays)]);
  return { title, subtitle: period, columns, rows, statusColumns: [] };
}

/** Per department: employees, present / absent / leave days, late days, overtime and attendance %. */
function departmentSummary(title: string, period: string, days: DayRecord[]): ReportResult {
  const groups = new Map<string, DayRecord[]>();
  for (const d of days) {
    if (d.Status === '' || d.Status === Status.NotJoined) continue;
    const k = d.Department || '(no department)';
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  const columns = ['Department', 'Employees', 'Working Days', 'Present', 'Absent', 'Leave', 'Late Days', 'Early Days', 'OT Hrs', 'Attendance %'];
  const rows = [...groups].sort((a, b) => a[0].localeCompare(b[0])).map(([name, g]) => {
    const s = summarize(g).reduce((a, x) => ({
      p: a.p + x.Present, ab: a.ab + x.Absent, l: a.l + x.Leave, pl: a.pl + x.PaidLeave, late: a.late + x.LateCount,
      early: a.early + x.EarlyCount, ot: a.ot + x.OvertimeMinutes,
    }), { p: 0, ab: 0, l: 0, pl: 0, late: 0, early: 0, ot: 0 });
    const working = g.filter((d) => d.Status !== Status.Holiday && d.Status !== Status.WeeklyOff).length;
    return [name, new Set(g.map((d) => d.EmployeeId)).size, working, num(s.p), num(s.ab), num(s.l), s.late, s.early, hm(s.ot),
      working ? `${Math.round(((s.p + s.pl) / working) * 100)}%` : ''];
  });
  return { title, subtitle: period, columns, rows, statusColumns: [] };
}

/** Requests (everything but leave) made in the period, with their decision. */
async function requestsReport(title: string, from: DT, to: DT, departmentId: number | null, employeeId: number | null): Promise<ReportResult> {
  const deptEmps = departmentId ? new Set((await query('SELECT Id FROM Employees WHERE DepartmentId = @d', { d: departmentId })).map((r) => r.Id)) : null;
  const list = (await adminList('', '')).filter((r) => r.RequestDate >= sqlD(from) && r.RequestDate <= sqlD(to)
    && (!employeeId || r.EmployeeId === employeeId) && (!deptEmps || deptEmps.has(r.EmployeeId)));
  const columns = ['Date', 'Emp ID', 'Name', 'Type', 'Details', 'Amount / Hours', 'Status', 'Decided By', 'Decided On'];
  const rows = list.map((r) => [r.Date, r.EnrollNo, r.Name, r.TypeName, [r.Category, r.Time, r.Details].filter(Boolean).join(' · '),
    r.Type === 'Overtime' ? `${r.Amount} h` : r.Type === 'CompOff' ? `${r.Amount} day` : r.AmountText, r.Status, r.DecidedBy ?? '', r.DecidedOn]);
  return { title, subtitle: `${fmt(from, 'dd MMM yyyy')} to ${fmt(to, 'dd MMM yyyy')}`, columns, rows, statusColumns: ['Status'] };
}

/** Comp-off earned, used, pending, expired and available per employee (today). */
async function compOffReport(title: string, departmentId: number | null, employeeId: number | null): Promise<ReportResult> {
  const emps = await query(`SELECT e.Id, e.EnrollNo, e.Name, d.Name Department FROM Employees e LEFT JOIN Departments d ON d.Id = e.DepartmentId
    WHERE e.IsActive = 1 AND (@d IS NULL OR e.DepartmentId = @d) AND (@e IS NULL OR e.Id = @e)`, { d: departmentId, e: employeeId });
  const rows: (string | number)[][] = [];
  let expiry = 90;
  for (const e of emps.sort(byEnroll)) {
    const b = await compoff.balance(e.Id);
    expiry = b.expiryDays;
    if (!b.earned && !b.used && !b.pending) continue;
    rows.push([e.EnrollNo, e.Name, e.Department ?? '', num(b.earned), num(b.used), num(b.pending), num(b.expired), num(b.available), b.nextExpiry]);
  }
  return {
    title, subtitle: `As on ${fmt(today(), 'dd MMM yyyy')} (credits expire after ${expiry} days)`,
    columns: ['Emp ID', 'Name', 'Department', 'Earned', 'Used', 'Pending Leave', 'Expired', 'Available', 'Next Expiry'], rows, statusColumns: [],
  };
}

function punchLog(title: string, period: string, days: DayRecord[]): ReportResult {
  const rows = days.filter((d) => d.PunchCount > 0).sort(byDateThenEnroll).map((d) => [fmt(d.Date, 'dd-MM-yyyy ddd'), d.EnrollNo,
    d.Name, d.Department, d.PunchCount, d.Punches.map((p) => fmt(p, 'HH:mm')).join('  ')]);
  return { title, subtitle: period, columns: ['Date', 'Emp ID', 'Name', 'Department', 'Count', 'Punches'], rows, statusColumns: [] };
}

/** The report as an Excel or PDF file. */
export async function reportFile(kind: ReportKind, from: DT, to: DT, departmentId: number | null, employeeId: number | null, format: 'pdf' | 'xlsx') {
  const r = await buildReport(kind, from, to, departmentId, employeeId);
  const name = `${r.title.replace(/ /g, '_').replace(/\//g, '')}_${fmt(from, 'yyyyMMdd')}`;
  return format === 'pdf' ? { buffer: await pdf(r), name: name + '.pdf' } : { buffer: await excel(r), name: name + '.xlsx' };
}

/** Salary slip PDF for the month of `from`: one employee or everybody the filters show. */
export async function salarySlipFile(from: DT, departmentId: number | null, employeeId: number | null) {
  const first = monthStart(from);
  const lines = await computePay(first, await process(first, addDays(addMonths(first, 1), -1), departmentId, employeeId));
  if (!lines.length) throw new UserError('No employees found for the selected filters.');
  const emp = employeeId ? await one('SELECT EnrollNo, Name FROM Employees WHERE Id = @id', { id: employeeId }) : null;
  const who = emp ? `${emp.EnrollNo}_${emp.Name.replace(/ /g, '_')}` : 'All';
  return { buffer: await salarySlip(lines, first), name: `Salary_Slip_${fmt(first, 'yyyy_MM')}_${who}.pdf` };
}
