using Microsoft.EntityFrameworkCore;
using ZkAttendance.Data;
using ZkAttendance.Device;
using ZkAttendance.Services;
using ZkAttendance.UI.Pages;

namespace ZkAttendance.UI;

/// <summary>Main window laid out like the classic ZKTeco "Attendance Management Program".</summary>
public class MainForm : Form
{
    /// <summary>The running main window; screens open as tabs inside it.</summary>
    public static MainForm? Instance { get; private set; }

    private readonly ScreenTabs _tabs = new();
    private readonly DataGridView _machines = Ui.Grid();
    private readonly DataGridView _records = Ui.Grid();
    private readonly DataGridView _log = Ui.Grid();
    private readonly ToolStripStatusLabel _clock = new() { BorderSides = ToolStripStatusLabelBorderSides.Left, AutoSize = false, Width = 120, TextAlign = ContentAlignment.MiddleLeft };
    private readonly ToolStripStatusLabel _statusDevices = new() { Spring = true, TextAlign = ContentAlignment.MiddleLeft, BorderSides = ToolStripStatusLabelBorderSides.Left };
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 1000 };
    private int _logId;
    private int _recordId;

    public MainForm()
    {
        Instance = this;
        Text = $"Attendance Management Program - [{Session.UserName} {DateTime.Today.ToString("d/M/yyyy", System.Globalization.CultureInfo.InvariantCulture)}]";
        Font = Theme.Base;
        BackColor = Theme.Background;
        MinimumSize = new Size(1000, 640);
        Size = new Size(1300, 780);
        StartPosition = FormStartPosition.CenterScreen;
        WindowState = FormWindowState.Maximized;
        Icon = System.Drawing.Icon.FromHandle(Icons.Get(Icons.Fingerprint, Theme.Accent, 32).GetHicon());

        var content = new Panel { Dock = DockStyle.Fill, Padding = new Padding(4, 4, 4, 0), BackColor = Theme.NavBack };
        var inner = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Background };
        content.Controls.Add(inner);

        BuildMachineGrid();
        BuildRecordGrids();
        var split = new SplitContainer { Dock = DockStyle.Fill, Orientation = Orientation.Horizontal, SplitterWidth = 5, BackColor = Theme.Background };
        var machinePanel = new Panel { Dock = DockStyle.Fill, BorderStyle = BorderStyle.FixedSingle };
        machinePanel.Controls.Add(_machines);
        machinePanel.Controls.Add(new HeaderBar("Machine List"));
        split.Panel1.Controls.Add(machinePanel);

        var bottom = new SplitContainer { Dock = DockStyle.Fill, SplitterWidth = 5, BackColor = Theme.Background, FixedPanel = FixedPanel.Panel2 };
        bottom.Panel1.Controls.Add(Ui.Card(_records));
        bottom.Panel2.Controls.Add(Ui.Card(_log));
        split.Panel2.Controls.Add(bottom);
        _tabs.Open("machines", "Machine List", Icons.Get(Icons.Device, Color.FromArgb(40, 60, 90)), () => split, closable: false);
        inner.Controls.Add(_tabs);
        Load += (_, _) =>
        {
            split.SplitterDistance = (int)(split.Height * 0.52);
            bottom.SplitterDistance = Math.Max(200, bottom.Width - 360);
        };

        var status = new StatusStrip { Renderer = BlueColorTable.Renderer, Font = Theme.Base, SizingGrip = true };
        status.Items.Add(new ToolStripStatusLabel(Session.UserName) { AutoSize = false, Width = 190, TextAlign = ContentAlignment.MiddleLeft });
        status.Items.Add(_clock);
        status.Items.Add(_statusDevices);

        var menu = BuildMenu();
        Controls.Add(content);
        Controls.Add(BuildNav());
        Controls.Add(BuildToolbar());
        Controls.Add(menu);
        Controls.Add(status);
        MainMenuStrip = menu;

        _timer.Tick += (_, _) => _clock.Text = DateTime.Now.ToString("hh:mm:ss tt");
        _timer.Start();
        AppState.Logged += (id, msg) => BeginInvokeSafe(() => AddLog(id, msg));
        AppState.DeviceStatusChanged += () => BeginInvokeSafe(LoadMachines);
        AdmsHost.LivePunches += (_, name, punches) => BeginInvokeSafe(() => ShowRecords(punches, name));
        AutoSync.NewPunches += (p, punches) => BeginInvokeSafe(() => ShowRecords(punches, p.Name));
        Shown += (_, _) =>
        {
            LoadMachines();
            _clock.Text = DateTime.Now.ToString("hh:mm:ss tt");
            try { AdmsHost.StartIfEnabled(); }
            catch (Exception ex) { AppState.Log(0, "ADMS server start failed: " + ex.Message); }
            AutoSync.Start();
        };
        // ADMS devices go online/offline on their own; refresh the Online status periodically.
        var statusTimer = new System.Windows.Forms.Timer { Interval = 15000 };
        statusTimer.Tick += (_, _) => { if (AdmsServer.Running) LoadMachines(); };
        statusTimer.Start();
    }

    /// <summary>Opens a screen as a tab in the main window (or switches to it if already open).</summary>
    public Control OpenScreen(string key, string title, Image? icon, Func<Control> factory) => _tabs.Open(key, title, icon, factory);

    // ---------------------------------------------------------------- layout

    private MenuStrip BuildMenu()
    {
        var m = new MenuStrip { Renderer = BlueColorTable.Renderer, Font = Theme.Base, Padding = new Padding(4, 2, 0, 2) };

        var data = new ToolStripMenuItem("Data");
        Add(data, "Import Attendance Checking Data", Icons.Import, Color.Green, ImportAttendance);
        Add(data, "Export Attendance Checking Data", Icons.Export, Color.DarkOrange, () => PageWindow.Show(this, new AttendanceLogsPage()));
        Add(data, "Backup Database", Icons.Backup, Color.SteelBlue, () => SettingsPage.BackupDatabase(this));
        Add(data, "Usb Disk Manage", Icons.Usb, Color.Black, ImportAttendance);
        data.DropDownItems.Add(new ToolStripSeparator());
        Add(data, "Exit", Icons.Power, Color.RoyalBlue, Close);

        var att = new ToolStripMenuItem("Attendance");
        Add(att, "Leave / Holidays", Icons.Flag, Color.Purple, () => PageWindow.Show(this, new LeavePage()));
        Add(att, "Append Manual Record (AC Log)", Icons.Clock, Theme.Accent, () => PageWindow.Show(this, new AttendanceLogsPage()));
        Add(att, "Attendance Rule", Icons.Rule, Color.SteelBlue, () => AttendanceRuleDialog.ShowRules(this));
        Add(att, "Salary Rule", Icons.Rule, Color.SeaGreen, () => PayrollRuleDialog.ShowRules(this));

        var search = new ToolStripMenuItem("Search/Print");
        Add(search, "Live Log (aaj ke punch)", Icons.Fingerprint, Color.SeaGreen, () => PageWindow.Show(this, new LiveLogPage()));
        Add(search, "Attendance Records (AC Log)", Icons.Search, Theme.Accent, () => PageWindow.Show(this, new AttendanceLogsPage()));
        Add(search, "Attendance Reports", Icons.Report, Theme.Accent, () => PageWindow.Show(this, new ReportsPage()));

        var maint = new ToolStripMenuItem("Maintenance/Options");
        Add(maint, "Department List", Icons.Home, Color.SeaGreen, () => DepartmentWindow.Open(this));
        Add(maint, "Administrator", Icons.Lock, Color.DarkGoldenrod, () => AdminDialog.ShowAdmin(this));
        Add(maint, "Employees", Icons.People, Color.Chocolate, () => EmployeeWindow.Open(this));
        maint.DropDownItems.Add(new ToolStripSeparator());
        Add(maint, "Maintenance Timetables", Icons.Timer, Color.Brown, () => PageWindow.Show(this, new ShiftsPage()));
        Add(maint, "Holidays / Leave Class", Icons.Sun, Color.DarkOrange, () => PageWindow.Show(this, new LeavePage()));
        Add(maint, "Attendance Rule", Icons.Rule, Color.SteelBlue, () => AttendanceRuleDialog.ShowRules(this));
        Add(maint, "Salary Rule", Icons.Rule, Color.SeaGreen, () => PayrollRuleDialog.ShowRules(this));
        maint.DropDownItems.Add(new ToolStripSeparator());
        Add(maint, "Database Option...", Icons.Settings, Color.DimGray, () => PageWindow.Show(this, new SettingsPage()));

        var dev = new ToolStripMenuItem("Device management");
        Add(dev, "Add Device", Icons.Add, Theme.Accent, () => EditDevice(null));
        Add(dev, "Edit Device", Icons.Rename, Theme.Accent, () => EditDevice(SelectedDeviceId()));
        Add(dev, "Delete Device", Icons.Close, Theme.Accent, DeleteDevice);
        dev.DropDownItems.Add(new ToolStripSeparator());
        Add(dev, "Connect", Icons.Play, Color.Green, () => _ = Connect());
        Add(dev, "Disconnect", Icons.Stop, Color.Red, () => _ = Disconnect());
        dev.DropDownItems.Add(new ToolStripSeparator());
        Add(dev, "Download attendance logs", Icons.Download, Color.Green, () => _ = DownloadLogs());
        Add(dev, "Download user info and Fp", Icons.Download, Theme.Accent, () => _ = DownloadUsers());
        Add(dev, "Upload user info and FP", Icons.Upload, Color.DarkOrange, () => _ = UploadUsers());
        dev.DropDownItems.Add(new ToolStripSeparator());
        Add(dev, "Synchronize Time", Icons.Sync, Theme.Accent, () => _ = SyncTime());
        Add(dev, "Device Information", Icons.Info, Theme.Accent, () => _ = ShowInfo());
        Add(dev, "Clear Attendance Logs", Icons.Delete, Color.Red, () => _ = ClearLogs());
        Add(dev, "Restart Device", Icons.Refresh, Color.DimGray, () => _ = RestartDevice());

        var help = new ToolStripMenuItem("Help");
        Add(help, "Help (README)", Icons.Help, Theme.Accent, OpenReadme);
        Add(help, "About", Icons.Info, Theme.Accent, () => Ui.Info("Attendance Management Program\n\nDrivers: ZKTeco SDK (USB / Serial / TCP), ADMS Push, pendrive file import\n.NET 8 WinForms + SQL Server"));

        m.Items.AddRange([data, att, search, maint, dev, help]);
        return m;
    }

    private static void Add(ToolStripMenuItem parent, string text, string glyph, Color color, Action onClick)
    {
        var item = new ToolStripMenuItem(text, Icons.Get(glyph, color), (_, _) => Safe(onClick));
        parent.DropDownItems.Add(item);
    }

    private ToolStrip BuildToolbar()
    {
        var t = Bars.Large();
        Bars.Button(t, "Employees", Icons.Get(Icons.People, Color.Chocolate, 32), (_, _) => Safe(() => EmployeeWindow.Open(this)));
        Bars.Button(t, "Live Log", Icons.Get(Icons.Fingerprint, Color.SeaGreen, 32), (_, _) => Safe(() => PageWindow.Show(this, new LiveLogPage())));
        Bars.Button(t, "AC Log", Icons.Get(Icons.Clock, Theme.Accent, 32), (_, _) => Safe(() => PageWindow.Show(this, new AttendanceLogsPage())));
        Bars.Button(t, "Report", Icons.Get(Icons.Report, Color.SteelBlue, 32), (_, _) => Safe(() => PageWindow.Show(this, new ReportsPage())));
        t.Items.Add(new ToolStripSeparator());

        var device = new ToolStripSplitButton("Device", Icons.Get(Icons.Device, Color.FromArgb(40, 60, 90), 32))
        {
            TextImageRelation = TextImageRelation.ImageAboveText, Margin = new Padding(3, 1, 3, 2)
        };
        device.ButtonClick += (_, _) => Safe(() => EditDevice(null));
        device.DropDownItems.Add("Add Device", Icons.Get(Icons.Add, Theme.Accent), (_, _) => Safe(() => EditDevice(null)));
        device.DropDownItems.Add("Edit Device", Icons.Get(Icons.Rename, Theme.Accent), (_, _) => Safe(() => EditDevice(SelectedDeviceId())));
        device.DropDownItems.Add("Device Information", Icons.Get(Icons.Info, Theme.Accent), (_, _) => _ = ShowInfo());
        device.DropDownItems.Add("Synchronize Time", Icons.Get(Icons.Sync, Theme.Accent), (_, _) => _ = SyncTime());
        t.Items.Add(device);
        Bars.Button(t, "Del Device", Icons.Get(Icons.Close, Color.FromArgb(30, 100, 210), 32), (_, _) => Safe(DeleteDevice));
        t.Items.Add(new ToolStripSeparator());
        Bars.Button(t, "Connect", Icons.Get(Icons.Play, Color.Green, 32, Color.FromArgb(40, 170, 60)), async (_, _) => await Connect());
        Bars.Button(t, "Disconnect", Icons.Get(Icons.Stop, Color.Red, 32, Color.FromArgb(220, 30, 30)), async (_, _) => await Disconnect());
        t.Items.Add(new ToolStripSeparator());
        Bars.Button(t, "Exit system", Icons.Get(Icons.Power, Color.Blue, 32, Color.FromArgb(40, 110, 220)), (_, _) => Close());
        return t;
    }

    private NavPanel BuildNav()
    {
        var nav = new NavPanel();
        nav.AddGroup("Data Maintenance")
            .Item("Live Log (aaj ke punch)", Icons.Get(Icons.Fingerprint, Color.SeaGreen), () => PageWindow.Show(this, new LiveLogPage()))
            .Item("Import Attendance Checking Data", Icons.Get(Icons.Import, Color.Green), ImportAttendance)
            .Item("Export Attendance Checking Data", Icons.Get(Icons.Export, Color.DarkOrange), () => PageWindow.Show(this, new AttendanceLogsPage()))
            .Item("Backup Database", Icons.Get(Icons.Backup, Color.SteelBlue), () => SettingsPage.BackupDatabase(this))
            .Item("Usb Disk Manage", Icons.Get(Icons.Usb, Color.Black), ImportAttendance);
        nav.AddGroup("Machine")
            .Item("Download attendance logs", Icons.Get(Icons.Download, Color.Green), () => _ = DownloadLogs())
            .Item("Download user info and Fp", Icons.Get(Icons.Download, Theme.Accent), () => _ = DownloadUsers())
            .Item("Upload user info and FP", Icons.Get(Icons.Upload, Color.DarkOrange), () => _ = UploadUsers())
            .Item("Attendance Photo Management", Icons.Get(Icons.Photo, Color.DimGray), NotSupported)
            .Item("AC Manage", Icons.Get(Icons.Door, Color.SeaGreen), NotSupported);
        nav.AddGroup("Maintenance/Options")
            .Item("Department List", Icons.Get(Icons.Home, Color.SeaGreen), () => DepartmentWindow.Open(this))
            .Item("Administrator", Icons.Get(Icons.Lock, Color.DarkGoldenrod), () => AdminDialog.ShowAdmin(this))
            .Item("Employees", Icons.Get(Icons.People, Color.Chocolate), () => EmployeeWindow.Open(this))
            .Item("Database Option...", Icons.Get(Icons.Settings, Color.DimGray), () => PageWindow.Show(this, new SettingsPage()));
        nav.AddGroup("Employee Schedule")
            .Item("Maintenance Timetables", Icons.Get(Icons.Timer, Color.Brown), () => PageWindow.Show(this, new ShiftsPage()))
            .Item("Shifts Management", Icons.Get(Icons.Calendar, Color.Brown), () => PageWindow.Show(this, new ShiftsPage()))
            .Item("Employee Schedule", Icons.Get(Icons.Table, Color.Brown), () => EmployeeScheduleWindow.Open(this))
            .Item("Attendance Rule", Icons.Get(Icons.Rule, Theme.Accent), () => AttendanceRuleDialog.ShowRules(this))
            .Item("Salary Rule", Icons.Get(Icons.Rule, Color.SeaGreen), () => PayrollRuleDialog.ShowRules(this))
            .Item("Leave / Holidays", Icons.Get(Icons.Flag, Color.Purple), () => PageWindow.Show(this, new LeavePage()));
        return nav;
    }

    private void BuildMachineGrid()
    {
        var g = _machines;
        g.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.None;
        g.Columns.Add(new DataGridViewImageColumn { Name = "Icon", HeaderText = "", Width = 22, ImageLayout = DataGridViewImageCellLayout.Normal });
        (string name, int width)[] cols =
        [
            ("Device Name", 110), ("Status", 95), ("MachineNo", 70), ("Comm type", 100), ("Baud Rate", 70), ("IP Address", 105),
            ("Port", 60), ("ProductName", 85), ("UserCount", 70), ("Admin Count", 75), ("Fp Count", 60), ("Fc Count", 60),
            ("Passwo..", 60), ("Log Count", 70), ("Serial Number", 130)
        ];
        foreach (var (name, width) in cols)
            g.Columns.Add(new DataGridViewTextBoxColumn { Name = name, HeaderText = name, Width = width, SortMode = DataGridViewColumnSortMode.NotSortable });
        g.Columns.Add(new DataGridViewTextBoxColumn { Name = "Id", Visible = false });
        foreach (DataGridViewColumn c in g.Columns)
            if (c.Name != "Device Name" && c.Name != "Icon") c.DefaultCellStyle.Alignment = DataGridViewContentAlignment.MiddleCenter;

        g.SelectionChanged += (_, _) => AppState.CurrentDeviceId = SelectedDeviceId();
        g.CellDoubleClick += (_, e) => { if (e.RowIndex >= 0) Safe(() => EditDevice(SelectedDeviceId())); };

        var menu = new ContextMenuStrip { Renderer = BlueColorTable.Renderer };
        menu.Items.Add("Connect", Icons.Get(Icons.Play, Color.Green), async (_, _) => await Connect());
        menu.Items.Add("Disconnect", Icons.Get(Icons.Stop, Color.Red), async (_, _) => await Disconnect());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Download attendance logs", Icons.Get(Icons.Download, Color.Green), (_, _) => _ = DownloadLogs());
        menu.Items.Add("Download user info and Fp", Icons.Get(Icons.Download, Theme.Accent), (_, _) => _ = DownloadUsers());
        menu.Items.Add("Upload user info and FP", Icons.Get(Icons.Upload, Color.DarkOrange), (_, _) => _ = UploadUsers());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Device Information", Icons.Get(Icons.Info, Theme.Accent), (_, _) => _ = ShowInfo());
        menu.Items.Add("Synchronize Time", Icons.Get(Icons.Sync, Theme.Accent), (_, _) => _ = SyncTime());
        menu.Items.Add("Clear Attendance Logs", Icons.Get(Icons.Delete, Color.Red), (_, _) => _ = ClearLogs());
        menu.Items.Add("Restart Device", Icons.Get(Icons.Refresh, Color.DimGray), (_, _) => _ = RestartDevice());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Edit Device", Icons.Get(Icons.Rename, Theme.Accent), (_, _) => Safe(() => EditDevice(SelectedDeviceId())));
        menu.Items.Add("Delete Device", Icons.Get(Icons.Close, Theme.Accent), (_, _) => Safe(DeleteDevice));
        g.ContextMenuStrip = menu;
        g.CellMouseDown += (_, e) =>
        {
            if (e.Button == MouseButtons.Right && e.RowIndex >= 0 && !g.Rows[e.RowIndex].Selected)
            {
                g.ClearSelection();
                g.Rows[e.RowIndex].Selected = true;
                g.CurrentCell = g.Rows[e.RowIndex].Cells[1];
            }
        };
    }

    private void BuildRecordGrids()
    {
        _records.RowHeadersVisible = true;
        _records.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.None;
        foreach (var (name, width) in new[] { ("Id", 40), ("Ac-No", 85), ("Name", 110), ("sTime", 125), ("Machine", 70), ("Verify Mode", 90) })
            _records.Columns.Add(new DataGridViewTextBoxColumn { Name = name, HeaderText = name, Width = width });

        _log.RowHeadersVisible = true;
        _log.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.None;
        var id = new DataGridViewTextBoxColumn { Name = "ID", HeaderText = "ID", Width = 34 };
        id.DefaultCellStyle.Alignment = DataGridViewContentAlignment.MiddleRight;
        _log.Columns.Add(id);
        _log.Columns.Add(new DataGridViewTextBoxColumn { Name = "Status", HeaderText = "Status", AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill });
        _log.Columns.Add(new DataGridViewTextBoxColumn { Name = "Time", HeaderText = "Time", Width = 92 });
    }

    // ---------------------------------------------------------------- data

    private void LoadMachines()
    {
        try
        {
            var selected = SelectedDeviceIds();
            _machines.Rows.Clear();
            foreach (var p in DeviceActions.All())
            {
                bool adms = p.Kind == ConnectionKind.Adms;
                bool on = adms ? AdmsServer.IsOnline(p.SerialNumber) : AppState.IsConnected(p.Id);
                var (comm, port) = p.Kind switch
                {
                    ConnectionKind.Usb => ("USB", ""),
                    ConnectionKind.Serial => ("Serial Port/RS485", p.ComPort),
                    ConnectionKind.Adms => ("ADMS (Push)", AdmsServer.Running ? AdmsServer.Port.ToString() : ""),
                    _ => ("Ethernet", p.TcpPort.ToString()),
                };
                string status = adms ? (on ? "Online" : "Waiting") : on ? "Connected" : "Disconnected";
                int i = _machines.Rows.Add(
                    Icons.Get(Icons.Sync, on ? Color.FromArgb(20, 160, 40) : Color.Gray),
                    p.Name, status, p.MachineNumber, comm,
                    p.Kind == ConnectionKind.Serial ? p.BaudRate.ToString() : "", p.Kind is ConnectionKind.Tcp or ConnectionKind.Adms ? p.IpAddress : "", port,
                    p.ProductName, p.UserCount, p.AdminCount, p.FpCount, p.FaceCount, p.PasswordCount, p.LogCount, p.SerialNumber, p.Id);
                _machines.Rows[i].Selected = selected.Contains(p.Id);
            }
            if (_machines.SelectedRows.Count == 0 && _machines.Rows.Count > 0) _machines.Rows[0].Selected = true;
            _statusDevices.Text = $"  Devices: {_machines.Rows.Count}   Connected: {AppState.ConnectedCount}";
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private int? SelectedDeviceId() =>
        _machines.CurrentRow?.Cells["Id"].Value is int id ? id : SelectedDeviceIds().Cast<int?>().FirstOrDefault();

    private List<int> SelectedDeviceIds() =>
        _machines.SelectedRows.Cast<DataGridViewRow>().Select(r => r.Cells["Id"].Value).OfType<int>().ToList();

    /// <summary>Selected devices; if none selected, the current one.</summary>
    private List<DeviceProfile> SelectedProfiles()
    {
        var ids = SelectedDeviceIds();
        var all = DeviceActions.All();
        var list = all.Where(p => ids.Contains(p.Id)).ToList();
        if (list.Count == 0 && all.Count > 0) list.Add(DeviceActions.Current());
        if (list.Count == 0) throw new DeviceException("Pehle Machine List me device add karein (toolbar → Device).");
        return list;
    }

    private void AddLog(int id, string msg)
    {
        int i = _log.Rows.Add(++_logId, $"[{id}] {msg}", DateTime.Now.ToString("HH:mm:ss MM-dd"));
        if (msg.StartsWith("failed", StringComparison.OrdinalIgnoreCase)) _log.Rows[i].DefaultCellStyle.ForeColor = Color.Red;
        else if (msg.StartsWith("Succeed", StringComparison.OrdinalIgnoreCase)) _log.Rows[i].DefaultCellStyle.ForeColor = Color.Green;
        _log.FirstDisplayedScrollingRowIndex = i;
        _log.ClearSelection();
    }

    private void ShowRecords(IEnumerable<DevicePunch> punches, string machine)
    {
        Dictionary<string, string> names;
        using (var db = new AppDbContext()) names = db.Employees.AsNoTracking().ToDictionary(e => e.EnrollNo, e => e.Name);
        foreach (var p in punches.OrderBy(p => p.Time).TakeLast(1000))
            _records.Rows.Add(++_recordId, p.EnrollNo, names.GetValueOrDefault(p.EnrollNo, ""), p.Time.ToString("dd-MM-yyyy HH:mm:ss"), machine, VerifyName(p.VerifyMode));
        if (_records.Rows.Count > 0) _records.FirstDisplayedScrollingRowIndex = _records.Rows.Count - 1;
    }

    private static string VerifyName(int v) => v switch { 0 => "Password", 1 => "FP", 2 => "Card", 15 => "Face", _ => v.ToString() };

    // ---------------------------------------------------------------- device commands

    private async Task Connect()
    {
        try
        {
            foreach (var p in SelectedProfiles())
            {
                try { await DeviceActions.Connect(p); }
                catch (Exception ex) { Ui.Error(ex); }
            }
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private async Task Disconnect()
    {
        try
        {
            foreach (var p in SelectedProfiles().Where(p => AppState.IsConnected(p.Id)))
                await DeviceActions.Disconnect(p.Id);
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private async Task OnSelected(string what, Func<DeviceProfile, IAttendanceDevice, Task> action)
    {
        UseWaitCursor = true;
        try
        {
            foreach (var p in SelectedProfiles())
            {
                try { await action(p, await DeviceActions.Ensure(p)); }
                catch (Exception ex)
                {
                    AppState.Log(p.Id, $"{what} failed");
                    Ui.Error(ex);
                }
            }
        }
        catch (Exception ex) { Ui.Error(ex); }
        finally { UseWaitCursor = false; }
    }

    private Task SyncTime() => OnSelected("Synchronize time", async (p, d) =>
    {
        d.Require(DeviceFeatures.SyncTime, "Synchronize time");
        await d.SyncTimeAsync();
        AppState.Log(p.Id, $"Synchronize time {DateTime.Now:HH:mm:ss} OK");
    });

    private Task DownloadLogs() => OnSelected("Download attendance logs", async (p, _) =>
    {
        var (punches, r) = await DeviceActions.DownloadAttendance(p);
        ShowRecords(punches, p.Name);
        try { await DeviceActions.RefreshInfo(p.Id); } catch { }
        Ui.Info($"{p.Name}: {punches.Count} records mile.\nNew saved: {r.Added}\nAlready in database: {r.Duplicates}" +
                (r.NewEmployees > 0 ? $"\nNew AC No. added to Employees: {r.NewEmployees}" : ""));
    });

    private Task DownloadUsers() => OnSelected("Download user info and Fp", async (p, _) =>
    {
        bool overwrite = Ui.Confirm("Software me jo employee naam pehle se hain, unhe device ke naam se overwrite karein?\n\n(No = sirf naye users aur khali naam update honge)");
        var (added, updated, fingers) = await DeviceActions.DownloadUsers(p, overwrite);
        Ui.Info($"{p.Name}: Download user info and Fp complete.\nNew: {added}\nUpdated: {updated}\nFingerprint templates: {fingers}");
    });

    private Task UploadUsers()
    {
        List<int> ids;
        using (var db = new AppDbContext()) ids = db.Employees.Where(e => e.IsActive).Select(e => e.Id).ToList();
        if (!Ui.Confirm($"{ids.Count} active employees (naam + fingerprints) selected device par upload karein?\n(Kuch hi employees bhejne ho to Employees window se upload karein.)"))
            return Task.CompletedTask;
        return OnSelected("Upload user info and FP", async (p, _) =>
        {
            int rejected = await DeviceActions.UploadUsers(p, ids);
            Ui.Info($"{p.Name}: {ids.Count} users upload ho gaye." + DeviceActions.RejectedFingersNote(rejected));
        });
    }

    private Task ShowInfo() => OnSelected("Device information", async (p, d) =>
    {
        d.Require(DeviceFeatures.Info, "Device information");
        var i = await d.GetInfoAsync();
        await DeviceActions.RefreshInfo(p.Id);
        Ui.Info($"Device        : {p.Name}\nDriver        : {d.Driver} ({DeviceDrivers.KindName(p.Kind)})\nProduct       : {i.ProductName}\nSerial Number : {i.SerialNumber}\nFirmware      : {i.Firmware}\n" +
                $"Platform      : {i.Platform}\nUsers         : {i.UserCount}{Cap(i.UserCapacity)}  (Admin {i.AdminCount})\nFingerprints  : {i.FingerCount}{Cap(i.FingerCapacity)}\n" +
                $"Passwords     : {i.PasswordCount}\nAtt. Logs     : {i.LogCount}{Cap(i.LogCapacity)}\nDevice Time   : {i.DeviceTime:dd-MM-yyyy HH:mm:ss}\nPC Time       : {DateTime.Now:dd-MM-yyyy HH:mm:ss}");
    });

    private static string Cap(int capacity) => capacity > 0 ? $" / {capacity}" : "";

    private Task ClearLogs()
    {
        if (!Ui.Confirm("Selected device ke saare attendance records delete honge.\nPehle download hoga, phir clear. Continue?")) return Task.CompletedTask;
        return OnSelected("Clear attendance logs", async (p, d) =>
        {
            d.Require(DeviceFeatures.ClearLogs, "Clear attendance logs");
            var (punches, _) = await DeviceActions.DownloadAttendance(p);
            ShowRecords(punches, p.Name);
            await d.ClearLogsAsync();
            AppState.Log(p.Id, "Clear attendance logs OK");
            await DeviceActions.RefreshInfo(p.Id);
        });
    }

    private Task RestartDevice()
    {
        if (!Ui.Confirm("Selected device restart karein?")) return Task.CompletedTask;
        return OnSelected("Restart", async (p, d) =>
        {
            d.Require(DeviceFeatures.Restart, "Restart device");
            await d.RestartAsync();
            AppState.Log(p.Id, "Restart command sent");
            AppState.RaiseDeviceStatus();
        });
    }

    private void EditDevice(int? id)
    {
        using var db = new AppDbContext();
        var p = id == null ? new DeviceProfile { Name = (db.DeviceProfiles.Count() + 1).ToString() } : db.DeviceProfiles.First(x => x.Id == id);
        string[] kinds = DeviceDrivers.KindNames;

        using var dlg = new FormDialog(id == null ? "Add Device" : "Edit Device", 400);
        var name = dlg.AddText("Device Name", p.Name);
        var kind = dlg.AddCombo("Comm type", kinds, kinds[(int)p.Kind]);
        var machine = dlg.AddNumber("Machine No.", p.MachineNumber, 1, 255);
        var com = dlg.AddCombo("Port (COM)", DeviceDrivers.ComPorts().Append(p.ComPort).Distinct(), p.ComPort);
        com.DropDownStyle = ComboBoxStyle.DropDown;
        var baud = dlg.AddCombo("Baud Rate", ["9600", "19200", "38400", "57600", "115200"], p.BaudRate.ToString());
        var ip = dlg.AddText("IP Address", p.IpAddress);
        var port = dlg.AddNumber("Port (TCP)", p.TcpPort, 1, 65535);
        var key = dlg.AddNumber("Comm Key (Password)", p.CommPassword, 0, 999999);
        var sn = dlg.AddText("Serial Number (ADMS)", p.SerialNumber);
        dlg.AddNote("USB / Serial / Ethernet: ZKTeco SDK se (LX50, K-series, iClock, eSSL, B&W aur TFT sab).\n" +
                    "LX50 mini-USB: Comm type = USB rakhein. Connect na ho to software khud saare COM ports / baud rates " +
                    "try karke jo setting chale use save kar leta hai.\n" +
                    "ADMS (Push / Cloud): device khud is PC par data bhejta hai. Device menu → Comm → Cloud Server Setting me " +
                    $"is PC ka IP aur port {AdmsHost.ConfiguredPort} daalein; Serial Number device ke System Info me milega.\n" +
                    "Comm Key device menu jaisa hi ho (default 0).");
        void Toggle()
        {
            com.Enabled = baud.Enabled = kind.SelectedIndex == 1;
            ip.Enabled = port.Enabled = kind.SelectedIndex == 2;
            sn.Enabled = kind.SelectedIndex == 3;
            machine.Enabled = key.Enabled = kind.SelectedIndex != 3;
        }
        kind.SelectedIndexChanged += (_, _) => Toggle();
        Toggle();
        dlg.Validator = () =>
            string.IsNullOrWhiteSpace(name.Text) ? "Device Name zaroori hai." :
            kind.SelectedIndex == 3 && string.IsNullOrWhiteSpace(sn.Text) ? "ADMS device ke liye Serial Number zaroori hai." : null;
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        var oldKind = p.Kind;

        p.Name = name.Text.Trim();
        p.Kind = (ConnectionKind)kind.SelectedIndex;
        p.MachineNumber = (int)machine.Value;
        p.ComPort = com.Text.Trim();
        p.BaudRate = int.TryParse(baud.Text, out var b) ? b : 115200;
        p.IpAddress = ip.Text.Trim();
        p.TcpPort = (int)port.Value;
        p.CommPassword = (int)key.Value;
        if (p.Kind == ConnectionKind.Adms) p.SerialNumber = sn.Text.Trim();
        if (id == null) db.DeviceProfiles.Add(p);
        db.SaveChanges();
        if (id != null)
        {
            if (oldKind != p.Kind) AppState.Remove(p.Id);
            else if (AppState.IsConnected(p.Id)) _ = DeviceActions.Disconnect(p.Id);
        }
        if (p.Kind == ConnectionKind.Adms && !AdmsServer.Running)
        {
            try { AdmsHost.Start(AdmsHost.ConfiguredPort); }
            catch (Exception ex) { Ui.Error(new DeviceException($"ADMS server port {AdmsHost.ConfiguredPort} start nahi hua: {ex.Message}")); }
        }
        LoadMachines();
    }

    private void DeleteDevice()
    {
        var ids = SelectedDeviceIds();
        if (ids.Count == 0 || !Ui.Confirm($"{ids.Count} device(s) Machine List se delete karein?\n(Attendance data database me rahega.)")) return;
        using var db = new AppDbContext();
        foreach (var id in ids) AppState.Remove(id);
        db.DeviceProfiles.Where(p => ids.Contains(p.Id)).ExecuteDelete();
        LoadMachines();
    }

    // ---------------------------------------------------------------- data maintenance

    private void ImportAttendance()
    {
        using var dlg = new OpenFileDialog
        {
            Title = "Import Attendance Checking Data (pendrive: 1_attlog.dat / GLG_001.TXT)",
            Filter = "Attendance files (*.dat;*.txt;*.csv)|*.dat;*.txt;*.csv|All files (*.*)|*.*"
        };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        var punches = UsbFileImporter.Parse(dlg.FileName);
        if (punches.Count == 0) { Ui.Info("File me koi attendance record nahi mila. Format check karein."); return; }
        var r = SyncService.SavePunches(punches, PunchSource.UsbFile);
        ShowRecords(punches, "USB");
        AppState.RaiseDataChanged();
        Ui.Info($"Import complete.\nRecords: {punches.Count}\nNew: {r.Added}\nDuplicates: {r.Duplicates}\nNew AC No.: {r.NewEmployees}");
    }

    private void NotSupported() =>
        Ui.Info("ZKTeco LX50 me camera / access control nahi hai, isliye yeh option is device ke liye available nahi hai.");

    private static void OpenReadme()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "README.md");
        if (File.Exists(path)) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("notepad.exe", $"\"{path}\""));
        else Ui.Info("README.md nahi mili.");
    }

    private static void Safe(Action a)
    {
        try { a(); }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private void BeginInvokeSafe(Action a)
    {
        if (IsHandleCreated && !IsDisposed) BeginInvoke(a);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing && !Ui.Confirm("Program band karein?")) { e.Cancel = true; return; }
        foreach (var f in _tabs.TabPages.Cast<TabPage>().Select(ScreenTabs.Hosted).OfType<Form>().ToList()) f.Close();
        base.OnFormClosing(e);
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _timer.Stop();
        AppState.DisposeAll();
        base.OnFormClosed(e);
    }
}
