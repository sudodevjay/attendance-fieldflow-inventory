using System.Globalization;
using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using ZkAttendance.Data;
using ZkAttendance.Device;
using ZkAttendance.Services;

namespace ZkAttendance.UI;

/// <summary>"Employee List" window: department tree, employee grid and a detail panel with tabs, like the original.</summary>
public class EmployeeWindow : Form
{
    private readonly TreeView _tree = new() { Dock = DockStyle.Fill, BorderStyle = BorderStyle.None, HideSelection = false, Font = Theme.Base };
    private readonly CheckBox _includeSub = new() { Text = "include sub department", AutoSize = true, Checked = true, Location = new Point(4, 5) };
    private readonly DataGridView _grid = Ui.Grid();
    private readonly ToolStripTextBox _search = new() { AutoSize = false, Width = 130, Margin = new Padding(4, 14, 2, 0) };
    private readonly ToolStripStatusLabel _count = new() { Text = "Record Count 0" };

    // Basic Information
    private readonly TextBox _acNo = new(), _name = new(), _badge = new(), _nationality = new(), _officeTel = new(), _title = new(),
        _card = new(), _mobile = new(), _home = new(), _email = new(), _password = new();
    private readonly ComboBox _gender = Combo("", "Male", "Female");
    private readonly ComboBox _privilege = Combo("User", "Administrator");
    private readonly DateTimePicker _dob = DatePicker(), _joined = DatePicker();
    private readonly PictureBox _photo = new() { BorderStyle = BorderStyle.FixedSingle, SizeMode = PictureBoxSizeMode.Zoom, BackColor = Color.White };
    private readonly ComboBox _finger = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 150 };
    private readonly Button _enroll = Ui.Button("Enroll");
    private readonly Label _deviceState = new() { AutoSize = true, ForeColor = Theme.Muted };
    // Addition
    private readonly ComboBox _dept = new() { DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly ComboBox _shift = new() { DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly CheckBox _active = new() { Text = "Active (include in attendance calculation)", AutoSize = true };
    private readonly CheckBox _enabledOnDevice = new() { Text = "Enabled on device", AutoSize = true, Checked = true };
    private readonly NumericUpDown _salary = new() { Maximum = 100_000_000, DecimalPlaces = 2, ThousandsSeparator = true, Increment = 500 };
    private readonly NumericUpDown _otRate = new() { Maximum = 1_000_000, DecimalPlaces = 2, ThousandsSeparator = true, Increment = 10 };

    private Employee? _current;
    private string? _photoBase64;
    private int? _initialDept;
    private bool _loading;

    public static void Open(IWin32Window owner, int? departmentId = null)
    {
        if (MainForm.Instance is { } main)
        {
            var w = (EmployeeWindow)main.OpenScreen("employees", "Employee List", Icons.Get(Icons.People, Color.Chocolate),
                () => new EmployeeWindow { _initialDept = departmentId });
            if (departmentId != null) w.SelectDepartment(departmentId.Value);
            return;
        }
        using var dlg = new EmployeeWindow { _initialDept = departmentId };
        dlg.ShowDialog(owner);
    }

    /// <summary>Shows the employees of a department (used by Department Management → Employee).</summary>
    public void SelectDepartment(int id)
    {
        foreach (var node in All(_tree.Nodes))
            if (node.Tag is int t && t == id) { _tree.SelectedNode = node; return; }
    }

    private static IEnumerable<TreeNode> All(TreeNodeCollection nodes)
    {
        foreach (TreeNode n in nodes)
        {
            yield return n;
            foreach (var c in All(n.Nodes)) yield return c;
        }
    }

    public EmployeeWindow()
    {
        Text = "Employee List";
        Font = Theme.Base;
        Size = new Size(1000, 660);
        MinimumSize = new Size(900, 560);
        StartPosition = FormStartPosition.CenterParent;
        ShowInTaskbar = false;
        BackColor = Theme.Background;
        KeyPreview = true;

        var images = new ImageList { ImageSize = new Size(16, 16), ColorDepth = ColorDepth.Depth32Bit };
        images.Images.Add(Icons.Get(Icons.Home, Color.SeaGreen));
        images.Images.Add(Icons.Get(Icons.Folder, Color.DarkGoldenrod));
        _tree.ImageList = images;

        // ---- toolbar
        var bar = Bars.Medium();
        Bars.Button(bar, "Browse", Icons.Get(Icons.Refresh, Color.DimGray, 20), (_, _) => LoadGrid());
        bar.Items.Add(new ToolStripSeparator());
        Bars.Button(bar, "Add", Icons.Get(Icons.Add, Theme.Accent, 20), (_, _) => NewEmployee());
        Bars.Button(bar, "Save", Icons.Get(Icons.Save, Color.FromArgb(40, 90, 160), 20), (_, _) =>
        {
            if (Save()) Ui.Info($"Saved: AC No {_current?.EnrollNo} {_current?.Name}\n\nClick 'Upload' to send this name to the device as well.");
        });
        Bars.Button(bar, "Delete", Icons.Get(Icons.Close, Color.Red, 20), (_, _) => Delete());
        Bars.Button(bar, "Cancel", Icons.Get(Icons.Undo, Color.FromArgb(30, 100, 210), 20), (_, _) => ShowDetail(_current?.Id));
        bar.Items.Add(new ToolStripSeparator());
        _search.TextBox.PlaceholderText = "AC No / Name";
        bar.Items.Add(_search);
        Bars.Button(bar, "Search", Icons.Get(Icons.Search, Color.DimGray, 20), (_, _) => LoadGrid());
        bar.Items.Add(new ToolStripSeparator());
        Bars.Button(bar, "Upload", Icons.Get(Icons.Upload, Color.DarkOrange, 20), async (_, _) => await UploadSelected());
        Bars.Button(bar, "Download", Icons.Get(Icons.Download, Color.Green, 20), async (_, _) => await DownloadFromDevice());
        Bars.Button(bar, "Del(Device)", Icons.Get(Icons.Delete, Color.Brown, 20), async (_, _) => await DeleteFromDevice());
        bar.Items.Add(new ToolStripSeparator());
        Bars.Button(bar, "Import", Icons.Get(Icons.Import, Color.MediumVioletRed, 20), (_, _) => ImportExcel());
        Bars.Button(bar, "Export", Icons.Get(Icons.Export, Color.SeaGreen, 20), (_, _) => ExportExcel());
        _search.KeyDown += (_, e) => { if (e.KeyCode == Keys.Enter) { LoadGrid(); e.SuppressKeyPress = true; } };

        // ---- top: tree + grid
        var left = new Panel { Dock = DockStyle.Left, Width = 180, BorderStyle = BorderStyle.Fixed3D, BackColor = Color.White };
        var leftTop = new Panel { Dock = DockStyle.Top, Height = 26, BackColor = Theme.Background };
        leftTop.Controls.Add(_includeSub);
        left.Controls.Add(_tree);
        left.Controls.Add(leftTop);

        _grid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
        _grid.RowHeadersVisible = true;
        var gridPanel = new Panel { Dock = DockStyle.Fill, BorderStyle = BorderStyle.Fixed3D };
        gridPanel.Controls.Add(_grid);

        var top = new Panel { Dock = DockStyle.Fill };
        top.Controls.Add(gridPanel);
        top.Controls.Add(new Splitter { Dock = DockStyle.Left, Width = 4 });
        top.Controls.Add(left);

        // ---- bottom: detail tabs
        var tabs = new TabControl { Dock = DockStyle.Bottom, Height = 250, Alignment = TabAlignment.Bottom, Font = Theme.Base };
        tabs.TabPages.Add(BuildBasic());
        tabs.TabPages.Add(BuildAddition());
        tabs.TabPages.Add(BuildAcOptions());

        var status = new StatusStrip { Renderer = BlueColorTable.Renderer, SizingGrip = false };
        status.Items.Add(_count);

        Controls.Add(top);
        Controls.Add(new Splitter { Dock = DockStyle.Bottom, Height = 4 });
        Controls.Add(tabs);
        Controls.Add(bar);
        Controls.Add(status);

        _tree.AfterSelect += (_, _) => { if (!_loading) LoadGrid(); };
        _includeSub.CheckedChanged += (_, _) => LoadGrid();
        _grid.SelectionChanged += (_, _) => { if (!_loading && Ui.SelectedId(_grid) is int id && id != _current?.Id) ShowDetail(id); };
        _enroll.Click += async (_, _) => await Ui.Busy(_enroll, Enroll);
        AppState.DeviceStatusChanged += DeviceChanged;
        FormClosed += (_, _) => AppState.DeviceStatusChanged -= DeviceChanged;
        KeyDown += (_, e) => { if (e.Control && e.KeyCode == Keys.S) { Save(); e.SuppressKeyPress = true; } };

        Load += (_, _) =>
        {
            LoadMasters();
            LoadTree();
            LoadGrid();
            UpdateDeviceState();
        };
    }

    private void DeviceChanged()
    {
        if (IsHandleCreated && !IsDisposed) BeginInvoke(UpdateDeviceState);
    }

    // ---------------------------------------------------------------- layout helpers

    private static ComboBox Combo(params string[] items)
    {
        var c = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList };
        c.Items.AddRange(items);
        c.SelectedIndex = 0;
        return c;
    }

    private static DateTimePicker DatePicker() => new()
    {
        Format = DateTimePickerFormat.Custom, CustomFormat = "dd-MM-yyyy", ShowCheckBox = true, Checked = false
    };

    private static void Field(Control parent, string label, Control c, int x, int y, int labelWidth = 80, int width = 130)
    {
        parent.Controls.Add(new Label { Text = label, Location = new Point(x, y + 3), Size = new Size(labelWidth - 4, 16), TextAlign = ContentAlignment.TopRight });
        c.Location = new Point(x + labelWidth, y);
        c.Width = width;
        parent.Controls.Add(c);
    }

    private TabPage BuildBasic()
    {
        var p = new TabPage("Basic Information") { BackColor = Theme.Background, AutoScroll = true };
        int y = 10, h = 27;
        Field(p, "AC No", _acNo, 0, y);                 Field(p, "Name", _name, 215, y, 70);
        Field(p, "Gender", _gender, 0, y += h);         Field(p, "No.", _badge, 215, y, 70);
        Field(p, "Nationality", _nationality, 0, y += h); Field(p, "Office Tel", _officeTel, 215, y, 70);
        Field(p, "Title", _title, 0, y += h);           Field(p, "Privilege", _privilege, 215, y, 70);
        Field(p, "Date of Birth", _dob, 0, y += h);     Field(p, "Date of Employment", _joined, 215, y, 70);
        p.Controls[^2].Size = new Size(66, 28);
        Field(p, "CardNumber", _card, 0, y += h);       Field(p, "Mobile No", _mobile, 215, y, 70);
        Field(p, "Home Add", _home, 0, y += h, 80, 335);

        var photoBox = new GroupBox { Text = "Photo", Location = new Point(435, 4), Size = new Size(140, 200) };
        _photo.Location = new Point(12, 18);
        _photo.Size = new Size(116, 140);
        var load = Ui.Button("", (_, _) => LoadPhoto());
        load.Image = Icons.Get(Icons.Folder, Color.DarkGoldenrod);
        var clear = Ui.Button("", (_, _) => { _photoBase64 = null; _photo.Image = null; });
        clear.Image = Icons.Get(Icons.Delete, Color.Red);
        foreach (var (b, x) in new[] { (load, 12), (clear, 72) })
        {
            b.MinimumSize = Size.Empty;
            b.AutoSize = false;
            b.Size = new Size(56, 26);
            b.Location = new Point(x, 164);
            photoBox.Controls.Add(b);
        }
        photoBox.Controls.Add(_photo);
        p.Controls.Add(photoBox);

        var fp = new GroupBox { Text = "Fingerprint manage", Location = new Point(585, 4), Size = new Size(280, 200) };
        _finger.Location = new Point(12, 22);
        var connect = Ui.Button("Connect Device", async (s, _) => await Ui.Busy((Control)s!, async () => await DeviceActions.Connect(DeviceActions.Current())));
        connect.Location = new Point(170, 20);
        var radioDevice = new RadioButton { Text = "Fingerprint device", Checked = true, AutoSize = true, Location = new Point(14, 62) };
        var radioSensor = new RadioButton { Text = "sensor", AutoSize = true, Enabled = false, Location = new Point(150, 62) };
        _enroll.Location = new Point(12, 92);
        var delFp = Ui.Button("Delete FP", (_, _) => DeleteFinger());
        delFp.Location = new Point(96, 92);
        _deviceState.Location = new Point(12, 128);
        _deviceState.MaximumSize = new Size(258, 0);
        fp.Controls.AddRange([_finger, connect, radioDevice, radioSensor, _enroll, delFp, _deviceState]);
        p.Controls.Add(fp);
        return p;
    }

    private TabPage BuildAddition()
    {
        var p = new TabPage("Addition") { BackColor = Theme.Background };
        int y = 12, h = 28;
        Field(p, "Department", _dept, 0, y, 100, 200);
        Field(p, "Shift / Timetable", _shift, 0, y += h, 100, 200);
        Field(p, "Email", _email, 0, y += h, 100, 200);
        Field(p, "Monthly Salary (₹)", _salary, 330, 12, 130, 130);
        Field(p, "OT Rate / Hour (₹)", _otRate, 330, 40, 130, 130);
        p.Controls.Add(new Label
        {
            Text = "OT rate 0 = calculated from salary\n(one hour's pay × OT multiplier, see Salary Rule)",
            Location = new Point(460, 68), AutoSize = true, ForeColor = Theme.Muted
        });
        _active.Location = new Point(100, y += h + 2);
        p.Controls.Add(_active);
        p.Controls.Add(new Label
        {
            Text = "Late / early / overtime are calculated from the shift. Create shifts in 'Maintenance Timetables'.",
            Location = new Point(100, y + 28), AutoSize = true, ForeColor = Theme.Muted
        });
        return p;
    }

    private TabPage BuildAcOptions()
    {
        var p = new TabPage("AC Options") { BackColor = Theme.Background };
        Field(p, "Device Password", _password, 0, 12, 110, 140);
        _enabledOnDevice.Location = new Point(110, 44);
        p.Controls.Add(_enabledOnDevice);
        p.Controls.Add(new Label
        {
            Text = "A user with the 'Administrator' privilege can open the device menu.\nPassword / Card number are uploaded to the device for verification ('Upload' button).",
            Location = new Point(110, 74), AutoSize = true, ForeColor = Theme.Muted
        });
        return p;
    }

    // ---------------------------------------------------------------- data

    private void LoadMasters()
    {
        using var db = new AppDbContext();
        _dept.Items.Clear();
        _dept.Items.Add("(none)");
        _dept.Items.AddRange(db.Departments.AsNoTracking().OrderBy(d => d.Name).ToArray<object>());
        _shift.Items.Clear();
        _shift.Items.Add("(none)");
        _shift.Items.AddRange(db.Shifts.AsNoTracking().OrderBy(s => s.Name).ToArray<object>());
    }

    private void LoadTree()
    {
        _loading = true;
        using var db = new AppDbContext();
        var depts = db.Departments.AsNoTracking().OrderBy(d => d.Name).ToList();
        _tree.BeginUpdate();
        _tree.Nodes.Clear();
        var root = new TreeNode(ReportService.CompanyName.ToUpperInvariant(), 0, 0);
        _tree.Nodes.Add(root);
        var nodes = depts.ToDictionary(d => d.Id, d => new TreeNode(d.Name, 1, 1) { Tag = d.Id });
        foreach (var d in depts)
            (d.ParentId is int p && nodes.TryGetValue(p, out var pn) ? pn : root).Nodes.Add(nodes[d.Id]);
        _tree.ExpandAll();
        _tree.SelectedNode = _initialDept is int s && nodes.TryGetValue(s, out var sel) ? sel : root;
        _tree.EndUpdate();
        _loading = false;
    }

    private void LoadGrid(int? select = null)
    {
        try
        {
            _loading = true;
            select ??= _current?.Id;
            using var db = new AppDbContext();
            var q = db.Employees.AsNoTracking().Include(e => e.Department).AsQueryable();
            if (_tree.SelectedNode?.Tag is int deptId)
            {
                var ids = _includeSub.Checked ? DepartmentWindow.WithChildren(deptId) : [deptId];
                q = q.Where(e => e.DepartmentId != null && ids.Contains(e.DepartmentId.Value));
            }
            var s = _search.Text.Trim();
            if (s.Length > 0) q = q.Where(e => e.EnrollNo.Contains(s) || e.Name.Contains(s) || (e.BadgeNo != null && e.BadgeNo.Contains(s)));
            var rows = q.AsEnumerable().OrderBy(e => AttendanceProcessor.SortKey(e.EnrollNo)).ToList();

            _grid.DataSource = Ui.ToTable(rows,
                ("Id", e => e.Id), ("AC No", e => e.EnrollNo), ("No.", e => e.BadgeNo), ("Name", e => e.Name), ("Gender", e => e.Gender),
                ("Title", e => e.Designation), ("Mobile/Pager", e => e.Phone), ("Department", e => e.Department?.Name),
                ("Active", e => e.IsActive ? "" : "Inactive"));
            _grid.Columns["Id"]!.Visible = false;
            _count.Text = $"Record Count {rows.Count}";

            _grid.ClearSelection();
            foreach (DataGridViewRow r in _grid.Rows)
                if (r.Cells["Id"].Value is int id && id == select)
                {
                    r.Selected = true;
                    _grid.CurrentCell = r.Cells["AC No"];
                }
            _loading = false;
            var first = Ui.SelectedId(_grid) ?? (rows.Count > 0 ? rows[0].Id : null);
            if (first != null && Ui.SelectedId(_grid) == null) { _grid.Rows[0].Selected = true; _grid.CurrentCell = _grid.Rows[0].Cells["AC No"]; }
            if (first != null) ShowDetail(first); else NewEmployee();
        }
        catch (Exception ex) { _loading = false; Ui.Error(ex); }
    }

    private void ShowDetail(int? id)
    {
        if (id == null) { NewEmployee(); return; }
        using var db = new AppDbContext();
        var e = db.Employees.AsNoTracking().Include(x => x.Fingers).FirstOrDefault(x => x.Id == id);
        if (e == null) { NewEmployee(); return; }
        _current = e;
        _acNo.Text = e.EnrollNo; _name.Text = e.Name; _badge.Text = e.BadgeNo; _nationality.Text = e.Nationality;
        _officeTel.Text = e.OfficeTel; _title.Text = e.Designation; _card.Text = e.CardNo; _mobile.Text = e.Phone;
        _home.Text = e.HomeAddress; _email.Text = e.Email; _password.Text = e.DevicePassword;
        _gender.SelectedItem = e.Gender ?? ""; if (_gender.SelectedIndex < 0) _gender.SelectedIndex = 0;
        _privilege.SelectedIndex = e.Privilege == 3 ? 1 : 0;
        SetDate(_dob, e.BirthDate); SetDate(_joined, e.JoinDate);
        _active.Checked = e.IsActive;
        _enabledOnDevice.Checked = e.IsActive;
        SelectById(_dept, e.DepartmentId);
        SelectById(_shift, e.ShiftId);
        _salary.Value = Math.Clamp(e.MonthlySalary, _salary.Minimum, _salary.Maximum);
        _otRate.Value = Math.Clamp(e.OtRatePerHour, _otRate.Minimum, _otRate.Maximum);
        _photoBase64 = e.PhotoBase64;
        _photo.Image = PhotoStore.Decode(e.PhotoBase64);
        FillFingers(e.Fingers.Select(f => f.FingerIndex).ToHashSet());
    }

    private void NewEmployee()
    {
        using var db = new AppDbContext();
        var max = db.Employees.Select(e => e.EnrollNo).AsEnumerable().Select(x => int.TryParse(x, out var n) ? n : 0).DefaultIfEmpty(0).Max();
        _current = null;
        foreach (var t in new[] { _name, _badge, _nationality, _officeTel, _title, _card, _mobile, _home, _email, _password }) t.Text = "";
        _acNo.Text = (max + 1).ToString();
        _gender.SelectedIndex = 0;
        _privilege.SelectedIndex = 0;
        SetDate(_dob, null); SetDate(_joined, DateTime.Today);
        _active.Checked = true;
        _enabledOnDevice.Checked = true;
        SelectById(_dept, _tree.SelectedNode?.Tag as int?);
        if (_shift.Items.Count > 1) _shift.SelectedIndex = 1; else _shift.SelectedIndex = 0;
        _salary.Value = 0;
        _otRate.Value = 0;
        _photoBase64 = null;
        _photo.Image = null;
        FillFingers([]);
        _grid.ClearSelection();
        _name.Focus();
    }

    /// <summary>Saves the detail form; returns false when validation failed or the save threw.</summary>
    private bool Save()
    {
        try
        {
            var enroll = _acNo.Text.Trim();
            if (enroll.Length == 0 || _name.Text.Trim().Length == 0) { Ui.Info("AC No and Name are required."); return false; }
            if (enroll.Length > 9 || !enroll.All(char.IsDigit)) { Ui.Info("AC No must be numeric (max. 9 digits) — the LX50 uses numeric user IDs."); return false; }

            using var db = new AppDbContext();
            if (db.Employees.Any(x => x.EnrollNo == enroll && x.Id != (_current == null ? 0 : _current.Id)))
            { Ui.Info($"AC No {enroll} is already assigned to another employee."); return false; }

            var e = _current == null ? new Employee() : db.Employees.First(x => x.Id == _current.Id);
            var oldEnroll = e.EnrollNo;
            e.EnrollNo = enroll;
            e.Name = _name.Text.Trim();
            e.BadgeNo = N(_badge.Text); e.Nationality = N(_nationality.Text); e.OfficeTel = N(_officeTel.Text);
            e.Designation = N(_title.Text); e.CardNo = N(_card.Text); e.Phone = N(_mobile.Text); e.HomeAddress = N(_home.Text);
            e.Email = N(_email.Text); e.DevicePassword = N(_password.Text);
            e.Gender = N(_gender.Text);
            e.Privilege = _privilege.SelectedIndex == 1 ? 3 : 0;
            e.BirthDate = _dob.Checked ? _dob.Value.Date : null;
            e.JoinDate = _joined.Checked ? _joined.Value.Date : null;
            e.IsActive = _active.Checked && _enabledOnDevice.Checked;
            e.DepartmentId = (_dept.SelectedItem as Department)?.Id;
            e.ShiftId = (_shift.SelectedItem as Shift)?.Id;
            e.MonthlySalary = _salary.Value;
            e.OtRatePerHour = _otRate.Value;
            e.PhotoBase64 = _photoBase64;
            if (_current == null) db.Employees.Add(e);
            else if (oldEnroll != enroll)
                db.AttendanceLogs.Where(a => a.EnrollNo == oldEnroll).ExecuteUpdate(s => s.SetProperty(a => a.EnrollNo, enroll));
            db.SaveChanges();
            _current = e;
            AppState.RaiseDataChanged();
            LoadGrid(e.Id);
            return true;
        }
        catch (Exception ex) { Ui.Error(ex); return false; }
    }

    private void Delete()
    {
        var ids = Ui.SelectedIds(_grid);
        if (ids.Count == 0) return;
        if (!Ui.Confirm($"Delete {ids.Count} employee(s)?\n\nTheir leave records will also be deleted; attendance punches stay in the database.\n(To only deactivate an employee, clear Addition → Active instead.)")) return;
        try
        {
            using var db = new AppDbContext();
            db.LeaveEntries.Where(l => ids.Contains(l.EmployeeId)).ExecuteDelete();
            db.FingerTemplates.Where(f => ids.Contains(f.EmployeeId)).ExecuteDelete();
            db.Employees.Where(e => ids.Contains(e.Id)).ExecuteDelete();
            _current = null;
            AppState.RaiseDataChanged();
            LoadGrid();
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    // ---------------------------------------------------------------- device

    private void UpdateDeviceState()
    {
        try
        {
            var p = DeviceActions.Current();
            bool on = AppState.IsConnected(p.Id);
            _deviceState.Text = on ? $"Device '{p.Name}' connected." : $"Device '{p.Name}' is not connected. Click 'Connect Device'.";
            _deviceState.ForeColor = on ? Theme.Success : Theme.Muted;
            _enroll.Enabled = on;
        }
        catch
        {
            _deviceState.Text = "No device has been added (main window → Device).";
            _enroll.Enabled = false;
        }
    }

    private void FillFingers(HashSet<int> enrolled)
    {
        int sel = Math.Max(0, _finger.SelectedIndex);
        _finger.Items.Clear();
        for (int i = 0; i < DeviceDrivers.FingerNames.Length; i++)
            _finger.Items.Add(enrolled.Contains(i) ? $"{DeviceDrivers.FingerNames[i]}  ✔" : DeviceDrivers.FingerNames[i]);
        _finger.SelectedIndex = enrolled.Count == 0 ? 6 : sel;
    }

    private async Task Enroll()
    {
        if (_current == null) { Ui.Info("Save the employee first, then enroll the finger."); return; }
        var p = DeviceActions.Current();
        var dev = await DeviceActions.Ensure(p);
        dev.Require(DeviceFeatures.RemoteEnroll, "Remote enroll");
        // User must exist on the device before a finger can be enrolled for it.
        await dev.UploadUsersAsync(SyncService.ToDeviceUsers([_current.Id]).Select(u => { u.Fingers.Clear(); return u; }));
        await dev.StartEnrollAsync(_current.EnrollNo, _finger.SelectedIndex);
        AppState.Log(p.Id, $"Enroll AC No {_current.EnrollNo}, finger {_finger.SelectedIndex}");
        Ui.Info($"The device is in enroll mode (AC No {_current.EnrollNo}).\nPlace the '{DeviceDrivers.FingerNames[_finger.SelectedIndex]}' on the device 3 times, then click 'Download'.\n\n" +
                "If the LX50 does not support remote enroll, enroll the finger on the device (Menu → User Mgt → user → Fingerprint) and then click 'Download'.");
    }

    private void DeleteFinger()
    {
        if (_current == null) return;
        int f = _finger.SelectedIndex;
        using var db = new AppDbContext();
        int n = db.FingerTemplates.Where(x => x.EmployeeId == _current.Id && x.FingerIndex == f).ExecuteDelete();
        if (n == 0) { Ui.Info("No template is saved for this finger."); return; }
        Ui.Info("Fingerprint deleted from the software. The finger is still on the device: delete it from the device menu " +
                "(Menu → User Mgt → user → Fingerprint).\n\nDo not use 'Del(Device)' + 'Upload': the LX50 cannot receive fingerprint " +
                "templates, so all of the user's fingers would be removed from the device.");
        ShowDetail(_current.Id);
    }

    private async Task UploadSelected()
    {
        // Upload sends what is saved in the database, so save pending edits of the open employee first
        // (otherwise a name typed but not saved would silently go to the device as the old name).
        if (_current != null && !Save()) return;
        var ids = Ui.SelectedIds(_grid);
        if (ids.Count == 0 && _current != null) ids = [_current.Id];
        if (ids.Count == 0) { Ui.Info("Select an employee first."); return; }
        try
        {
            UseWaitCursor = true;
            int rejected = await DeviceActions.UploadUsers(DeviceActions.Current(), ids);
            Ui.Info($"Uploaded {ids.Count} employee(s) to the device (name, password, card, fingerprints)." + DeviceActions.RejectedFingersNote(rejected));
        }
        catch (Exception ex) { Ui.Error(ex); }
        finally { UseWaitCursor = false; }
    }

    private async Task DownloadFromDevice()
    {
        try
        {
            var p = DeviceActions.Current();
            bool overwrite = Ui.Confirm("Overwrite existing names in the software with the names from the device?\n\n(No = only new users and empty names are updated)");
            UseWaitCursor = true;
            var (added, updated, fingers) = await DeviceActions.DownloadUsers(p, overwrite);
            UseWaitCursor = false;
            LoadGrid();
            Ui.Info($"Download user info and Fp complete.\nNew: {added}\nUpdated: {updated}\nFingerprint templates: {fingers}");
        }
        catch (Exception ex) { UseWaitCursor = false; Ui.Error(ex); }
    }

    private async Task DeleteFromDevice()
    {
        var rows = _grid.SelectedRows.Cast<DataGridViewRow>().Select(r => r.Cells["AC No"].Value?.ToString()).OfType<string>().ToList();
        if (rows.Count == 0 || !Ui.Confirm($"Delete {rows.Count} user(s) from the DEVICE (including fingerprints)?\nThe data stays in the software.")) return;
        try
        {
            var p = DeviceActions.Current();
            var dev = await DeviceActions.Ensure(p);
            dev.Require(DeviceFeatures.DeleteUser, "Delete user from device");
            foreach (var r in rows) await dev.DeleteUserAsync(r);
            AppState.Log(p.Id, $"Deleted {rows.Count} user(s) from device");
            Ui.Info("Deleted from the device.");
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    // ---------------------------------------------------------------- photo / excel

    private void LoadPhoto()
    {
        using var d = new OpenFileDialog { Filter = "Images (*.jpg;*.jpeg;*.png;*.bmp)|*.jpg;*.jpeg;*.png;*.bmp" };
        if (d.ShowDialog(this) != DialogResult.OK) return;
        try
        {
            using var src = Image.FromFile(d.FileName);
            _photoBase64 = PhotoStore.Encode(src);
            _photo.Image = PhotoStore.Decode(_photoBase64);
            Ui.Info("Photo loaded. It will be saved to the database when you click 'Save' or 'Upload'.");
        }
        catch (Exception ex) { Ui.Error(new Exception("This file could not be opened as a photo: " + ex.Message)); }
    }

    /// <summary>Exports the employees shown in the grid with the same columns Import reads, so the file can be edited and imported back.</summary>
    private void ExportExcel()
    {
        if (_grid.DataSource is not System.Data.DataTable t) return;
        var ids = t.Rows.Cast<System.Data.DataRow>().Select(r => (int)r["Id"]).ToList();
        var path = Ui.SaveFile("Excel (*.xlsx)|*.xlsx", $"Employees_{DateTime.Today:yyyyMMdd}.xlsx");
        if (path == null) return;
        try
        {
            using var db = new AppDbContext();
            var emps = db.Employees.AsNoTracking().Include(e => e.Department).Include(e => e.Shift).Where(e => ids.Contains(e.Id))
                .AsEnumerable().OrderBy(e => AttendanceProcessor.SortKey(e.EnrollNo)).ToList();
            var table = new System.Data.DataTable();
            foreach (var c in ExportColumns) table.Columns.Add(c);
            foreach (var e in emps)
                table.Rows.Add(e.EnrollNo, e.Name, e.BadgeNo, e.Gender, e.Designation, e.Phone, e.CardNo, e.Department?.Name, e.Shift?.Name,
                    e.JoinDate?.ToString("dd-MM-yyyy"), e.MonthlySalary.ToString("0.00", CultureInfo.InvariantCulture),
                    e.OtRatePerHour.ToString("0.00", CultureInfo.InvariantCulture));
            ExcelExporter.Export(new ReportResult { Title = "Employee List", Subtitle = $"{table.Rows.Count} employees", Table = table }, path);
            Ui.Info("Exported: " + path + "\n\nYou can edit this file and load it back with 'Import'.");
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private static readonly string[] ExportColumns =
        ["AC No", "Name", "No.", "Gender", "Title", "Mobile", "Card", "Department", "Shift", "Join Date", "Monthly Salary", "OT Rate / Hour"];

    /// <summary>Imports employees from an Excel sheet whose first row has headers like "AC No", "Name", "Department" ...</summary>
    private void ImportExcel()
    {
        using var d = new OpenFileDialog { Filter = "Excel (*.xlsx)|*.xlsx", Title = "Import Employees (columns: AC No, Name, No., Gender, Title, Mobile, Card, Department, Shift, Join Date, Monthly Salary, OT Rate / Hour)" };
        if (d.ShowDialog(this) != DialogResult.OK) return;
        try
        {
            using var wb = new XLWorkbook(d.FileName);
            var ws = wb.Worksheets.First();
            var headerRow = ws.RowsUsed().FirstOrDefault(r => r.CellsUsed().Any(c => Norm(c.GetString()) is "acno" or "userid" or "enrollno"));
            if (headerRow == null) { Ui.Info("No 'AC No' column was found in the sheet."); return; }
            var cols = headerRow.CellsUsed().ToDictionary(c => Norm(c.GetString()), c => c.Address.ColumnNumber);
            int Col(params string[] names) => names.Select(n => cols.GetValueOrDefault(n)).FirstOrDefault(n => n > 0);
            int cAc = Col("acno", "userid", "enrollno"), cName = Col("name"), cNo = Col("no", "badgeno"), cGender = Col("gender"),
                cTitle = Col("title", "designation"), cMobile = Col("mobile", "mobileno", "mobilepager", "phone"), cCard = Col("card", "cardnumber", "cardno"),
                cDept = Col("department", "dept"), cJoin = Col("joindate", "dateofemployment"), cShift = Col("shift", "timetable"),
                cSalary = Col("monthlysalary", "salary"), cOt = Col("otratehour", "otrate", "otrateperhour");

            using var db = new AppDbContext();
            var depts = db.Departments.ToList();
            var shifts = db.Shifts.ToList();
            var emps = db.Employees.ToDictionary(e => e.EnrollNo);
            var shift = db.Shifts.OrderBy(s => s.Id).Select(s => (int?)s.Id).FirstOrDefault();
            int added = 0, updated = 0;
            foreach (var row in ws.RowsUsed().Where(r => r.RowNumber() > headerRow.RowNumber()))
            {
                var ac = row.Cell(cAc).GetString().Trim().TrimStart('0');
                if (ac.Length == 0 || !ac.All(char.IsDigit)) continue;
                if (!emps.TryGetValue(ac, out var e))
                {
                    e = new Employee { EnrollNo = ac, ShiftId = shift };
                    db.Employees.Add(e);
                    emps[ac] = e;
                    added++;
                }
                else updated++;
                string Get(int c) => c > 0 ? row.Cell(c).GetString().Trim() : "";
                if (Get(cName) is { Length: > 0 } nm) e.Name = nm;
                if (string.IsNullOrWhiteSpace(e.Name)) e.Name = $"User {ac}";
                if (Get(cNo) is { Length: > 0 } no) e.BadgeNo = no;
                if (Get(cGender) is { Length: > 0 } g) e.Gender = g;
                if (Get(cTitle) is { Length: > 0 } ti) e.Designation = ti;
                if (Get(cMobile) is { Length: > 0 } mo) e.Phone = mo;
                if (Get(cCard) is { Length: > 0 } ca) e.CardNo = ca;
                // Text dates are day-first (as exported); only real Excel date cells go through ClosedXML,
                // whose text parsing would follow the PC's regional format (01-02 = 2 Jan on a US setting).
                if (DateTime.TryParseExact(Get(cJoin), ["dd-MM-yyyy", "dd/MM/yyyy", "d-M-yyyy", "d/M/yyyy", "yyyy-MM-dd"],
                        CultureInfo.InvariantCulture, DateTimeStyles.None, out var jd)) e.JoinDate = jd;
                else if (cJoin > 0 && row.Cell(cJoin).DataType == XLDataType.DateTime) e.JoinDate = row.Cell(cJoin).GetDateTime().Date;
                if (Money(Get(cSalary)) is decimal sal) e.MonthlySalary = sal;
                if (Money(Get(cOt)) is decimal ot) e.OtRatePerHour = ot;
                if (Get(cShift) is { Length: > 0 } sn && shifts.FirstOrDefault(x => x.Name.Equals(sn, StringComparison.OrdinalIgnoreCase)) is { } sh)
                    e.ShiftId = sh.Id;
                if (Get(cDept) is { Length: > 0 } dn)
                {
                    var dep = depts.FirstOrDefault(x => x.Name.Equals(dn, StringComparison.OrdinalIgnoreCase));
                    if (dep == null) { dep = new Department { Name = dn }; db.Departments.Add(dep); depts.Add(dep); }
                    e.Department = dep;
                }
            }
            db.SaveChanges();
            LoadMasters();
            LoadTree();
            LoadGrid();
            Ui.Info($"Import complete.\nNew: {added}\nUpdated: {updated}");
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    /// <summary>Reads "25000", "25,000.00" or "₹ 25,000" as an amount; null when the cell is empty or not a number.</summary>
    private static decimal? Money(string s)
    {
        var clean = new string(s.Where(ch => char.IsDigit(ch) || ch == '.').ToArray());
        return decimal.TryParse(clean, NumberStyles.Number, CultureInfo.InvariantCulture, out var v) ? v : null;
    }

    private static string Norm(string s) => new(s.ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());

    private static void SetDate(DateTimePicker d, DateTime? v)
    {
        d.Value = v ?? DateTime.Today;
        d.Checked = v != null;
    }

    private static void SelectById(ComboBox c, int? id)
    {
        c.SelectedIndex = 0;
        if (id == null) return;
        for (int i = 0; i < c.Items.Count; i++)
            if ((c.Items[i] as Department)?.Id == id || (c.Items[i] as Shift)?.Id == id) { c.SelectedIndex = i; return; }
    }

    private static string? N(string s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
