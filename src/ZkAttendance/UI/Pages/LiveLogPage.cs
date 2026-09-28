using Microsoft.EntityFrameworkCore;
using ZkAttendance.Data;
using ZkAttendance.Services;

namespace ZkAttendance.UI.Pages;

/// <summary>
/// Today's punches as they come in: newest first with the employee photo, the latest punch shown large,
/// the day's counts and who has not come yet. While open it asks the device for new punches every 30 seconds.
/// </summary>
public class LiveLogPage : PageBase
{
    public override string Title => "Live Log";

    private const int RefreshSeconds = 30;
    private const int ThumbHeight = 48;

    private readonly DateTimePicker _date = new() { Format = DateTimePickerFormat.Custom, CustomFormat = "dd-MM-yyyy", Width = 110, Margin = new Padding(0, 4, 8, 0) };
    private readonly CheckBox _auto = new() { Text = $"Device se har {RefreshSeconds} sec naye punch lao", Checked = true, AutoSize = true, Margin = new Padding(8, 6, 8, 0) };
    private readonly Label _status = Ui.Label("", color: Theme.Muted);
    private readonly DataGridView _punches = Ui.Grid();
    private readonly DataGridView _notCome = Ui.Grid();
    private readonly PictureBox _bigPhoto = new() { SizeMode = PictureBoxSizeMode.Zoom, BorderStyle = BorderStyle.FixedSingle, BackColor = Color.White, Size = new Size(120, 140), Location = new Point(12, 10) };
    private readonly Label _bigName = new() { Font = Theme.Big, AutoSize = true, Location = new Point(146, 14) };
    private readonly Label _bigInfo = new() { Font = Theme.Title, AutoSize = true, Location = new Point(148, 50), ForeColor = Theme.Muted };
    private readonly Label _bigTime = new() { Font = Theme.Big, AutoSize = true, Location = new Point(148, 80), ForeColor = Theme.Accent };
    private readonly Label _stats = new() { Font = Theme.Title, AutoSize = true, Dock = DockStyle.Right, Padding = new Padding(0, 14, 16, 0), TextAlign = ContentAlignment.TopRight };
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = RefreshSeconds * 1000 };
    private readonly Dictionary<int, (string? base64, Image? thumb)> _thumbs = new();
    private readonly Image _noPhoto = Icons.Get(Icons.Person, Color.Silver, ThumbHeight - 8);
    private bool _syncing;

    public LiveLogPage()
    {
        _date.Value = DateTime.Today;
        _date.ValueChanged += (_, _) => Reload();
        Toolbar.Controls.Add(Ui.Label("Date"));
        Toolbar.Controls.Add(_date);
        Toolbar.Controls.Add(Ui.Button("⟳ Refresh", async (s, _) => await Ui.Busy((Control)s!, SyncAndReload), ButtonStyle.Primary));
        Toolbar.Controls.Add(_auto);
        Toolbar.Controls.Add(_status);

        // ---- latest punch card + counts
        var card = new Panel { Dock = DockStyle.Top, Height = 162, BackColor = Theme.Card, BorderStyle = BorderStyle.FixedSingle };
        card.Controls.AddRange([_bigPhoto, _bigName, _bigInfo, _bigTime, _stats]);

        // ---- punches (left) and not-come-yet (right)
        _punches.RowTemplate.Height = ThumbHeight + 4;
        _punches.AutoGenerateColumns = false;
        _punches.Columns.Add(new DataGridViewImageColumn { Name = "Photo", HeaderText = "Photo", ImageLayout = DataGridViewImageCellLayout.Zoom, FillWeight = 35 });
        foreach (var (name, weight) in new[] { ("Time", 45), ("AC No", 35), ("Name", 110), ("Department", 70), ("IN / OUT", 40), ("Verify", 55), ("Source", 45) })
            _punches.Columns.Add(new DataGridViewTextBoxColumn { Name = name, HeaderText = name, FillWeight = weight });
        _punches.Columns["Time"]!.DefaultCellStyle.Font = Theme.Bold;
        _punches.CellFormatting += (_, e) =>
        {
            if (e.RowIndex < 0 || _punches.Columns[e.ColumnIndex].Name != "IN / OUT") return;
            e.CellStyle!.ForeColor = e.Value as string == "IN" ? Theme.Success : Theme.Warning;
            e.CellStyle.Font = Theme.Bold;
        };

        var left = new Panel { Dock = DockStyle.Fill };
        left.Controls.Add(Ui.Card(_punches));
        left.Controls.Add(new HeaderBar("Punches (sabse naya upar)"));
        var right = new Panel { Dock = DockStyle.Right, Width = 320 };
        right.Controls.Add(Ui.Card(_notCome));
        right.Controls.Add(new HeaderBar("Abhi tak nahi aaye"));

        var lists = new Panel { Dock = DockStyle.Fill, Padding = new Padding(0, 8, 0, 0) };
        lists.Controls.Add(left);
        lists.Controls.Add(new Splitter { Dock = DockStyle.Right, Width = 6 });
        lists.Controls.Add(right);
        Body.Controls.Add(lists);
        Body.Controls.Add(card);

        _timer.Tick += async (_, _) => { if (_auto.Checked && _date.Value.Date == DateTime.Today) await SyncAndReload(); };
        AppState.DataChanged += OnDataChanged;
        HandleDestroyed += (_, _) =>
        {
            _timer.Stop();
            AppState.DataChanged -= OnDataChanged;
        };
    }

    public override void OnActivated()
    {
        Reload();
        _timer.Start();
    }

    private void OnDataChanged()
    {
        if (IsHandleCreated && !IsDisposed) BeginInvoke(Reload);
    }

    /// <summary>Asks the connected device(s) for new punches (only downloads when the device count changed), then redraws.</summary>
    private async Task SyncAndReload()
    {
        if (_syncing) return;
        _syncing = true;
        try { await AutoSync.RunOnce(); }
        finally { _syncing = false; }
        Reload();
    }

    private void Reload()
    {
        try
        {
            var day = _date.Value.Date;
            using var db = new AppDbContext();
            var emps = db.Employees.AsNoTracking().Include(e => e.Department).ToList();
            var byEnroll = emps.GroupBy(e => e.EnrollNo).ToDictionary(g => g.Key, g => g.First());
            var logs = db.AttendanceLogs.AsNoTracking()
                .Where(a => a.PunchTime >= day && a.PunchTime < day.AddDays(1))
                .OrderBy(a => a.PunchTime).ToList();

            // First punch of the day = IN, later ones = OUT (same rule as the attendance calculation).
            var seen = new HashSet<string>();
            var rows = logs.Select(a => (log: a, inOut: seen.Add(a.EnrollNo) ? "IN" : "OUT")).Reverse().ToList();

            _punches.SuspendLayout();
            _punches.Rows.Clear();
            foreach (var (log, inOut) in rows)
            {
                byEnroll.TryGetValue(log.EnrollNo, out var e);
                _punches.Rows.Add(Thumb(e), log.PunchTime.ToString("HH:mm:ss"), log.EnrollNo, e?.Name ?? "(software me nahi)",
                    e?.Department?.Name ?? "", inOut, VerifyName(log.VerifyMode), SourceName(log.Source));
            }
            _punches.ResumeLayout();
            _punches.ClearSelection();

            ShowLatest(rows.Count > 0 ? rows[0] : null, byEnroll);

            // Counts and who has not come, from the normal attendance rules (shift window, leave, weekly off).
            var records = AttendanceProcessor.Process(day, day);
            int total = records.Count(r => r.Status != DayStatus.NotJoined);
            int came = records.Count(r => r.PunchCount > 0);
            int late = records.Count(r => r.LateMinutes > 0);
            int leave = records.Count(r => r.IsLeave && r.PunchCount == 0);
            var notCome = records.Where(r => r.PunchCount == 0 && r.Status == DayStatus.Absent).ToList();
            _stats.Text = $"Total: {total}\nAaye: {came}\nLate: {late}\nLeave: {leave}\nNahi aaye: {notCome.Count}\nPunches: {logs.Count}";

            _notCome.DataSource = Ui.ToTable(notCome, ("AC No", r => r.EnrollNo), ("Name", r => r.Name), ("Department", r => r.Department),
                ("Remark", r => r.Remark));
            _notCome.ClearSelection();

            _status.Text = $"Updated {DateTime.Now:HH:mm:ss}" +
                           (AppState.ConnectedCount == 0 ? "   —   Device connected nahi hai (Machine List → Connect)" : "");
        }
        catch (Exception ex) { _status.Text = "Error: " + ex.Message; }
    }

    private void ShowLatest((AttendanceLog log, string inOut)? latest, Dictionary<string, Employee> byEnroll)
    {
        _bigPhoto.Image?.Dispose();
        if (latest is not { } l)
        {
            _bigPhoto.Image = null;
            _bigName.Text = "Aaj abhi tak koi punch nahi";
            _bigInfo.Text = _bigTime.Text = "";
            return;
        }
        byEnroll.TryGetValue(l.log.EnrollNo, out var e);
        _bigPhoto.Image = PhotoStore.Decode(e?.PhotoBase64);
        _bigName.Text = e?.Name ?? $"AC No {l.log.EnrollNo}";
        _bigInfo.Text = $"AC No {l.log.EnrollNo}" + (e?.Department != null ? $"   |   {e.Department.Name}" : "") + $"   |   {VerifyName(l.log.VerifyMode)}";
        _bigTime.Text = $"{l.inOut}   {l.log.PunchTime:hh:mm:ss tt}";
        _bigTime.ForeColor = l.inOut == "IN" ? Theme.Success : Theme.Warning;
    }

    /// <summary>Row thumbnail, decoded once per employee and reused until the photo changes.</summary>
    private Image Thumb(Employee? e)
    {
        if (e == null) return _noPhoto;
        if (_thumbs.TryGetValue(e.Id, out var c) && c.base64 == e.PhotoBase64) return c.thumb ?? _noPhoto;
        c.thumb?.Dispose();
        var thumb = PhotoStore.Thumbnail(e.PhotoBase64, ThumbHeight);
        _thumbs[e.Id] = (e.PhotoBase64, thumb);
        return thumb ?? _noPhoto;
    }

    private static string VerifyName(int v) => v switch { 0 => "Password", 1 => "Fingerprint", 2 => "Card", 15 => "Face", _ => v.ToString() };

    private static string SourceName(PunchSource s) => s switch { PunchSource.Device => "Device", PunchSource.UsbFile => "Pendrive", _ => "Manual" };
}
