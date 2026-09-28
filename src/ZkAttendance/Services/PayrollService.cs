using System.Data;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using ZkAttendance.Data;

namespace ZkAttendance.Services;

/// <summary>Company-wide salary rules (Salary Rule dialog), stored in AppSettings.</summary>
public record PayrollRules(int LateCountForHalfDay, decimal OtMultiplier)
{
    public const int DefaultLateCount = 3;

    public static PayrollRules Load() => new(
        int.TryParse(AppDbContext.GetSetting("Payroll.LateCountForHalfDay"), out var n) ? n : DefaultLateCount,
        decimal.TryParse(AppDbContext.GetSetting("Payroll.OtMultiplier"), NumberStyles.Number, CultureInfo.InvariantCulture, out var m) ? m : 1m);

    public void Save()
    {
        AppDbContext.SetSetting("Payroll.LateCountForHalfDay", LateCountForHalfDay.ToString());
        AppDbContext.SetSetting("Payroll.OtMultiplier", OtMultiplier.ToString(CultureInfo.InvariantCulture));
    }

    /// <summary>Salary days cut for late arrivals: every N late days = half a day.</summary>
    public double LateCutDays(int lateDays) => LateCountForHalfDay > 0 ? lateDays / LateCountForHalfDay * 0.5 : 0;
}

/// <summary>Monthly salary sheet and yearly leave balance.</summary>
public static class PayrollService
{
    private static readonly CultureInfo India = CultureInfo.GetCultureInfo("en-IN");

    public static string Money(decimal v) => v.ToString("#,##0.00", India);

    /// <summary>
    /// Monthly salary: per day = salary ÷ days in the month; pay = per day × (paid days − late cut).
    /// OT = OT hours × rate; rate 0 on the employee = per day ÷ shift hours × OT multiplier.
    /// </summary>
    public static ReportResult SalarySheet(string title, string period, DateTime monthStart, List<DayRecord> days)
    {
        var rules = PayrollRules.Load();
        int monthDays = DateTime.DaysInMonth(monthStart.Year, monthStart.Month);
        var ids = days.Select(d => d.EmployeeId).Distinct().ToList();
        Dictionary<int, Employee> emps;
        using (var db = new AppDbContext())
            emps = db.Employees.AsNoTracking().Include(e => e.Shift).Where(e => ids.Contains(e.Id)).ToDictionary(e => e.Id);

        var t = new DataTable();
        foreach (var c in new[] { "Emp ID", "Name", "Department", "Monthly Salary", "Month Days", "Paid Days", "Late Days",
                     "Late Cut Days", "Payable Days", "Per Day", "Salary", "OT Hrs", "OT Rate/Hr", "OT Amount", "Net Pay", "Remark" })
            t.Columns.Add(c);

        decimal totalSalary = 0, totalOt = 0, totalNet = 0;
        foreach (var s in AttendanceProcessor.Summarize(days))
        {
            var e = emps[s.EmployeeId];
            decimal perDay = e.MonthlySalary / monthDays;
            double lateCut = rules.LateCutDays(s.LateCount);
            double payable = Math.Max(0, s.PaidDays - lateCut);
            decimal salary = Math.Round(perDay * (decimal)payable, 2);

            double shiftHours = (e.Shift ?? new Shift()).Duration.TotalHours;
            decimal otRate = e.OtRatePerHour > 0 ? e.OtRatePerHour
                : shiftHours > 0 ? Math.Round(perDay / (decimal)shiftHours * rules.OtMultiplier, 2) : 0;
            decimal otHours = s.OvertimeMinutes / 60m;
            decimal otAmount = Math.Round(otHours * otRate, 2);
            decimal net = salary + otAmount;
            totalSalary += salary; totalOt += otAmount; totalNet += net;

            var remark = new List<string>();
            if (e.MonthlySalary == 0) remark.Add("Salary set nahi hai (Employees → Addition)");
            if (lateCut > 0) remark.Add($"{s.LateCount} late = {Num(lateCut)} din cut");
            if (s.Leave > s.PaidLeave) remark.Add($"{Num(s.Leave - s.PaidLeave)} din leave bina paise");
            if (s.PendingLeave > 0) remark.Add($"{Num(s.PendingLeave)} din leave PENDING: approve karein, abhi absent gine");

            t.Rows.Add(s.EnrollNo, s.Name, s.Department, Money(e.MonthlySalary), monthDays, Num(s.PaidDays), s.LateCount,
                Num(lateCut), Num(payable), Money(Math.Round(perDay, 2)), Money(salary),
                AttendanceProcessor.Hm(s.OvertimeMinutes), Money(otRate), Money(otAmount), Money(net), string.Join("; ", remark));
        }
        if (t.Rows.Count > 0)
            t.Rows.Add("", "TOTAL", "", "", "", "", "", "", "", "", Money(totalSalary), "", "", Money(totalOt), Money(totalNet), "");

        var rule = rules.LateCountForHalfDay > 0 ? $"har {rules.LateCountForHalfDay} late = ½ din cut" : "late cut band";
        return new ReportResult { Title = title, Subtitle = $"{period}   (Per day = Salary ÷ {monthDays}; {rule}; OT × {rules.OtMultiplier:0.##})", Table = t };
    }

    /// <summary>Leave taken per type in a year (holidays / weekly offs inside a leave are not counted) against the yearly quota.</summary>
    public static ReportResult LeaveBalance(string title, int year, int? departmentId, int? employeeId)
    {
        using var db = new AppDbContext();
        var types = db.LeaveTypes.AsNoTracking().OrderBy(x => x.Code).ToList();
        var q = db.Employees.AsNoTracking().Include(e => e.Department).Include(e => e.Shift).Where(e => e.IsActive);
        if (departmentId != null) q = q.Where(e => e.DepartmentId == departmentId);
        if (employeeId != null) q = q.Where(e => e.Id == employeeId);
        var emps = q.AsEnumerable().OrderBy(e => AttendanceProcessor.SortKey(e.EnrollNo)).ToList();
        var ids = emps.Select(e => e.Id).ToList();
        var (start, end) = (new DateTime(year, 1, 1), new DateTime(year, 12, 31));
        var all = db.LeaveEntries.AsNoTracking().Where(l => ids.Contains(l.EmployeeId) && l.FromDate <= end && l.ToDate >= start).ToList();
        var leaves = all.Where(l => l.Status == LeaveStatus.Approved).ToList();
        var pending = all.Where(l => l.Status == LeaveStatus.Pending).ToList();
        var holidays = Holidays(db, start, end);

        var t = new DataTable();
        foreach (var c in new[] { "Emp ID", "Name", "Department" }) t.Columns.Add(c);
        foreach (var lt in types)
        {
            if (lt.YearlyQuota > 0) { t.Columns.Add($"{lt.Code} Quota"); t.Columns.Add($"{lt.Code} Taken"); t.Columns.Add($"{lt.Code} Balance"); }
            else t.Columns.Add($"{lt.Code} Taken");
        }
        t.Columns.Add("Over quota (LWP)");
        t.Columns.Add("Pending (not approved)");

        foreach (var e in emps)
        {
            var row = new List<object> { e.EnrollNo, e.Name, e.Department?.Name ?? "" };
            double over = 0;
            foreach (var lt in types)
            {
                double taken = leaves.Where(l => l.EmployeeId == e.Id && l.LeaveTypeId == lt.Id)
                    .SelectMany(l => AttendanceProcessor.LeaveDays(l, e.Shift, holidays)).Where(x => x.Date.Year == year).Sum(x => x.Days);
                if (lt.YearlyQuota > 0)
                {
                    row.AddRange([Num(lt.YearlyQuota), Num(taken), Num(Math.Max(0, lt.YearlyQuota - taken))]);
                    over += Math.Max(0, taken - lt.YearlyQuota);
                }
                else row.Add(Num(taken));
            }
            row.Add(Num(over));
            row.Add(Num(pending.Where(l => l.EmployeeId == e.Id)
                .SelectMany(l => AttendanceProcessor.LeaveDays(l, e.Shift, holidays)).Where(x => x.Date.Year == year).Sum(x => x.Days)));
            t.Rows.Add(row.ToArray());
        }
        return new ReportResult { Title = title, Subtitle = $"Year {year}  (sirf Approved leave; aage ki approved leave bhi shamil hai)", Table = t };
    }

    /// <summary>Quota and approved days (whole year, planned leave included) of one leave type, for the quota warning.</summary>
    public static (double quota, double taken) Balance(int employeeId, int leaveTypeId, int year, int? excludeLeaveId = null)
    {
        using var db = new AppDbContext();
        var type = db.LeaveTypes.AsNoTracking().First(x => x.Id == leaveTypeId);
        var emp = db.Employees.AsNoTracking().Include(e => e.Shift).First(e => e.Id == employeeId);
        var (start, end) = (new DateTime(year, 1, 1), new DateTime(year, 12, 31));
        var holidays = Holidays(db, start, end);
        double taken = db.LeaveEntries.AsNoTracking()
            .Where(l => l.EmployeeId == employeeId && l.LeaveTypeId == leaveTypeId && l.FromDate <= end && l.ToDate >= start &&
                        l.Status == LeaveStatus.Approved && l.Id != (excludeLeaveId ?? 0)).AsEnumerable()
            .SelectMany(l => AttendanceProcessor.LeaveDays(l, emp.Shift, holidays)).Where(x => x.Date.Year == year).Sum(x => x.Days);
        return (type.YearlyQuota, taken);
    }

    /// <summary>Working days a new leave would use (holidays and the employee's weekly offs excluded).</summary>
    public static double DaysFor(LeaveEntry leave)
    {
        using var db = new AppDbContext();
        var emp = db.Employees.AsNoTracking().Include(e => e.Shift).First(e => e.Id == leave.EmployeeId);
        return AttendanceProcessor.LeaveDays(leave, emp.Shift, Holidays(db, leave.FromDate, leave.ToDate)).Sum(x => x.Days);
    }

    private static HashSet<DateTime> Holidays(AppDbContext db, DateTime from, DateTime to) =>
        db.Holidays.AsNoTracking().Where(h => h.Date >= from && h.Date <= to).Select(h => h.Date).AsEnumerable().Select(d => d.Date).ToHashSet();

    private static string Num(double v) => v % 1 == 0 ? v.ToString("0") : v.ToString("0.0");
}
