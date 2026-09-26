using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;

namespace ZkAttendance.Data;

public class AppDbContext : DbContext
{
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<Shift> Shifts => Set<Shift>();
    public DbSet<Employee> Employees => Set<Employee>();
    public DbSet<FingerTemplate> FingerTemplates => Set<FingerTemplate>();
    public DbSet<AttendanceLog> AttendanceLogs => Set<AttendanceLog>();
    public DbSet<LeaveType> LeaveTypes => Set<LeaveType>();
    public DbSet<LeaveEntry> LeaveEntries => Set<LeaveEntry>();
    public DbSet<Holiday> Holidays => Set<Holiday>();
    public DbSet<DeviceProfile> DeviceProfiles => Set<DeviceProfile>();
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();

    protected override void OnConfiguring(DbContextOptionsBuilder options) =>
        options.UseSqlServer(DbConfig.ConnectionString);

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Employee>().HasIndex(e => e.EnrollNo).IsUnique();
        b.Entity<Employee>().HasOne(e => e.Department).WithMany().OnDelete(DeleteBehavior.SetNull);
        b.Entity<Employee>().HasOne(e => e.Shift).WithMany().OnDelete(DeleteBehavior.SetNull);
        b.Entity<FingerTemplate>().HasIndex(f => new { f.EmployeeId, f.FingerIndex }).IsUnique();
        b.Entity<AttendanceLog>().HasIndex(a => new { a.EnrollNo, a.PunchTime }).IsUnique();
        b.Entity<AttendanceLog>().HasIndex(a => a.PunchTime);
        b.Entity<Holiday>().HasIndex(h => h.Date).IsUnique();
        b.Entity<LeaveEntry>().HasOne(l => l.LeaveType).WithMany().OnDelete(DeleteBehavior.Restrict);
    }

    /// <summary>Creates the database on first run and seeds default masters.</summary>
    public static void Initialize()
    {
        using var db = new AppDbContext();
        db.Database.EnsureCreated();
        Upgrade(db);

        if (!db.Shifts.Any())
            db.Shifts.Add(new Shift { Name = "General" });
        if (!db.Departments.Any())
            db.Departments.Add(new Department { Name = "General" });
        if (!db.LeaveTypes.Any())
            db.LeaveTypes.AddRange(
                new LeaveType { Code = "CL", Name = "Casual Leave" },
                new LeaveType { Code = "SL", Name = "Sick Leave" },
                new LeaveType { Code = "EL", Name = "Earned Leave" },
                new LeaveType { Code = "LWP", Name = "Leave Without Pay", IsPaid = false });
        if (!db.DeviceProfiles.Any())
            db.DeviceProfiles.Add(new DeviceProfile());
        db.SaveChanges();
    }

    /// <summary>
    /// Adds columns introduced after the database was first created (EnsureCreated does not alter
    /// existing tables). Each entry is idempotent.
    /// </summary>
    private static void Upgrade(AppDbContext db)
    {
        (string table, string column, string type)[] columns =
        [
            ("Departments", "ParentId", "int NULL"),
            ("Employees", "BadgeNo", "nvarchar(30) NULL"),
            ("Employees", "Gender", "nvarchar(10) NULL"),
            ("Employees", "Nationality", "nvarchar(50) NULL"),
            ("Employees", "OfficeTel", "nvarchar(20) NULL"),
            ("Employees", "HomeAddress", "nvarchar(250) NULL"),
            ("Employees", "Email", "nvarchar(100) NULL"),
            ("Employees", "BirthDate", "datetime2 NULL"),
            ("Employees", "Photo", "varbinary(max) NULL"),
            ("DeviceProfiles", "ProductName", "nvarchar(50) NULL"),
            ("DeviceProfiles", "SerialNumber", "nvarchar(50) NULL"),
            ("DeviceProfiles", "Firmware", "nvarchar(50) NULL"),
            ("DeviceProfiles", "UserCount", "int NULL"),
            ("DeviceProfiles", "AdminCount", "int NULL"),
            ("DeviceProfiles", "FpCount", "int NULL"),
            ("DeviceProfiles", "FaceCount", "int NULL"),
            ("DeviceProfiles", "PasswordCount", "int NULL"),
            ("DeviceProfiles", "LogCount", "int NULL"),
        ];
        foreach (var (table, column, type) in columns)
#pragma warning disable EF1002 // identifiers come from the constant list above
            db.Database.ExecuteSqlRaw($"IF COL_LENGTH('{table}', '{column}') IS NULL ALTER TABLE [{table}] ADD [{column}] {type}");
#pragma warning restore EF1002
    }

    public static string GetSetting(string key, string fallback = "")
    {
        using var db = new AppDbContext();
        return db.AppSettings.Find(key)?.Value ?? fallback;
    }

    public static void SetSetting(string key, string value)
    {
        using var db = new AppDbContext();
        var s = db.AppSettings.Find(key);
        if (s == null) db.AppSettings.Add(new AppSetting { Key = key, Value = value });
        else s.Value = value;
        db.SaveChanges();
    }
}

public static class DbConfig
{
    private static string FilePath => Path.Combine(AppContext.BaseDirectory, "appsettings.json");

    public static string ConnectionString { get; set; } =
        @"Server=.\SQLEXPRESS;Database=ZkAttendance;Trusted_Connection=True;TrustServerCertificate=True";

    public static void Load()
    {
        if (!File.Exists(FilePath)) return;
        var node = JsonNode.Parse(File.ReadAllText(FilePath));
        var cs = node?["ConnectionString"]?.GetValue<string>();
        if (!string.IsNullOrWhiteSpace(cs)) ConnectionString = cs;
    }

    public static void Save()
    {
        var json = new JsonObject { ["ConnectionString"] = ConnectionString };
        File.WriteAllText(FilePath, json.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    }
}
