using System.ComponentModel.DataAnnotations;

namespace ZkAttendance.Data;

public class Department
{
    public int Id { get; set; }
    [MaxLength(100)] public string Name { get; set; } = "";
    /// <summary>Parent department (null = directly under the company).</summary>
    public int? ParentId { get; set; }
    public override string ToString() => Name;
}

public class Shift
{
    public int Id { get; set; }
    [MaxLength(100)] public string Name { get; set; } = "";
    public TimeSpan StartTime { get; set; } = new(9, 0, 0);
    public TimeSpan EndTime { get; set; } = new(18, 0, 0);
    /// <summary>Minutes after start still counted as on time.</summary>
    public int LateGraceMinutes { get; set; } = 10;
    /// <summary>Minutes before end still counted as full day.</summary>
    public int EarlyGraceMinutes { get; set; } = 10;
    /// <summary>Worked minutes below this = Half Day (0 disables).</summary>
    public int HalfDayMinutes { get; set; } = 240;
    /// <summary>Extra minutes beyond shift end needed before OT is counted.</summary>
    public int MinOvertimeMinutes { get; set; } = 30;
    /// <summary>Comma separated DayOfWeek names, e.g. "Sunday".</summary>
    [MaxLength(100)] public string WeeklyOffs { get; set; } = "Sunday";

    public bool CrossesMidnight => EndTime <= StartTime;
    public TimeSpan Duration => CrossesMidnight ? EndTime + TimeSpan.FromDays(1) - StartTime : EndTime - StartTime;

    public bool IsWeeklyOff(DayOfWeek day) =>
        WeeklyOffs.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                  .Any(d => string.Equals(d, day.ToString(), StringComparison.OrdinalIgnoreCase));

    public override string ToString() => $"{Name} ({StartTime:hh\\:mm}-{EndTime:hh\\:mm})";
}

public class Employee
{
    public int Id { get; set; }
    /// <summary>User ID / enroll number on the device. Links punches to the employee.</summary>
    [MaxLength(24)] public string EnrollNo { get; set; } = "";
    [MaxLength(100)] public string Name { get; set; } = "";
    /// <summary>Shown as "Title" in the employee window.</summary>
    [MaxLength(100)] public string? Designation { get; set; }
    /// <summary>Mobile number.</summary>
    [MaxLength(20)] public string? Phone { get; set; }
    public DateTime? JoinDate { get; set; }
    /// <summary>"No." field - staff / badge number, separate from the device AC No.</summary>
    [MaxLength(30)] public string? BadgeNo { get; set; }
    [MaxLength(10)] public string? Gender { get; set; }
    [MaxLength(50)] public string? Nationality { get; set; }
    [MaxLength(20)] public string? OfficeTel { get; set; }
    [MaxLength(250)] public string? HomeAddress { get; set; }
    [MaxLength(100)] public string? Email { get; set; }
    public DateTime? BirthDate { get; set; }
    public byte[]? Photo { get; set; }
    public int? DepartmentId { get; set; }
    public Department? Department { get; set; }
    public int? ShiftId { get; set; }
    public Shift? Shift { get; set; }
    /// <summary>0 = normal user, 3 = admin (device privilege).</summary>
    public int Privilege { get; set; }
    [MaxLength(20)] public string? DevicePassword { get; set; }
    [MaxLength(20)] public string? CardNo { get; set; }
    /// <summary>Fixed monthly salary; one day = salary ÷ days in the month.</summary>
    public decimal MonthlySalary { get; set; }
    /// <summary>Overtime pay per hour; 0 = derived from the salary (per-day ÷ shift hours × OT multiplier).</summary>
    public decimal OtRatePerHour { get; set; }
    public bool IsActive { get; set; } = true;
    public List<FingerTemplate> Fingers { get; set; } = new();
    public override string ToString() => $"{EnrollNo} - {Name}";
}

public class FingerTemplate
{
    public int Id { get; set; }
    public int EmployeeId { get; set; }
    public Employee? Employee { get; set; }
    public int FingerIndex { get; set; }
    public int Flag { get; set; } = 1;
    public string Template { get; set; } = "";
}

public enum PunchSource { Device = 0, UsbFile = 1, Manual = 2 }

public class AttendanceLog
{
    public long Id { get; set; }
    [MaxLength(24)] public string EnrollNo { get; set; } = "";
    public DateTime PunchTime { get; set; }
    /// <summary>0 password, 1 fingerprint, 2 card, 15 face ...</summary>
    public int VerifyMode { get; set; }
    /// <summary>0 check-in, 1 check-out, 2 break-out, 3 break-in, 4 OT-in, 5 OT-out.</summary>
    public int InOutMode { get; set; }
    public int WorkCode { get; set; }
    public PunchSource Source { get; set; }
    [MaxLength(200)] public string? Remark { get; set; }
}

public class LeaveType
{
    public int Id { get; set; }
    [MaxLength(50)] public string Name { get; set; } = "";
    [MaxLength(10)] public string Code { get; set; } = "";
    public bool IsPaid { get; set; } = true;
    /// <summary>Paid days allowed per calendar year; beyond it the leave counts as unpaid (LWP). 0 = no limit.</summary>
    public double YearlyQuota { get; set; }
    public override string ToString() => $"{Code} - {Name}";
}

public class LeaveEntry
{
    public int Id { get; set; }
    public int EmployeeId { get; set; }
    public Employee? Employee { get; set; }
    public int LeaveTypeId { get; set; }
    public LeaveType? LeaveType { get; set; }
    public DateTime FromDate { get; set; }
    public DateTime ToDate { get; set; }
    public bool IsHalfDay { get; set; }
    [MaxLength(200)] public string? Reason { get; set; }
}

public class Holiday
{
    public int Id { get; set; }
    public DateTime Date { get; set; }
    [MaxLength(100)] public string Name { get; set; } = "";
}

/// <summary>How the PC talks to the device. Usb/Serial/Tcp use the ZKTeco SDK; Adms = device pushes to our HTTP server.</summary>
public enum ConnectionKind { Usb = 0, Serial = 1, Tcp = 2, Adms = 3 }

public class DeviceProfile
{
    public int Id { get; set; }
    [MaxLength(100)] public string Name { get; set; } = "LX50";
    public ConnectionKind Kind { get; set; } = ConnectionKind.Usb;
    public int MachineNumber { get; set; } = 1;
    [MaxLength(10)] public string ComPort { get; set; } = "COM3";
    public int BaudRate { get; set; } = 115200;
    [MaxLength(50)] public string IpAddress { get; set; } = "192.168.1.201";
    public int TcpPort { get; set; } = 4370;
    /// <summary>For ADMS devices the serial number identifies which device is pushing.</summary>
    public int CommPassword { get; set; }
    public DateTime? LastDownload { get; set; }

    // Last values read from the device, shown in the Machine List even when disconnected.
    [MaxLength(50)] public string? ProductName { get; set; }
    [MaxLength(50)] public string? SerialNumber { get; set; }
    [MaxLength(50)] public string? Firmware { get; set; }
    public int? UserCount { get; set; }
    public int? AdminCount { get; set; }
    public int? FpCount { get; set; }
    public int? FaceCount { get; set; }
    public int? PasswordCount { get; set; }
    public int? LogCount { get; set; }
}

public class AppSetting
{
    [Key, MaxLength(50)] public string Key { get; set; } = "";
    [MaxLength(500)] public string Value { get; set; } = "";
}
