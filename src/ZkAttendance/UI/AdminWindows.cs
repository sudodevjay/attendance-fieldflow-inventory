using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using ZkAttendance.Data;
using ZkAttendance.Services;

namespace ZkAttendance.UI;

/// <summary>Logged-in operator of the software (shown in the title bar).</summary>
public static class Session
{
    public static string UserName { get; set; } = "Supervisor";
}

/// <summary>Software administrator password (Maintenance/Options → Administrator).</summary>
public static class AdminDialog
{
    private const string Key = "AdminPasswordHash";

    public static bool HasPassword => AppDbContext.GetSetting(Key) != "";

    private static string Hash(string s) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("zkatt:" + s)));

    public static void ShowAdmin(IWin32Window owner)
    {
        using var dlg = new FormDialog("Administrator", 360);
        dlg.AddNote(HasPassword
            ? "Change the Supervisor password. Leave the password empty to turn off login."
            : "Set a Supervisor password. The password will then be required when the program starts.");
        var current = HasPassword ? dlg.AddText("Current password") : null;
        var pwd = dlg.AddText("New password");
        var again = dlg.AddText("Confirm password");
        foreach (var t in new[] { current, pwd, again }) if (t != null) t.UseSystemPasswordChar = true;
        dlg.Validator = () =>
        {
            if (current != null && Hash(current.Text) != AppDbContext.GetSetting(Key)) return "The current password is incorrect.";
            if (pwd.Text != again.Text) return "The passwords do not match.";
            return null;
        };
        if (dlg.ShowDialog(owner) != DialogResult.OK) return;
        AppDbContext.SetSetting(Key, pwd.Text.Length == 0 ? "" : Hash(pwd.Text));
        Ui.Info(pwd.Text.Length == 0 ? "Password removed." : "Password set.");
    }

    /// <summary>Asks for the password at startup; returns false if the user cancels.</summary>
    public static bool Login()
    {
        if (!HasPassword) return true;
        while (true)
        {
            using var dlg = new FormDialog("Login - Attendance Management Program", 320);
            var user = dlg.AddText("User", "Supervisor");
            var pwd = dlg.AddText("Password");
            pwd.UseSystemPasswordChar = true;
            dlg.Shown += (_, _) => pwd.Focus();
            if (dlg.ShowDialog() != DialogResult.OK) return false;
            if (Hash(pwd.Text) == AppDbContext.GetSetting(Key))
            {
                Session.UserName = string.IsNullOrWhiteSpace(user.Text) ? "Supervisor" : user.Text.Trim();
                return true;
            }
            MessageBox.Show("Incorrect password.", "Login", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }
}

/// <summary>Company-wide attendance rules used by the attendance calculation.</summary>
public static class AttendanceRuleDialog
{
    public static void ShowRules(IWin32Window owner)
    {
        var r = AttendanceRules.Load();
        using var dlg = new FormDialog("Attendance Rule", 440);
        dlg.AddNote("Late / early grace, half day and overtime are set per shift (Maintenance Timetables). These are the company-wide rules:");
        var window = dlg.AddNumber("Punch window starts (hours before shift)", r.WindowBeforeHours, 0, 12);
        var dup = dlg.AddNumber("Ignore repeat punch within (minutes)", r.DuplicateMinutes, 0, 120);
        var single = dlg.AddCombo("Only one punch in a day counts as", ["Present", "Half Day", "Absent"], r.SinglePunch);
        dlg.AddNote("Example: shift 09:00 and window 4 hours = punches from 05:00 to 05:00 the next day count for that day.\n" +
                    "Repeat punch: if someone punches twice within 2 minutes, it is counted as one punch.");
        if (dlg.ShowDialog(owner) != DialogResult.OK) return;
        AppDbContext.SetSetting("Rule.WindowBeforeHours", ((int)window.Value).ToString());
        AppDbContext.SetSetting("Rule.DuplicateMinutes", ((int)dup.Value).ToString());
        AppDbContext.SetSetting("Rule.SinglePunch", single.Text);
        AppState.RaiseDataChanged();
    }
}

/// <summary>Company-wide salary rules used by the Salary Sheet report.</summary>
public static class PayrollRuleDialog
{
    public static void ShowRules(IWin32Window owner)
    {
        var r = PayrollRules.Load();
        using var dlg = new FormDialog("Salary Rule", 440);
        dlg.AddNote("Monthly salary: per day = Salary ÷ days in month. Pay = per day × (Paid Days − late deduction).\n" +
                    "Enter the salary and OT rate in each employee's 'Addition' tab.");
        var late = dlg.AddNumber("Late arrivals per ½ day deduction (0 = off)", r.LateCountForHalfDay, 0, 31);
        var ot = dlg.AddNumber("OT multiplier (for employees with OT rate 0)", r.OtMultiplier, 0, 5);
        ot.DecimalPlaces = 2;
        ot.Increment = 0.5m;
        dlg.AddNote("Example: 3 → 3 late arrivals in a month = ½ day, 6 = 1 day deducted.\n" +
                    "OT multiplier 1 = normal hourly pay, 2 = double. If the employee has their own OT rate, that rate is used.");
        if (dlg.ShowDialog(owner) != DialogResult.OK) return;
        new PayrollRules((int)late.Value, ot.Value).Save();
        AppState.RaiseDataChanged();
    }
}

/// <summary>"Employee Schedule": assign a shift (timetable) to many employees at once.</summary>
public class EmployeeScheduleWindow : Form
{
    private readonly DataGridView _grid = Ui.Grid();
    private readonly ToolStripComboBox _dept = new() { DropDownStyle = ComboBoxStyle.DropDownList, AutoSize = false, Width = 180, Margin = new Padding(2, 14, 8, 0) };
    private readonly ToolStripComboBox _shift = new() { DropDownStyle = ComboBoxStyle.DropDownList, AutoSize = false, Width = 220, Margin = new Padding(2, 14, 4, 0) };

    public static void Open(IWin32Window owner)
    {
        if (MainForm.Instance is { } main)
        {
            main.OpenScreen("schedule", "Employee Schedule", Icons.Get(Icons.Table, Color.Brown), () => new EmployeeScheduleWindow());
            return;
        }
        using var w = new EmployeeScheduleWindow();
        w.ShowDialog(owner);
    }

    public EmployeeScheduleWindow()
    {
        Text = "Employee Schedule";
        Font = Theme.Base;
        Size = new Size(860, 560);
        StartPosition = FormStartPosition.CenterParent;
        ShowInTaskbar = false;
        BackColor = Theme.Background;

        var bar = Bars.Medium();
        bar.Items.Add(new ToolStripLabel("Department:") { Margin = new Padding(4, 16, 2, 0) });
        bar.Items.Add(_dept);
        bar.Items.Add(new ToolStripSeparator());
        bar.Items.Add(new ToolStripLabel("Shift:") { Margin = new Padding(4, 16, 2, 0) });
        bar.Items.Add(_shift);
        Bars.Button(bar, "Assign", Icons.Get(Icons.Check, Color.Green, 20, Color.FromArgb(40, 170, 60)), (_, _) => Assign());
        Bars.Button(bar, "Select All", Icons.Get(Icons.List, Theme.Accent, 20), (_, _) => _grid.SelectAll());

        var note = new Label
        {
            Dock = DockStyle.Top, Height = 24, TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(6, 0, 0, 0),
            Text = "Select employees (Ctrl / Shift for multiple), choose a shift and click 'Assign'."
        };
        Controls.Add(Ui.Card(_grid));
        Controls.Add(note);
        Controls.Add(bar);

        _dept.SelectedIndexChanged += (_, _) => LoadGrid();
        Load += (_, _) =>
        {
            using var db = new AppDbContext();
            _dept.Items.Add("All departments");
            _dept.Items.AddRange(db.Departments.AsNoTracking().OrderBy(d => d.Name).ToArray<object>());
            _shift.Items.Add("(none)");
            _shift.Items.AddRange(db.Shifts.AsNoTracking().OrderBy(s => s.Name).ToArray<object>());
            _shift.SelectedIndex = Math.Min(1, _shift.Items.Count - 1);
            _dept.SelectedIndex = 0;
        };
    }

    private void LoadGrid()
    {
        using var db = new AppDbContext();
        var q = db.Employees.AsNoTracking().Include(e => e.Department).Include(e => e.Shift).Where(e => e.IsActive);
        if (_dept.SelectedItem is Department d)
        {
            var ids = DepartmentWindow.WithChildren(d.Id);
            q = q.Where(e => e.DepartmentId != null && ids.Contains(e.DepartmentId.Value));
        }
        _grid.DataSource = Ui.ToTable(q.AsEnumerable().OrderBy(e => AttendanceProcessor.SortKey(e.EnrollNo)),
            ("Id", e => e.Id), ("AC No", e => e.EnrollNo), ("Name", e => e.Name), ("Department", e => e.Department?.Name),
            ("Shift", e => e.Shift?.ToString()), ("Weekly Off", e => e.Shift?.WeeklyOffs));
        _grid.Columns["Id"]!.Visible = false;
    }

    private void Assign()
    {
        var ids = Ui.SelectedIds(_grid);
        if (ids.Count == 0) { Ui.Info("Select employees first."); return; }
        int? shiftId = (_shift.SelectedItem as Shift)?.Id;
        using var db = new AppDbContext();
        db.Employees.Where(e => ids.Contains(e.Id)).ExecuteUpdate(s => s.SetProperty(e => e.ShiftId, shiftId));
        LoadGrid();
        AppState.RaiseDataChanged();
        Ui.Info($"Shift assigned to {ids.Count} employee(s).");
    }
}
