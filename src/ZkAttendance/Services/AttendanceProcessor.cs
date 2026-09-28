using Microsoft.EntityFrameworkCore;
using ZkAttendance.Data;

namespace ZkAttendance.Services;

public static class DayStatus
{
    public const string Present = "P";
    public const string Absent = "A";
    public const string HalfDay = "HD";
    public const string Holiday = "H";
    public const string WeeklyOff = "WO";
    public const string NotJoined = "-";
}

public class DayRecord
{
    public int EmployeeId { get; init; }
    public string EnrollNo { get; init; } = "";
    public string Name { get; init; } = "";
    public string Department { get; init; } = "";
    public string ShiftName { get; init; } = "";
    public DateTime Date { get; init; }
    public DateTime? In { get; set; }
    public DateTime? Out { get; set; }
    public int PunchCount { get; set; }
    public List<DateTime> Punches { get; set; } = new();
    public int WorkedMinutes { get; set; }
    public int LateMinutes { get; set; }
    public int EarlyMinutes { get; set; }
    public int OvertimeMinutes { get; set; }
    /// <summary>P, A, HD, H, WO, "-" or a leave code (CL, SL ...).</summary>
    public string Status { get; set; } = DayStatus.Absent;
    public bool IsLeave { get; set; }
    public bool IsPaidLeave { get; set; }
    public double LeaveDays { get; set; }
    /// <summary>Part of <see cref="LeaveDays"/> that is paid (less than it when the yearly quota ran out).</summary>
    public double PaidLeaveDays { get; set; }
    /// <summary>Leave asked for this day but not approved yet (day is counted as absent until then).</summary>
    public double PendingLeaveDays { get; set; }
    public string Remark { get; set; } = "";

    /// <summary>Attendance value used in payroll: 1 present, 0.5 half day.</summary>
    public double PresentValue => Status switch
    {
        DayStatus.Present => 1,
        DayStatus.HalfDay => 0.5,
        _ => 0
    };
}

public class MonthlySummary
{
    public int EmployeeId { get; init; }
    public string EnrollNo { get; init; } = "";
    public string Name { get; init; } = "";
    public string Department { get; init; } = "";
    public double Present { get; set; }
    public double Absent { get; set; }
    public double Leave { get; set; }
    public double PaidLeave { get; set; }
    public double PendingLeave { get; set; }
    public int Holidays { get; set; }
    public int WeeklyOffs { get; set; }
    public int LateCount { get; set; }
    public int LateMinutes { get; set; }
    public int EarlyCount { get; set; }
    public int WorkedMinutes { get; set; }
    public int OvertimeMinutes { get; set; }
    public double PaidDays => Present + PaidLeave + Holidays + WeeklyOffs;
}

/// <summary>Company-wide rules (Attendance Rule dialog), stored in AppSettings.</summary>
public record AttendanceRules(int WindowBeforeHours, int DuplicateMinutes, string SinglePunch)
{
    public static AttendanceRules Load()
    {
        using var db = new AppDbContext();
        var s = db.AppSettings.Where(x => x.Key.StartsWith("Rule.")).ToDictionary(x => x.Key, x => x.Value);
        int I(string k, int d) => s.TryGetValue(k, out var v) && int.TryParse(v, out var n) ? n : d;
        return new AttendanceRules(I("Rule.WindowBeforeHours", 4), I("Rule.DuplicateMinutes", 1),
            s.GetValueOrDefault("Rule.SinglePunch", "Present"));
    }
}

/// <summary>
/// Turns raw punches into daily attendance using shift rules.
/// First punch in the shift window = IN, last punch = OUT (the LX50's in/out state key is
/// often not pressed by staff, so it is not relied on).
/// </summary>
public static class AttendanceProcessor
{
    private static readonly Shift FallbackShift = new() { Name = "Default" };

    public static List<DayRecord> Process(DateTime from, DateTime to, int? departmentId = null, int? employeeId = null)
    {
        from = from.Date; to = to.Date;
        var rules = AttendanceRules.Load();
        using var db = new AppDbContext();

        var empQuery = db.Employees.Include(e => e.Department).Include(e => e.Shift).Where(e => e.IsActive);
        if (departmentId != null) empQuery = empQuery.Where(e => e.DepartmentId == departmentId);
        if (employeeId != null) empQuery = empQuery.Where(e => e.Id == employeeId);
        var employees = empQuery.AsEnumerable().OrderBy(e => SortKey(e.EnrollNo)).ToList();
        var enrollNos = employees.Select(e => e.EnrollNo).ToList();

        // Wide range so night shifts and early punches are covered.
        var logFrom = from.AddDays(-1);
        var logTo = to.AddDays(2);
        var logs = db.AttendanceLogs
            .Where(a => a.PunchTime >= logFrom && a.PunchTime < logTo && enrollNos.Contains(a.EnrollNo))
            .Select(a => new { a.EnrollNo, a.PunchTime })
            .AsEnumerable()
            .GroupBy(a => a.EnrollNo)
            .ToDictionary(g => g.Key, g => g.Select(x => x.PunchTime).OrderBy(t => t).ToList());

        // Leave quotas are per calendar year, so leave taken earlier in the year is needed too.
        var yearStart = new DateTime(from.Year, 1, 1);
        var holidays = db.Holidays.Where(h => h.Date >= from && h.Date <= to).ToDictionary(h => h.Date.Date, h => h.Name);
        var quotaHolidays = db.Holidays.Where(h => h.Date >= yearStart && h.Date <= to).Select(h => h.Date).AsEnumerable()
                              .Select(d => d.Date).ToHashSet();
        var empIds = employees.Select(e => e.Id).ToList();
        var leaves = db.LeaveEntries.Include(l => l.LeaveType)
            .Where(l => empIds.Contains(l.EmployeeId) && l.FromDate <= to && l.ToDate >= yearStart && l.Status == LeaveStatus.Approved)
            .ToList();
        var pendingLeaves = db.LeaveEntries.Include(l => l.LeaveType)
            .Where(l => empIds.Contains(l.EmployeeId) && l.FromDate <= to && l.ToDate >= from && l.Status == LeaveStatus.Pending)
            .ToList();

        var result = new List<DayRecord>();
        var today = DateTime.Today;

        foreach (var emp in employees)
        {
            var shift = emp.Shift ?? FallbackShift;
            logs.TryGetValue(emp.EnrollNo, out var empLogs);
            empLogs ??= new List<DateTime>();

            // Days of quota-limited leave, to know how much quota is left on a given date.
            var quotaUse = leaves.Where(l => l.EmployeeId == emp.Id && (l.LeaveType?.YearlyQuota ?? 0) > 0)
                .SelectMany(l => LeaveDays(l, shift, quotaHolidays).Select(x => (l.LeaveTypeId, x.Date, x.Days))).ToList();
            double QuotaLeft(LeaveEntry l, DateTime day)
            {
                double quota = l.LeaveType?.YearlyQuota ?? 0;
                if (quota <= 0) return double.MaxValue;
                return quota - quotaUse.Where(u => u.LeaveTypeId == l.LeaveTypeId && u.Date.Year == day.Year && u.Date < day).Sum(u => u.Days);
            }

            for (var d = from; d <= to; d = d.AddDays(1))
            {
                var rec = new DayRecord
                {
                    EmployeeId = emp.Id, EnrollNo = emp.EnrollNo, Name = emp.Name,
                    Department = emp.Department?.Name ?? "", ShiftName = shift.Name, Date = d
                };
                result.Add(rec);

                if (emp.JoinDate != null && d < emp.JoinDate.Value.Date) { rec.Status = DayStatus.NotJoined; continue; }

                var shiftStart = d + shift.StartTime;
                var shiftEnd = d + shift.EndTime + (shift.CrossesMidnight ? TimeSpan.FromDays(1) : TimeSpan.Zero);
                var windowStart = shiftStart.AddHours(-rules.WindowBeforeHours);
                var windowEnd = windowStart.AddHours(24);

                rec.Punches = RemoveRepeats(empLogs.Where(t => t >= windowStart && t < windowEnd), rules.DuplicateMinutes);
                rec.PunchCount = rec.Punches.Count;

                bool holiday = holidays.TryGetValue(d, out var holidayName);
                bool weeklyOff = shift.IsWeeklyOff(d.DayOfWeek);
                var leave = leaves.FirstOrDefault(l => l.EmployeeId == emp.Id && l.FromDate.Date <= d && l.ToDate.Date >= d);

                if (rec.PunchCount > 0)
                {
                    rec.In = rec.Punches[0];
                    if (rec.PunchCount > 1) rec.Out = rec.Punches[^1];
                    rec.Status = DayStatus.Present;

                    if (rec.Out != null)
                        rec.WorkedMinutes = (int)(rec.Out.Value - rec.In.Value).TotalMinutes;
                    else
                    {
                        rec.Remark = "Out punch missing";
                        if (rules.SinglePunch == "Half Day") rec.Status = DayStatus.HalfDay;
                        else if (rules.SinglePunch == "Absent") rec.Status = DayStatus.Absent;
                    }

                    if (holiday || weeklyOff)
                    {
                        rec.OvertimeMinutes = rec.WorkedMinutes;
                        rec.Remark = Join(rec.Remark, holiday ? $"Worked on holiday ({holidayName})" : "Worked on weekly off");
                    }
                    else
                    {
                        var late = (int)(rec.In.Value - shiftStart).TotalMinutes;
                        if (late > shift.LateGraceMinutes) rec.LateMinutes = late;

                        if (rec.Out != null)
                        {
                            var early = (int)(shiftEnd - rec.Out.Value).TotalMinutes;
                            if (early > shift.EarlyGraceMinutes) rec.EarlyMinutes = early;

                            var extra = rec.WorkedMinutes - (int)shift.Duration.TotalMinutes;
                            if (extra >= shift.MinOvertimeMinutes && shift.MinOvertimeMinutes >= 0) rec.OvertimeMinutes = extra;

                            if (shift.HalfDayMinutes > 0 && rec.WorkedMinutes < shift.HalfDayMinutes)
                                rec.Status = DayStatus.HalfDay;
                        }

                        if (leave != null)
                        {
                            if (leave.IsHalfDay)
                            {
                                rec.Status = DayStatus.HalfDay;
                                ApplyLeave(rec, leave, 0.5, keepStatus: true, QuotaLeft(leave, d));
                            }
                            else rec.Remark = Join(rec.Remark, $"Punched during {leave.LeaveType?.Code} leave");
                        }
                    }
                }
                else if (d > today) rec.Status = "";
                else if (holiday) { rec.Status = DayStatus.Holiday; rec.Remark = holidayName ?? ""; }
                else if (weeklyOff) rec.Status = DayStatus.WeeklyOff;
                else if (leave != null) ApplyLeave(rec, leave, leave.IsHalfDay ? 0.5 : 1, keepStatus: false, QuotaLeft(leave, d));
                else
                {
                    rec.Status = DayStatus.Absent;
                    var pending = pendingLeaves.FirstOrDefault(l => l.EmployeeId == emp.Id && l.FromDate.Date <= d && l.ToDate.Date >= d);
                    if (pending != null)
                    {
                        rec.PendingLeaveDays = pending.IsHalfDay ? 0.5 : 1;
                        rec.Remark = Join(rec.Remark, $"{pending.LeaveType?.Code} leave pending (approve nahi hui)");
                    }
                }
            }
        }
        return result;
    }

    public static List<MonthlySummary> Summarize(IEnumerable<DayRecord> days) =>
        days.GroupBy(d => d.EmployeeId).Select(g =>
        {
            var f = g.First();
            var s = new MonthlySummary { EmployeeId = f.EmployeeId, EnrollNo = f.EnrollNo, Name = f.Name, Department = f.Department };
            foreach (var d in g)
            {
                s.Present += d.PresentValue;
                if (d.Status == DayStatus.Absent) s.Absent += 1;
                if (d.IsLeave)
                {
                    s.Leave += d.LeaveDays;
                    s.PaidLeave += d.PaidLeaveDays;
                    // Half-day leave with no punches: the other half is absent.
                    if (d.LeaveDays < 1 && d.Status != DayStatus.HalfDay) s.Absent += 1 - d.LeaveDays;
                }
                s.PendingLeave += d.PendingLeaveDays;
                if (d.Status == DayStatus.Holiday) s.Holidays++;
                if (d.Status == DayStatus.WeeklyOff) s.WeeklyOffs++;
                if (d.LateMinutes > 0) { s.LateCount++; s.LateMinutes += d.LateMinutes; }
                if (d.EarlyMinutes > 0) s.EarlyCount++;
                s.WorkedMinutes += d.WorkedMinutes;
                s.OvertimeMinutes += d.OvertimeMinutes;
            }
            return s;
        }).ToList();

    /// <summary>Drops punches made within <paramref name="minutes"/> of the previous kept punch (double finger press).</summary>
    private static List<DateTime> RemoveRepeats(IEnumerable<DateTime> punches, int minutes)
    {
        var list = new List<DateTime>();
        foreach (var t in punches)
            if (list.Count == 0 || (t - list[^1]).TotalMinutes >= minutes || minutes <= 0) list.Add(t);
        return list;
    }

    private static void ApplyLeave(DayRecord rec, LeaveEntry leave, double days, bool keepStatus, double quotaLeft)
    {
        rec.IsLeave = true;
        rec.LeaveDays = days;
        bool paid = leave.LeaveType?.IsPaid ?? true;
        rec.PaidLeaveDays = paid ? Math.Clamp(quotaLeft, 0, days) : 0;
        rec.IsPaidLeave = rec.PaidLeaveDays > 0;
        var code = leave.LeaveType?.Code ?? "L";
        bool overQuota = paid && rec.PaidLeaveDays < days;
        var shown = overQuota && rec.PaidLeaveDays == 0 ? "LWP" : code;
        if (!keepStatus) rec.Status = days < 1 ? $"½{shown}" : shown;
        rec.Remark = Join(rec.Remark,
            overQuota ? $"{code} quota khatam: {days - rec.PaidLeaveDays:0.#} din bina paise (LWP)" :
            days < 1 ? $"Half day {code}" : leave.Reason ?? "");
    }

    /// <summary>Working days a leave covers: the employee's weekly offs and holidays inside it are not counted.</summary>
    public static IEnumerable<(DateTime Date, double Days)> LeaveDays(LeaveEntry leave, Shift? shift, ISet<DateTime> holidays)
    {
        var s = shift ?? FallbackShift;
        for (var d = leave.FromDate.Date; d <= leave.ToDate.Date; d = d.AddDays(1))
            if (!holidays.Contains(d) && !s.IsWeeklyOff(d.DayOfWeek)) yield return (d, leave.IsHalfDay ? 0.5 : 1);
    }

    private static string Join(string a, string b) => string.IsNullOrEmpty(a) ? b : string.IsNullOrEmpty(b) ? a : $"{a}; {b}";

    /// <summary>Sorts numeric enroll numbers numerically ("2" before "10").</summary>
    public static string SortKey(string enroll) => enroll.PadLeft(12, '0');

    public static string Hm(int minutes) => minutes <= 0 ? "" : $"{minutes / 60:00}:{minutes % 60:00}";
}
