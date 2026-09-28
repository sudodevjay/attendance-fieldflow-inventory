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
            ? "Supervisor password badlein. Password khali chhodne par login band ho jayega."
            : "Supervisor password set karein. Iske baad program kholne par password poocha jayega.");
        var current = HasPassword ? dlg.AddText("Current password") : null;
        var pwd = dlg.AddText("New password");
        var again = dlg.AddText("Confirm password");
        foreach (var t in new[] { current, pwd, again }) if (t != null) t.UseSystemPasswordChar = true;
        dlg.Validator = () =>
        {
            if (current != null && Hash(current.Text) != AppDbContext.GetSetting(Key)) return "Current password galat hai.";
            if (pwd.Text != again.Text) return "Dono password same nahi hain.";
            return null;
        };
        if (dlg.ShowDialog(owner) != DialogResult.OK) return;
        AppDbContext.SetSetting(Key, pwd.Text.Length == 0 ? "" : Hash(pwd.Text));
        Ui.Info(pwd.Text.Length == 0 ? "Password hata diya gaya." : "Password set ho gaya.");
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
            MessageBox.Show("Password galat hai.", "Login", MessageBoxButtons.OK, MessageBoxIcon.Warning);
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
        dlg.AddNote("Late / early grace, half day aur overtime har shift me alag set hote hain (Maintenance Timetables). Yahan company-wide rules hain:");
        var window = dlg.AddNumber("Punch window starts (hours before shift)", r.WindowBeforeHours, 0, 12);
        var dup = dlg.AddNumber("Ignore repeat punch within (minutes)", r.DuplicateMinutes, 0, 120);
        var single = dlg.AddCombo("Only one punch in a day counts as", ["Present", "Half Day", "Absent"], r.SinglePunch);
        dlg.AddNote("Example: shift 09:00 aur window 4 ghante = subah 05:00 se agle din 05:00 tak ke punch us din ke maane jaate hain.\n" +
                    "Repeat punch: agar koi 2 minute me 2 baar finger lagaye to ek hi punch gina jayega.");
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
        dlg.AddNote("Monthly salary: ek din ka paisa = Salary ÷ mahine ke din. Pay = ek din × (Paid Days − late cut).\n" +
                    "Salary aur OT rate har employee ke 'Addition' tab me bharein.");
        var late = dlg.AddNumber("Kitni baar late = ½ din cut (0 = band)", r.LateCountForHalfDay, 0, 31);
        var ot = dlg.AddNumber("OT multiplier (OT rate 0 wale employees)", r.OtMultiplier, 0, 5);
        ot.DecimalPlaces = 2;
        ot.Increment = 0.5m;
        dlg.AddNote("Example: late = 3 → mahine me 3 late = ½ din, 6 late = 1 din cut.\n" +
                    "OT multiplier 1 = ek ghante ka normal paisa, 2 = double. Employee ka apna OT rate ho to wahi lagega.");
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
            Text = "Employees select karein (Ctrl / Shift se multiple), Shift chunein aur 'Assign' dabayein."
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
        if (ids.Count == 0) { Ui.Info("Pehle employees select karein."); return; }
        int? shiftId = (_shift.SelectedItem as Shift)?.Id;
        using var db = new AppDbContext();
        db.Employees.Where(e => ids.Contains(e.Id)).ExecuteUpdate(s => s.SetProperty(e => e.ShiftId, shiftId));
        LoadGrid();
        AppState.RaiseDataChanged();
        Ui.Info($"{ids.Count} employee(s) ko shift assign ho gayi.");
    }
}
