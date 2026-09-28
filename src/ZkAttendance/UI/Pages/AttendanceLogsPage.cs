using System.Data;
using Microsoft.EntityFrameworkCore;
using ZkAttendance.Data;
using ZkAttendance.Services;

namespace ZkAttendance.UI.Pages;

/// <summary>
/// AC Log: raw punches with the employee photo, newest first. Opens on today; while the range includes today
/// it asks the device for new punches every 30 seconds and redraws only when something new arrived.
/// </summary>
public class AttendanceLogsPage : PageBase
{
    public override string Title => "Attendance Logs (Raw Punches)";

    private const int RefreshSeconds = 30;
    private const int ThumbHeight = 80;

    private readonly DataGridView _grid = Ui.Grid();
    private readonly DateTimePicker _from = new() { Format = DateTimePickerFormat.Custom, CustomFormat = "dd-MM-yyyy", Width = 120, Margin = new Padding(0, 4, 8, 0) };
    private readonly DateTimePicker _to = new() { Format = DateTimePickerFormat.Custom, CustomFormat = "dd-MM-yyyy", Width = 120, Margin = new Padding(0, 4, 8, 0) };
    private readonly ComboBox _emp = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 230, Margin = new Padding(0, 4, 8, 0) };
    private readonly CheckBox _live = new() { Text = $"Live (every {RefreshSeconds} sec from device)", Checked = true, AutoSize = true, Margin = new Padding(4, 6, 8, 0) };
    private readonly Label _count = Ui.Label("", color: Theme.Muted);
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = RefreshSeconds * 1000 };
    private readonly Dictionary<int, (string? base64, Image? thumb)> _thumbs = new();
    private readonly Image _noPhoto = Icons.Get(Icons.Person, Color.Silver, ThumbHeight - 20);
    /// <summary>Newest punch id and count of the current view, to skip redraws when nothing changed.</summary>
    private (long lastId, int count) _shown = (-1, -1);
    private bool _syncing;

    public AttendanceLogsPage()
    {
        _from.Value = DateTime.Today;
        _to.Value = DateTime.Today;
        Toolbar.Controls.Add(Ui.Label("From"));
        Toolbar.Controls.Add(_from);
        Toolbar.Controls.Add(Ui.Label("To"));
        Toolbar.Controls.Add(_to);
        Toolbar.Controls.Add(_emp);
        Toolbar.Controls.Add(Ui.Button("Show", (_, _) => LoadData(force: true), ButtonStyle.Primary));
        Toolbar.Controls.Add(Ui.Button("Today", (_, _) => { _from.Value = _to.Value = DateTime.Today; LoadData(force: true); }));
        Toolbar.Controls.Add(Ui.Button("＋ Manual Punch", (_, _) => AddManual()));
        Toolbar.Controls.Add(Ui.Button("🗑 Delete", (_, _) => Delete(), ButtonStyle.Danger));
        Toolbar.Controls.Add(Ui.Button("⤓ Excel", (_, _) => Export()));
        Toolbar.Controls.Add(_live);
        Toolbar.Controls.Add(_count);

        _grid.RowTemplate.Height = ThumbHeight + 4;
        _grid.DataBindingComplete += (_, _) =>
        {
            if (_grid.Columns["Photo"] is DataGridViewImageColumn photo)
            {
                photo.ImageLayout = DataGridViewImageCellLayout.Zoom;
                photo.AutoSizeMode = DataGridViewAutoSizeColumnMode.None;
                photo.Width = ThumbHeight + 10;
            }
            if (_grid.Columns["Id"] is { } id) id.Visible = false;
            _grid.ClearSelection();
        };
        _grid.CellFormatting += (_, e) =>
        {
            if (e.RowIndex < 0 || _grid.Columns[e.ColumnIndex].Name != "IN / OUT") return;
            e.CellStyle!.ForeColor = e.Value as string == "IN" ? Theme.Success : Theme.Warning;
            e.CellStyle.Font = Theme.Bold;
        };
        Body.Controls.Add(Ui.Card(_grid));

        _timer.Tick += async (_, _) => await LiveTick();
        AppState.DataChanged += OnDataChanged;
        HandleDestroyed += (_, _) =>
        {
            _timer.Stop();
            AppState.DataChanged -= OnDataChanged;
        };
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
        LoadData(force: true);
        _timer.Start();
    }

    private bool ShowsToday => _from.Value.Date <= DateTime.Today && _to.Value.Date >= DateTime.Today;

    /// <summary>Asks the connected device(s) for new punches; AutoSync downloads only when the device count changed.</summary>
    private async Task LiveTick()
    {
        if (!_live.Checked || !ShowsToday || _syncing) return;
        _syncing = true;
        try { await AutoSync.RunOnce(); }
        finally { _syncing = false; }
        LoadData(force: false);
    }

    private void OnDataChanged()
    {
        if (IsHandleCreated && !IsDisposed) BeginInvoke(() => LoadData(force: false));
    }

    /// <param name="force">false = redraw only when new punches arrived (keeps the user's selection and scroll).</param>
    private void LoadData(bool force)
    {
        try
        {
            using var db = new AppDbContext();
            var from = _from.Value.Date;
            var to = _to.Value.Date.AddDays(1);
            var q = db.AttendanceLogs.AsNoTracking().Where(a => a.PunchTime >= from && a.PunchTime < to);
            if (_emp.SelectedItem is Employee emp) q = q.Where(a => a.EnrollNo == emp.EnrollNo);
            var rows = q.OrderByDescending(a => a.PunchTime).ThenByDescending(a => a.Id).Take(20000).ToList();

            var state = (rows.Count > 0 ? rows.Max(r => r.Id) : 0, rows.Count);
            if (!force && state == _shown) { UpdateCount(rows.Count); return; }
            _shown = state;

            var emps = db.Employees.AsNoTracking().ToList().GroupBy(e => e.EnrollNo).ToDictionary(g => g.Key, g => g.First());

            // First punch of an employee on a day = IN, later ones = OUT (same rule as the attendance calculation).
            var firsts = rows.GroupBy(r => (r.EnrollNo, r.PunchTime.Date)).Select(g => g.MinBy(r => r.PunchTime)!.Id).ToHashSet();

            var t = new DataTable();
            t.Columns.Add("Id", typeof(long));
            foreach (var c in new[] { "Date", "Time", "Emp ID", "Name", "IN / OUT" }) t.Columns.Add(c);
            t.Columns.Add("Photo", typeof(Image));
            foreach (var c in new[] { "Verify", "Source", "Remark" }) t.Columns.Add(c);
            foreach (var a in rows)
            {
                emps.TryGetValue(a.EnrollNo, out var e);
                t.Rows.Add(a.Id, a.PunchTime.ToString("dd-MM-yyyy ddd"), a.PunchTime.ToString("HH:mm:ss"), a.EnrollNo,
                    e?.Name ?? "(not in software)", firsts.Contains(a.Id) ? "IN" : "OUT", Thumb(e), Verify(a.VerifyMode), SourceName(a.Source), a.Remark);
            }
            _grid.DataSource = t;
            UpdateCount(rows.Count);
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    /// <summary>Punch count, plus today's came / late / not-come when today is shown alone.</summary>
    private void UpdateCount(int punches)
    {
        var text = $"{punches} punches";
        if (_from.Value.Date == DateTime.Today && _to.Value.Date == DateTime.Today && _emp.SelectedItem is not Employee)
        {
            var today = AttendanceProcessor.Process(DateTime.Today, DateTime.Today);
            int came = today.Count(r => r.PunchCount > 0);
            int late = today.Count(r => r.LateMinutes > 0);
            int notCome = today.Count(r => r.PunchCount == 0 && r.Status == DayStatus.Absent);
            text += $"   |   Present: {came}   Late: {late}   Absent: {notCome}";
        }
        if (ShowsToday && _live.Checked)
            text += $"   |   Updated {DateTime.Now:HH:mm:ss}" + (AppState.ConnectedCount == 0 ? " (device not connected)" : "");
        _count.Text = text;
    }

    /// <summary>Row thumbnail, decoded once per employee and reused until the photo changes.</summary>
    private Image Thumb(Employee? e)
    {
        if (e == null) return _noPhoto;
        if (_thumbs.TryGetValue(e.Id, out var c) && c.base64 == e.PhotoBase64) return c.thumb ?? _noPhoto;
        var thumb = PhotoStore.Thumbnail(e.PhotoBase64, ThumbHeight);
        _thumbs[e.Id] = (e.PhotoBase64, thumb);
        return thumb ?? _noPhoto;
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
            dlg.Validator = () => emp.SelectedItem == null ? "Select an employee." : null;
            if (dlg.ShowDialog(this) != DialogResult.OK) return;

            var e = (Employee)emp.SelectedItem!;
            var t = time.Value;
            t = new DateTime(t.Year, t.Month, t.Day, t.Hour, t.Minute, t.Second);
            if (db.AttendanceLogs.Any(a => a.EnrollNo == e.EnrollNo && a.PunchTime == t)) { Ui.Info("A punch already exists at this time."); return; }
            db.AttendanceLogs.Add(new AttendanceLog
            {
                EnrollNo = e.EnrollNo, PunchTime = t, InOutMode = state.SelectedIndex, Source = PunchSource.Manual,
                Remark = remark.Text.Trim(), VerifyMode = -1
            });
            db.SaveChanges();
            AppState.RaiseDataChanged();
            LoadData(force: true);
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private void Delete()
    {
        var ids = _grid.SelectedRows.Cast<DataGridViewRow>().Select(r => r.Cells["Id"].Value).OfType<long>().ToList();
        if (ids.Count == 0 || !Ui.Confirm($"Delete {ids.Count} punch(es)?")) return;
        try
        {
            using var db = new AppDbContext();
            db.AttendanceLogs.Where(a => ids.Contains(a.Id)).ExecuteDelete();
            AppState.RaiseDataChanged();
            LoadData(force: true);
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private void Export()
    {
        if (_grid.DataSource is not DataTable t) return;
        var path = Ui.SaveFile("Excel (*.xlsx)|*.xlsx", $"Punches_{_from.Value:yyyyMMdd}_{_to.Value:yyyyMMdd}.xlsx");
        if (path == null) return;
        try
        {
            var copy = t.Copy();
            copy.Columns.Remove("Id");
            copy.Columns.Remove("Photo");
            ExcelExporter.Export(new ReportResult { Title = "Attendance Punches", Subtitle = $"{_from.Value:dd-MM-yyyy} to {_to.Value:dd-MM-yyyy}", Table = copy }, path);
            Ui.Info("Export complete: " + path);
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private static string Verify(int v) => v switch
    {
        -1 => "Manual", 0 => "Password", 1 => "Finger", 2 => "Card", 15 => "Face", _ => v.ToString()
    };

    private static string SourceName(PunchSource s) => s switch { PunchSource.Device => "Device", PunchSource.UsbFile => "USB Drive", _ => "Manual" };
}
