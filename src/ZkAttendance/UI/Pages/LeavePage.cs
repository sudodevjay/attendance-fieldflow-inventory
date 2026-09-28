using Microsoft.EntityFrameworkCore;
using ZkAttendance.Data;
using ZkAttendance.Services;

namespace ZkAttendance.UI.Pages;

public class LeavePage : PageBase
{
    public override string Title => "Leave & Holidays";

    private readonly DataGridView _leaves = Ui.Grid();
    private readonly DataGridView _holidays = Ui.Grid();
    private readonly DataGridView _types = Ui.Grid();
    private readonly DataGridView _balance = Ui.Grid();
    private readonly NumericUpDown _year = new() { Minimum = 2000, Maximum = 2100, Width = 80, Margin = new Padding(0, 4, 8, 0) };

    public LeavePage()
    {
        _year.Value = DateTime.Today.Year;
        _year.ValueChanged += (_, _) => LoadData();
        Toolbar.Controls.Add(Ui.Label("Year"));
        Toolbar.Controls.Add(_year);

        var tabs = new TabControl { Dock = DockStyle.Fill, Font = Theme.Bold, Padding = new Point(16, 6) };
        tabs.TabPages.Add(Tab("Leave Entries", _leaves,
            Ui.Button("＋ Add Leave", (_, _) => AddLeave(), ButtonStyle.Primary),
            Ui.Button("🗑 Delete", (_, _) => DeleteRows(_leaves, (db, ids) => db.LeaveEntries.Where(l => ids.Contains(l.Id)).ExecuteDelete()), ButtonStyle.Danger)));
        tabs.TabPages.Add(Tab("Leave Balance", _balance,
            Ui.Button("⤓ Excel", (_, _) => ExportBalance(), ButtonStyle.Success)));
        tabs.TabPages.Add(Tab("Holidays", _holidays,
            Ui.Button("＋ Add Holiday", (_, _) => EditHoliday(null), ButtonStyle.Primary),
            Ui.Button("✎ Edit", (_, _) => EditHoliday(Ui.SelectedId(_holidays))),
            Ui.Button("🗑 Delete", (_, _) => DeleteRows(_holidays, (db, ids) => db.Holidays.Where(h => ids.Contains(h.Id)).ExecuteDelete()), ButtonStyle.Danger)));
        tabs.TabPages.Add(Tab("Leave Types", _types,
            Ui.Button("＋ Add Type", (_, _) => EditType(null), ButtonStyle.Primary),
            Ui.Button("✎ Edit", (_, _) => EditType(Ui.SelectedId(_types)))));
        Body.Controls.Add(tabs);
    }

    private static TabPage Tab(string title, DataGridView grid, params Button[] buttons)
    {
        var page = new TabPage(title) { BackColor = Theme.Background, Padding = new Padding(0, 10, 0, 0) };
        var bar = Ui.Toolbar();
        bar.Controls.AddRange(buttons);
        page.Controls.Add(Ui.Card(grid));
        page.Controls.Add(bar);
        return page;
    }

    public override void OnActivated() => LoadData();

    private void LoadData()
    {
        try
        {
            int y = (int)_year.Value;
            var from = new DateTime(y, 1, 1);
            var to = new DateTime(y, 12, 31);
            using var db = new AppDbContext();

            var leaves = db.LeaveEntries.AsNoTracking().Include(l => l.Employee).Include(l => l.LeaveType)
                .Where(l => l.FromDate <= to && l.ToDate >= from).OrderByDescending(l => l.FromDate).ToList();
            _leaves.DataSource = Ui.ToTable(leaves,
                ("Id", l => l.Id), ("Emp ID", l => l.Employee?.EnrollNo), ("Name", l => l.Employee?.Name), ("Type", l => l.LeaveType?.Code),
                ("From", l => l.FromDate.ToString("dd-MM-yyyy")), ("To", l => l.ToDate.ToString("dd-MM-yyyy")),
                ("Days", l => l.IsHalfDay ? 0.5 : (l.ToDate - l.FromDate).Days + 1), ("Half Day", l => l.IsHalfDay ? "Yes" : ""), ("Reason", l => l.Reason));

            _holidays.DataSource = Ui.ToTable(db.Holidays.AsNoTracking().Where(h => h.Date >= from && h.Date <= to).OrderBy(h => h.Date).ToList(),
                ("Id", h => h.Id), ("Date", h => h.Date.ToString("dd-MM-yyyy")), ("Day", h => h.Date.DayOfWeek.ToString()), ("Holiday", h => h.Name));

            _types.DataSource = Ui.ToTable(db.LeaveTypes.AsNoTracking().OrderBy(t => t.Code).ToList(),
                ("Id", t => t.Id), ("Code", t => t.Code), ("Name", t => t.Name), ("Paid", t => t.IsPaid ? "Yes" : "No"),
                ("Quota / Year", t => t.YearlyQuota > 0 ? t.YearlyQuota.ToString("0.#") : "No limit"));

            foreach (var g in new[] { _leaves, _holidays, _types }) g.Columns["Id"]!.Visible = false;
            _balance.DataSource = PayrollService.LeaveBalance("Leave Balance", y, null, null).Table;
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private void AddLeave()
    {
        try
        {
            using var db = new AppDbContext();
            var emps = db.Employees.Where(e => e.IsActive).AsEnumerable().OrderBy(e => AttendanceProcessor.SortKey(e.EnrollNo)).ToList();
            var types = db.LeaveTypes.OrderBy(t => t.Code).ToList();
            var dlg = new FormDialog("Add Leave");
            var emp = dlg.AddCombo("Employee", emps);
            var type = dlg.AddCombo("Leave type", types);
            var from = dlg.AddDate("From", DateTime.Today);
            var to = dlg.AddDate("To", DateTime.Today);
            var half = dlg.AddCheck("Half day", false, "Half day (single date)");
            var reason = dlg.AddText("Reason", null, multiline: true);
            dlg.Validator = () =>
            {
                if (emp.SelectedItem == null || type.SelectedItem == null) return "Employee aur leave type chunein.";
                if (to.Value.Date < from.Value.Date) return "'To' date 'From' se pehle nahi ho sakti.";
                if (half.Checked && to.Value.Date != from.Value.Date) return "Half day leave sirf ek date ke liye ho sakti hai.";
                return null;
            };
            if (dlg.ShowDialog(this) != DialogResult.OK) return;

            var entry = new LeaveEntry
            {
                EmployeeId = ((Employee)emp.SelectedItem!).Id, LeaveTypeId = ((LeaveType)type.SelectedItem!).Id,
                FromDate = from.Value.Date, ToDate = to.Value.Date, IsHalfDay = half.Checked, Reason = reason.Text.Trim()
            };
            if (!ConfirmQuota(entry, (LeaveType)type.SelectedItem!)) return;
            db.LeaveEntries.Add(entry);
            db.SaveChanges();
            LoadData();
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    /// <summary>Warns when the new leave goes beyond the yearly quota (the extra days become unpaid).</summary>
    private bool ConfirmQuota(LeaveEntry entry, LeaveType type)
    {
        if (!type.IsPaid || type.YearlyQuota <= 0) return true;
        double days = PayrollService.DaysFor(entry);
        if (entry.FromDate.Year != entry.ToDate.Year) return true;
        var (quota, taken) = PayrollService.Balance(entry.EmployeeId, type.Id, entry.FromDate.Year);
        double left = Math.Max(0, quota - taken);
        if (days <= left) return true;
        return Ui.Confirm($"{type.Code} balance: {left:0.#} din (quota {quota:0.#}, pehle li {taken:0.#}).\n" +
                          $"Is leave ke {days:0.#} din me se {days - left:0.#} din bina paise (LWP) maane jaayenge.\n\nPhir bhi save karein?");
    }

    private void ExportBalance()
    {
        var path = Ui.SaveFile("Excel (*.xlsx)|*.xlsx", $"Leave_Balance_{(int)_year.Value}.xlsx");
        if (path == null) return;
        try { ExcelExporter.Export(PayrollService.LeaveBalance("Leave Balance", (int)_year.Value, null, null), path); Ui.Info("Saved: " + path); }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private void EditHoliday(int? id)
    {
        try
        {
            using var db = new AppDbContext();
            var h = id == null ? new Holiday { Date = DateTime.Today } : db.Holidays.Find(id)!;
            var dlg = new FormDialog(id == null ? "Add Holiday" : "Edit Holiday");
            var date = dlg.AddDate("Date", h.Date);
            var name = dlg.AddText("Holiday name *", h.Name);
            dlg.Validator = () =>
            {
                if (string.IsNullOrWhiteSpace(name.Text)) return "Name zaroori hai.";
                using var db2 = new AppDbContext();
                return db2.Holidays.Any(x => x.Date == date.Value.Date && x.Id != h.Id) ? "Is date par holiday pehle se hai." : null;
            };
            if (dlg.ShowDialog(this) != DialogResult.OK) return;
            h.Date = date.Value.Date;
            h.Name = name.Text.Trim();
            if (id == null) db.Holidays.Add(h);
            db.SaveChanges();
            LoadData();
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private void EditType(int? id)
    {
        try
        {
            using var db = new AppDbContext();
            var t = id == null ? new LeaveType() : db.LeaveTypes.Find(id)!;
            var dlg = new FormDialog(id == null ? "Add Leave Type" : "Edit Leave Type");
            var code = dlg.AddText("Code * (e.g. CL)", t.Code);
            var name = dlg.AddText("Name *", t.Name);
            var paid = dlg.AddCheck("Paid", t.IsPaid, "Paid leave (Paid Days me count hogi)");
            var quota = dlg.AddNumber("Yearly quota (din, 0 = no limit)", (decimal)t.YearlyQuota, 0, 366);
            quota.DecimalPlaces = 1;
            quota.Increment = 0.5m;
            dlg.AddNote("Quota khatam hone ke baad is type ki leave apne aap bina paise (LWP) gini jaayegi.");
            dlg.Validator = () => string.IsNullOrWhiteSpace(code.Text) || string.IsNullOrWhiteSpace(name.Text) ? "Code aur Name zaroori hain." : null;
            if (dlg.ShowDialog(this) != DialogResult.OK) return;
            t.Code = code.Text.Trim().ToUpperInvariant();
            t.Name = name.Text.Trim();
            t.IsPaid = paid.Checked;
            t.YearlyQuota = (double)quota.Value;
            if (id == null) db.LeaveTypes.Add(t);
            db.SaveChanges();
            LoadData();
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private void DeleteRows(DataGridView grid, Action<AppDbContext, List<int>> delete)
    {
        var ids = Ui.SelectedIds(grid);
        if (ids.Count == 0 || !Ui.Confirm($"{ids.Count} record(s) delete karein?")) return;
        try
        {
            using (var db = new AppDbContext()) delete(db, ids);
            LoadData();
        }
        catch (Exception ex) { Ui.Error(ex); }
    }
}
