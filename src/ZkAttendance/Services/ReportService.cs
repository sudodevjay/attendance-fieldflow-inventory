using System.Data;
using ZkAttendance.Data;

namespace ZkAttendance.Services;

public enum ReportKind
{
    DailyAttendance,
    AttendanceRegister,
    MonthlyMuster,
    MonthlySummary,
    LateArrival,
    EarlyDeparture,
    Overtime,
    Absent,
    PunchLog,
    SalarySheet,
    LeaveBalance
}

public class ReportResult
{
    public string Title { get; init; } = "";
    public string Subtitle { get; init; } = "";
    public DataTable Table { get; init; } = new();
    /// <summary>Columns whose values are attendance status codes (colored in grid/Excel/PDF).</summary>
    public HashSet<string> StatusColumns { get; init; } = new();
}

public static class ReportService
{
    public static readonly (ReportKind Kind, string Name, bool Monthly)[] Catalog =
    [
        (ReportKind.DailyAttendance, "Daily Attendance", false),
        (ReportKind.AttendanceRegister, "Attendance Register (Date Range)", false),
        (ReportKind.MonthlyMuster, "Monthly Muster Roll", true),
        (ReportKind.MonthlySummary, "Monthly Summary / Payroll Days", true),
        (ReportKind.LateArrival, "Late Arrival Report", false),
        (ReportKind.EarlyDeparture, "Early Departure Report", false),
        (ReportKind.Overtime, "Overtime Report", false),
        (ReportKind.Absent, "Absent Report", false),
        (ReportKind.PunchLog, "Punch Log (All Punches)", false),
        (ReportKind.SalarySheet, "Salary Sheet (Monthly Pay)", true),
        (ReportKind.LeaveBalance, "Leave Balance (Yearly)", false),
    ];

    public static ReportResult Build(ReportKind kind, DateTime from, DateTime to, int? departmentId, int? employeeId)
    {
        if (kind == ReportKind.LeaveBalance)
            return PayrollService.LeaveBalance(Catalog.First(c => c.Kind == kind).Name, from.Year, departmentId, employeeId);
        if (kind == ReportKind.DailyAttendance) to = from;
        if (kind is ReportKind.MonthlyMuster or ReportKind.MonthlySummary or ReportKind.SalarySheet)
        {
            from = new DateTime(from.Year, from.Month, 1);
            to = from.AddMonths(1).AddDays(-1);
        }

        var days = AttendanceProcessor.Process(from, to, departmentId, employeeId);
        var name = Catalog.First(c => c.Kind == kind).Name;
        var period = kind switch
        {
            ReportKind.DailyAttendance => from.ToString("dddd, dd MMM yyyy"),
            ReportKind.MonthlyMuster or ReportKind.MonthlySummary or ReportKind.SalarySheet => from.ToString("MMMM yyyy"),
            _ => $"{from:dd MMM yyyy} to {to:dd MMM yyyy}"
        };

        return kind switch
        {
            ReportKind.DailyAttendance => Daily(name, period, days, withDate: false),
            ReportKind.AttendanceRegister => Daily(name, period, days, withDate: true),
            ReportKind.MonthlyMuster => Muster(name, period, days, from, to),
            ReportKind.MonthlySummary => Summary(name, period, days),
            ReportKind.LateArrival => Daily(name, period, days.Where(d => d.LateMinutes > 0), true),
            ReportKind.EarlyDeparture => Daily(name, period, days.Where(d => d.EarlyMinutes > 0), true),
            ReportKind.Overtime => Daily(name, period, days.Where(d => d.OvertimeMinutes > 0), true),
            ReportKind.Absent => Daily(name, period, days.Where(d => d.Status == DayStatus.Absent), true),
            ReportKind.SalarySheet => PayrollService.SalarySheet(name, period, from, days),
            _ => Punches(name, period, days),
        };
    }

    private static ReportResult Daily(string title, string period, IEnumerable<DayRecord> days, bool withDate)
    {
        var t = new DataTable();
        if (withDate) t.Columns.Add("Date");
        foreach (var c in new[] { "Emp ID", "Name", "Department", "Shift", "In", "Out", "Worked", "Late", "Early", "OT", "Status", "Remark" })
            t.Columns.Add(c);

        foreach (var d in days.Where(d => d.Status != "" && d.Status != DayStatus.NotJoined)
                              .OrderBy(d => d.Date).ThenBy(d => AttendanceProcessor.SortKey(d.EnrollNo)))
        {
            var row = new List<object>();
            if (withDate) row.Add(d.Date.ToString("dd-MM-yyyy ddd"));
            row.AddRange(new object[]
            {
                d.EnrollNo, d.Name, d.Department, d.ShiftName,
                d.In?.ToString("HH:mm") ?? "", d.Out?.ToString("HH:mm") ?? "",
                AttendanceProcessor.Hm(d.WorkedMinutes), AttendanceProcessor.Hm(d.LateMinutes),
                AttendanceProcessor.Hm(d.EarlyMinutes), AttendanceProcessor.Hm(d.OvertimeMinutes),
                d.Status, d.Remark
            });
            t.Rows.Add(row.ToArray());
        }
        return new ReportResult { Title = title, Subtitle = period, Table = t, StatusColumns = ["Status"] };
    }

    private static ReportResult Muster(string title, string period, List<DayRecord> days, DateTime from, DateTime to)
    {
        var t = new DataTable();
        t.Columns.Add("Emp ID");
        t.Columns.Add("Name");
        var status = new HashSet<string>();
        for (var d = from; d <= to; d = d.AddDays(1))
        {
            var col = d.Day.ToString("00");
            t.Columns.Add(col);
            status.Add(col);
        }
        foreach (var c in new[] { "P", "A", "L", "H", "WO", "Late", "OT Hrs", "Paid Days" }) t.Columns.Add(c);

        var summaries = AttendanceProcessor.Summarize(days).ToDictionary(s => s.EnrollNo);
        foreach (var g in days.GroupBy(d => d.EnrollNo))
        {
            var s = summaries[g.Key];
            var row = new List<object> { g.Key, g.First().Name };
            row.AddRange(g.OrderBy(d => d.Date).Select(d => (object)d.Status));
            row.AddRange(new object[]
            {
                Num(s.Present), Num(s.Absent), Num(s.Leave), s.Holidays, s.WeeklyOffs, s.LateCount,
                AttendanceProcessor.Hm(s.OvertimeMinutes), Num(s.PaidDays)
            });
            t.Rows.Add(row.ToArray());
        }
        return new ReportResult { Title = title, Subtitle = period, Table = t, StatusColumns = status };
    }

    private static ReportResult Summary(string title, string period, List<DayRecord> days)
    {
        var t = new DataTable();
        foreach (var c in new[] { "Emp ID", "Name", "Department", "Present", "Absent", "Leave", "Paid Leave", "Holidays",
                     "Weekly Off", "Late Days", "Late Hrs", "Early Days", "Worked Hrs", "OT Hrs", "Paid Days" })
            t.Columns.Add(c);

        foreach (var s in AttendanceProcessor.Summarize(days))
            t.Rows.Add(s.EnrollNo, s.Name, s.Department, Num(s.Present), Num(s.Absent), Num(s.Leave), Num(s.PaidLeave),
                s.Holidays, s.WeeklyOffs, s.LateCount, AttendanceProcessor.Hm(s.LateMinutes), s.EarlyCount,
                AttendanceProcessor.Hm(s.WorkedMinutes), AttendanceProcessor.Hm(s.OvertimeMinutes), Num(s.PaidDays));
        return new ReportResult { Title = title, Subtitle = period, Table = t };
    }

    private static ReportResult Punches(string title, string period, List<DayRecord> days)
    {
        var t = new DataTable();
        foreach (var c in new[] { "Date", "Emp ID", "Name", "Department", "Count", "Punches" }) t.Columns.Add(c);
        foreach (var d in days.Where(d => d.PunchCount > 0).OrderBy(d => d.Date).ThenBy(d => AttendanceProcessor.SortKey(d.EnrollNo)))
            t.Rows.Add(d.Date.ToString("dd-MM-yyyy ddd"), d.EnrollNo, d.Name, d.Department, d.PunchCount,
                string.Join("  ", d.Punches.Select(p => p.ToString("HH:mm"))));
        return new ReportResult { Title = title, Subtitle = period, Table = t };
    }

    private static string Num(double v) => v % 1 == 0 ? v.ToString("0") : v.ToString("0.0");

    public static string CompanyName => AppDbContext.GetSetting("CompanyName", "My Company");
    public static string CompanyAddress => AppDbContext.GetSetting("CompanyAddress", "");

    /// <summary>Background / foreground colors for a status code, shared by grid, Excel and PDF.</summary>
    public static (Color back, Color fore)? StatusColor(string status) => status switch
    {
        "P" => (Color.FromArgb(220, 245, 226), Color.FromArgb(22, 101, 52)),
        "A" => (Color.FromArgb(254, 226, 226), Color.FromArgb(153, 27, 27)),
        "HD" => (Color.FromArgb(254, 243, 199), Color.FromArgb(146, 64, 14)),
        "H" => (Color.FromArgb(224, 231, 255), Color.FromArgb(55, 48, 163)),
        "WO" => (Color.FromArgb(237, 237, 240), Color.FromArgb(82, 82, 91)),
        "Approved" => (Color.FromArgb(220, 245, 226), Color.FromArgb(22, 101, 52)),
        "Pending" => (Color.FromArgb(254, 243, 199), Color.FromArgb(146, 64, 14)),
        "Rejected" => (Color.FromArgb(254, 226, 226), Color.FromArgb(153, 27, 27)),
        "" or "-" => null,
        _ => (Color.FromArgb(243, 232, 255), Color.FromArgb(107, 33, 168)), // leave codes
    };
}
