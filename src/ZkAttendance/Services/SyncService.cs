using Microsoft.EntityFrameworkCore;
using ZkAttendance.Data;
using ZkAttendance.Device;

namespace ZkAttendance.Services;

/// <summary>Moves data between the device (or pendrive files) and the database.</summary>
public static class SyncService
{
    public record SaveResult(int Added, int Duplicates, int NewEmployees);

    public static SaveResult SavePunches(IEnumerable<DevicePunch> punches, PunchSource source)
    {
        var list = punches.Where(p => p.Time != DateTime.MinValue && !string.IsNullOrWhiteSpace(p.EnrollNo))
                          .Select(p => p with { Time = TruncateMs(p.Time) })
                          .DistinctBy(p => (p.EnrollNo, p.Time))
                          .ToList();
        if (list.Count == 0) return new(0, 0, 0);

        using var db = new AppDbContext();
        var min = list.Min(p => p.Time);
        var max = list.Max(p => p.Time);
        var existing = db.AttendanceLogs.Where(a => a.PunchTime >= min && a.PunchTime <= max)
                         .Select(a => new { a.EnrollNo, a.PunchTime })
                         .AsEnumerable()
                         .Select(a => (a.EnrollNo, a.PunchTime))
                         .ToHashSet();

        int added = 0;
        foreach (var p in list)
        {
            if (existing.Contains((p.EnrollNo, p.Time))) continue;
            db.AttendanceLogs.Add(new AttendanceLog
            {
                EnrollNo = p.EnrollNo, PunchTime = p.Time, VerifyMode = p.VerifyMode,
                InOutMode = p.InOutMode, WorkCode = p.WorkCode, Source = source
            });
            added++;
        }

        // Punches from IDs not yet in the employee list get a placeholder employee so they show in reports.
        var known = db.Employees.Select(e => e.EnrollNo).ToHashSet();
        var defaults = Defaults(db);
        int newEmp = 0;
        foreach (var id in list.Select(p => p.EnrollNo).Distinct().Where(id => !known.Contains(id)))
        {
            db.Employees.Add(new Employee { EnrollNo = id, Name = $"User {id}", ShiftId = defaults.shift, DepartmentId = defaults.dept });
            newEmp++;
        }

        db.SaveChanges();
        return new(added, list.Count - added, newEmp);
    }

    /// <summary>Insert/update employees (and optionally fingerprints) from device users.</summary>
    public static (int added, int updated) SaveUsers(IEnumerable<DeviceUser> users, bool overwriteNames)
    {
        using var db = new AppDbContext();
        var defaults = Defaults(db);
        var all = db.Employees.Include(e => e.Fingers).ToDictionary(e => e.EnrollNo);
        int added = 0, updated = 0;

        foreach (var u in users)
        {
            if (!all.TryGetValue(u.EnrollNo, out var emp))
            {
                emp = new Employee { EnrollNo = u.EnrollNo, ShiftId = defaults.shift, DepartmentId = defaults.dept };
                db.Employees.Add(emp);
                all[u.EnrollNo] = emp;
                added++;
            }
            else updated++;

            bool placeholder = string.IsNullOrWhiteSpace(emp.Name) || emp.Name == $"User {emp.EnrollNo}";
            if (!string.IsNullOrWhiteSpace(u.Name) && (overwriteNames || placeholder)) emp.Name = u.Name;
            if (string.IsNullOrWhiteSpace(emp.Name)) emp.Name = $"User {u.EnrollNo}";
            emp.Privilege = u.Privilege;
            emp.DevicePassword = u.Password;
            if (!string.IsNullOrWhiteSpace(u.CardNo) && u.CardNo != "0") emp.CardNo = u.CardNo;

            foreach (var f in u.Fingers)
            {
                var ft = emp.Fingers.FirstOrDefault(x => x.FingerIndex == f.FingerIndex);
                if (ft == null) emp.Fingers.Add(new FingerTemplate { FingerIndex = f.FingerIndex, Flag = f.Flag, Template = f.Template });
                else { ft.Template = f.Template; ft.Flag = f.Flag; }
            }
        }
        db.SaveChanges();
        return (added, updated);
    }

    public static List<DeviceUser> ToDeviceUsers(IEnumerable<int> employeeIds)
    {
        var ids = employeeIds.ToList();
        using var db = new AppDbContext();
        return db.Employees.Include(e => e.Fingers).Where(e => ids.Contains(e.Id)).AsEnumerable()
            .Select(e =>
            {
                var u = new DeviceUser
                {
                    EnrollNo = e.EnrollNo, Name = e.Name.Length > 24 ? e.Name[..24] : e.Name,
                    Password = e.DevicePassword ?? "", Privilege = e.Privilege, Enabled = e.IsActive, CardNo = e.CardNo ?? ""
                };
                u.Fingers.AddRange(e.Fingers.Select(f => new DeviceFinger(f.FingerIndex, f.Flag, f.Template)));
                return u;
            }).ToList();
    }

    private static (int? shift, int? dept) Defaults(AppDbContext db) =>
        (db.Shifts.OrderBy(s => s.Id).Select(s => (int?)s.Id).FirstOrDefault(),
         db.Departments.OrderBy(d => d.Id).Select(d => (int?)d.Id).FirstOrDefault());

    private static DateTime TruncateMs(DateTime t) => new(t.Year, t.Month, t.Day, t.Hour, t.Minute, t.Second);
}
