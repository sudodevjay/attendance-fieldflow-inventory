using Microsoft.EntityFrameworkCore;
using ZkAttendance.Data;
using ZkAttendance.Services;

namespace ZkAttendance.UI.Pages;

public class AttendanceLogsPage : PageBase
{
    public override string Title => "Attendance Logs (Raw Punches)";

    private readonly DataGridView _grid = Ui.Grid();
    private readonly DateTimePicker _from = new() { Format = DateTimePickerFormat.Custom, CustomFormat = "dd-MM-yyyy", Width = 120, Margin = new Padding(0, 4, 8, 0) };
    private readonly DateTimePicker _to = new() { Format = DateTimePickerFormat.Custom, CustomFormat = "dd-MM-yyyy", Width = 120, Margin = new Padding(0, 4, 8, 0) };
    private readonly ComboBox _emp = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 230, Margin = new Padding(0, 4, 8, 0) };
    private readonly Label _count = Ui.Label("", color: Theme.Muted);

    public AttendanceLogsPage()
    {
        _from.Value = DateTime.Today.AddDays(-6);
        _to.Value = DateTime.Today;
        Toolbar.Controls.Add(Ui.Label("From"));
        Toolbar.Controls.Add(_from);
        Toolbar.Controls.Add(Ui.Label("To"));
        Toolbar.Controls.Add(_to);
        Toolbar.Controls.Add(_emp);
        Toolbar.Controls.Add(Ui.Button("Show", (_, _) => LoadData(), ButtonStyle.Primary));
        Toolbar.Controls.Add(Ui.Button("＋ Manual Punch", (_, _) => AddManual()));
        Toolbar.Controls.Add(Ui.Button("🗑 Delete", (_, _) => Delete(), ButtonStyle.Danger));
        Toolbar.Controls.Add(Ui.Button("⤓ Excel", (_, _) => Export()));
        Toolbar.Controls.Add(_count);
        Body.Controls.Add(Ui.Card(_grid));
    }

    public override void OnActivated()
    {
        using var db = new AppDbContext();
        var sel = (_emp.SelectedItem as Employee)?.Id;
        _emp.Items.Clear();
        _emp.Items.Add("All employees");
        _emp.Items.AddRange(db.Employees.AsNoTracking().AsEnumerable().OrderBy(e => AttendanceProcessor.SortKey(e.EnrollNo)).ToArray<object>());
        _emp.SelectedIndex = 0;
        foreach (var i in _emp.Items) if (i is Employee e && e.Id == sel) _emp.SelectedItem = i;
        LoadData();
    }

    private void LoadData()
    {
        try
        {
            using var db = new AppDbContext();
            var from = _from.Value.Date;
            var to = _to.Value.Date.AddDays(1);
            var q = db.AttendanceLogs.AsNoTracking().Where(a => a.PunchTime >= from && a.PunchTime < to);
            if (_emp.SelectedItem is Employee emp) q = q.Where(a => a.EnrollNo == emp.EnrollNo);
            var rows = q.OrderByDescending(a => a.PunchTime).Take(20000).ToList();
            var names = db.Employees.AsNoTracking().ToDictionary(e => e.EnrollNo, e => e.Name);

            _grid.DataSource = Ui.ToTable(rows,
                ("Id", a => a.Id), ("Date", a => a.PunchTime.ToString("dd-MM-yyyy ddd")), ("Time", a => a.PunchTime.ToString("HH:mm:ss")),
                ("Emp ID", a => a.EnrollNo), ("Name", a => names.GetValueOrDefault(a.EnrollNo, "(unknown)")),
                ("Verify", a => Verify(a.VerifyMode)), ("State", a => State(a.InOutMode)),
                ("Source", a => a.Source.ToString()), ("Remark", a => a.Remark));
            _grid.Columns["Id"]!.Visible = false;
            _count.Text = $"{rows.Count} punches";
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private void AddManual()
    {
        try
        {
            using var db = new AppDbContext();
            var emps = db.Employees.Where(e => e.IsActive).AsEnumerable().OrderBy(e => AttendanceProcessor.SortKey(e.EnrollNo)).ToList();
            var dlg = new FormDialog("Manual Punch");
            var emp = dlg.AddCombo("Employee", emps, emps.FirstOrDefault(e => e.Id == (_emp.SelectedItem as Employee)?.Id));
            var time = dlg.AddDateTime("Punch time", DateTime.Today.AddHours(9));
            var state = dlg.AddCombo("Type", ["Check-In", "Check-Out"], "Check-In");
            var remark = dlg.AddText("Reason", "Forgot to punch");
            dlg.Validator = () => emp.SelectedItem == null ? "Employee chunein." : null;
            if (dlg.ShowDialog(this) != DialogResult.OK) return;

            var e = (Employee)emp.SelectedItem!;
            var t = time.Value;
            t = new DateTime(t.Year, t.Month, t.Day, t.Hour, t.Minute, t.Second);
            if (db.AttendanceLogs.Any(a => a.EnrollNo == e.EnrollNo && a.PunchTime == t)) { Ui.Info("Is time ka punch pehle se hai."); return; }
            db.AttendanceLogs.Add(new AttendanceLog
            {
                EnrollNo = e.EnrollNo, PunchTime = t, InOutMode = state.SelectedIndex, Source = PunchSource.Manual,
                Remark = remark.Text.Trim(), VerifyMode = -1
            });
            db.SaveChanges();
            AppState.RaiseDataChanged();
            LoadData();
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private void Delete()
    {
        var ids = _grid.SelectedRows.Cast<DataGridViewRow>().Select(r => r.Cells["Id"].Value).OfType<long>().ToList();
        if (ids.Count == 0 || !Ui.Confirm($"{ids.Count} punch(es) delete karein?")) return;
        try
        {
            using var db = new AppDbContext();
            db.AttendanceLogs.Where(a => ids.Contains(a.Id)).ExecuteDelete();
            AppState.RaiseDataChanged();
            LoadData();
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private void Export()
    {
        if (_grid.DataSource is not System.Data.DataTable t) return;
        var path = Ui.SaveFile("Excel (*.xlsx)|*.xlsx", $"Punches_{_from.Value:yyyyMMdd}_{_to.Value:yyyyMMdd}.xlsx");
        if (path == null) return;
        try
        {
            var copy = t.Copy();
            copy.Columns.Remove("Id");
            ExcelExporter.Export(new ReportResult { Title = "Attendance Punches", Subtitle = $"{_from.Value:dd-MM-yyyy} to {_to.Value:dd-MM-yyyy}", Table = copy }, path);
            Ui.Info("Export ho gaya: " + path);
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private static string Verify(int v) => v switch
    {
        -1 => "Manual", 0 => "Password", 1 => "Finger", 2 => "Card", 15 => "Face", _ => v.ToString()
    };

    private static string State(int s) => s switch
    {
        0 => "Check-In", 1 => "Check-Out", 2 => "Break-Out", 3 => "Break-In", 4 => "OT-In", 5 => "OT-Out", _ => s.ToString()
    };
}
