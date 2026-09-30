/**
 * Live attendance dashboard: today's Present / Absent / Leave / Late … cards, department-wise attendance, late arrivals,
 * the latest punches, this month's overtime and daily trend, pending approvals, upcoming holidays and birthdays.
 */
import { one, query } from '../config/db';
import { loadHolidays } from '../models';
import { addDays, fmt, monthStart, now, parse, sqlD, sqlDT, today } from '../utils/time';
import { hm, presentValue, process, Status, summarize } from './attendance.service';

export async function dashboard() {
  const t = today();
  const days = (await process(t, t)).filter((d) => d.Status !== Status.NotJoined);
  const first = monthStart(t);
  const month = first < t ? (await process(first, t)).filter((d) => d.Status !== Status.NotJoined) : days;

  const off = (s: string) => s === Status.Holiday || s === Status.WeeklyOff;
  const cards = {
    total: days.length,
    present: days.filter((d) => d.PunchCount > 0).length,
    absent: days.filter((d) => d.PunchCount === 0 && d.Status === Status.Absent).length,
    onLeave: days.filter((d) => d.IsLeave && d.PunchCount === 0).length,
    late: days.filter((d) => d.LateMinutes > 0).length,
    earlyExit: days.filter((d) => d.EarlyMinutes > 0).length,
    halfDay: days.filter((d) => d.Status === Status.HalfDay).length,
    off: days.filter((d) => d.PunchCount === 0 && off(d.Status)).length,
    missingOut: days.filter((d) => d.PunchCount === 1).length,
    onTime: days.filter((d) => d.PunchCount > 0 && d.LateMinutes === 0 && !off(d.Status)).length,
  };

  const depts = new Map<string, { name: string; total: number; present: number; absent: number; leave: number; late: number }>();
  for (const d of days) {
    const k = d.Department || '(no department)';
    const g = depts.get(k) ?? { name: k, total: 0, present: 0, absent: 0, leave: 0, late: 0 };
    g.total++;
    if (d.PunchCount > 0) g.present++;
    else if (d.IsLeave) g.leave++;
    else if (d.Status === Status.Absent) g.absent++;
    if (d.LateMinutes > 0) g.late++;
    depts.set(k, g);
  }
  const departments = [...depts.values()].sort((a, b) => a.name.localeCompare(b.name))
    .map((g) => ({ ...g, pct: g.total ? Math.round((g.present / g.total) * 100) : 0 }));

  const late = days.filter((d) => d.LateMinutes > 0).sort((a, b) => b.LateMinutes - a.LateMinutes).map((d) => ({
    EnrollNo: d.EnrollNo, Name: d.Name, Department: d.Department, In: d.In !== null ? fmt(d.In, 'HH:mm') : '', LateBy: hm(d.LateMinutes),
  }));
  const absent = days.filter((d) => d.PunchCount === 0 && d.Status === Status.Absent).map((d) => ({
    EnrollNo: d.EnrollNo, Name: d.Name, Department: d.Department, Shift: d.ShiftName, Remark: d.Remark,
  }));

  // Latest punches of today (the AC Log feed).
  const punches = (await query(`SELECT a.EnrollNo, to_char(a.PunchTime, 'YYYY-MM-DD HH24:MI:SS') AS t, a.Source, e.Name FROM AttendanceLogs a
      LEFT JOIN LATERAL (SELECT x.Name FROM Employees x WHERE x.EnrollNo = a.EnrollNo ORDER BY x.Id LIMIT 1) e ON TRUE
    WHERE a.PunchTime >= @f AND a.PunchTime <= @n ORDER BY a.PunchTime DESC, a.Id DESC LIMIT 15`, { f: sqlDT(t), n: sqlDT(now() + 60_000) }))
    .map((r) => ({ EnrollNo: r.EnrollNo, Name: r.Name ?? '(not in software)', Time: fmt(parse(r.t)!, 'HH:mm:ss'), Source: ['Device', 'USB', 'Manual'][r.Source] ?? '' }));

  // This month: overtime per employee and present count per day.
  const summaries = summarize(month);
  const overtime = summaries.filter((s) => s.OvertimeMinutes > 0).sort((a, b) => b.OvertimeMinutes - a.OvertimeMinutes).slice(0, 10)
    .map((s) => ({ EnrollNo: s.EnrollNo, Name: s.Name, Department: s.Department, Hours: hm(s.OvertimeMinutes), Minutes: s.OvertimeMinutes }));
  const trend: { date: string; label: string; present: number; absent: number; leave: number; late: number }[] = [];
  for (let d = first; d <= t; d = addDays(d, 1)) {
    const of = month.filter((x) => x.Date === d);
    trend.push({
      date: sqlD(d), label: fmt(d, 'dd'), present: of.reduce((a, x) => a + presentValue(x), 0),
      absent: of.filter((x) => x.Status === Status.Absent).length, leave: of.filter((x) => x.IsLeave).length, late: of.filter((x) => x.LateMinutes > 0).length,
    });
  }

  const pending = await one(`SELECT (SELECT COUNT(*) FROM LeaveEntries WHERE Status = 0) leave,
    (SELECT COUNT(*) FROM EmployeeRequests r JOIN Employees e ON e.Id = r.EmployeeId WHERE r.Status = 0 AND r.Type = 'Regularisation') regularisation,
    (SELECT COUNT(*) FROM EmployeeRequests r JOIN Employees e ON e.Id = r.EmployeeId WHERE r.Status = 0 AND r.Type = 'Overtime') overtime,
    (SELECT COUNT(*) FROM EmployeeRequests r JOIN Employees e ON e.Id = r.EmployeeId WHERE r.Status = 0 AND r.Type = 'CompOff') compOff,
    (SELECT COUNT(*) FROM EmployeeRequests r JOIN Employees e ON e.Id = r.EmployeeId WHERE r.Status = 0 AND r.Type = 'Profile') profile,
    (SELECT COUNT(*) FROM EmployeeRequests r JOIN Employees e ON e.Id = r.EmployeeId WHERE r.Status = 0 AND r.Type IN ('Expense', 'Advance')) claims`);

  const hol = await loadHolidays(t, addDays(t, 45));
  const holidays = [...hol].sort((a, b) => a[0] - b[0]).slice(0, 5).map(([d, name]) => ({ date: fmt(d, 'dd MMM, ddd'), name }));
  const people = await query(`SELECT Name, to_char(BirthDate, 'YYYY-MM-DD') AS b, to_char(JoinDate, 'YYYY-MM-DD') AS j FROM Employees WHERE IsActive = TRUE`);
  const within = (iso: string | null, days: number) => {
    if (!iso) return null;
    const d = parse(iso)!;
    for (let i = 0; i <= days; i++) {
      const x = addDays(t, i);
      if (fmt(x, 'MM-dd') === fmt(d, 'MM-dd')) return { when: i === 0 ? 'Today' : fmt(x, 'dd MMM'), years: Number(fmt(x, 'yyyy')) - Number(fmt(d, 'yyyy')), i };
    }
    return null;
  };
  const birthdays = people.map((p) => ({ name: p.Name, w: within(p.b, 7) })).filter((x) => x.w).sort((a, b) => a.w!.i - b.w!.i)
    .map((x) => ({ name: x.name, when: x.w!.when }));
  const anniversaries = people.map((p) => ({ name: p.Name, w: within(p.j, 7) })).filter((x) => x.w && x.w.years > 0)
    .sort((a, b) => a.w!.i - b.w!.i).map((x) => ({ name: x.name, when: x.w!.when, years: x.w!.years }));

  return {
    date: fmt(t, 'dddd, dd MMMM yyyy'), time: fmt(now(), 'HH:mm'), cards, departments, late, absent, punches,
    month: {
      name: fmt(first, 'MMMM yyyy'), overtime, trend,
      totalOvertime: hm(summaries.reduce((a, s) => a + s.OvertimeMinutes, 0)), lateCount: summaries.reduce((a, s) => a + s.LateCount, 0),
      attendancePct: (() => {
        const working = month.filter((d) => d.Status !== '' && !off(d.Status));
        return working.length ? Math.round((working.reduce((a, d) => a + presentValue(d) + d.PaidLeaveDays, 0) / working.length) * 100) : 0;
      })(),
    },
    pending, holidays, birthdays, anniversaries,
  };
}
