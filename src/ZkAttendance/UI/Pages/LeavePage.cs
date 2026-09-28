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
        Ui.ColorStatus(_leaves, ["Status"]);
        _leaves.CellDoubleClick += (_, e) => { if (e.RowIndex >= 0) EditLeave(Ui.SelectedId(_leaves)); };
        tabs.TabPages.Add(Tab("Leave Entries", _leaves,
            Ui.Button("＋ Add Leave", (_, _) => EditLeave(null), ButtonStyle.Primary),
            Ui.Button("✎ Edit", (_, _) => EditLeave(Ui.SelectedId(_leaves))),
            Ui.Button("✔ Approve", (_, _) => Decide(LeaveStatus.Approved), ButtonStyle.Success),
            Ui.Button("✖ Reject", (_, _) => Decide(LeaveStatus.Rejected)),
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
                .Where(l => l.FromDate <= to && l.ToDate >= from)
                .OrderBy(l => l.Status == LeaveStatus.Pending ? 0 : 1).ThenByDescending(l => l.FromDate).ToList();
            _leaves.DataSource = Ui.ToTable(leaves,
                ("Id", l => l.Id), ("Status", l => l.Status.ToString()), ("Emp ID", l => l.Employee?.EnrollNo), ("Name", l => l.Employee?.Name),
                ("Type", l => l.LeaveType?.Code), ("From", l => l.FromDate.ToString("dd-MM-yyyy")), ("To", l => l.ToDate.ToString("dd-MM-yyyy")),
                ("Days", l => l.IsHalfDay ? 0.5 : (l.ToDate - l.FromDate).Days + 1), ("Half Day", l => l.IsHalfDay ? "Yes" : ""),
                ("Applied On", l => l.AppliedOn?.ToString("dd-MM-yyyy")), ("Approved By", l => l.ApprovedBy),
                ("Decided On", l => l.ApprovedOn?.ToString("dd-MM-yyyy")), ("Reason", l => l.Reason));

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

    private static readonly string[] StatusNames = ["Pending", "Approved", "Rejected"];

    /// <summary>Add (id = null) or edit a leave request: who, which type, dates, when asked, status and who approved.</summary>
    private void EditLeave(int? id)
    {
        try
        {
            using var db = new AppDbContext();
            var l = id == null ? new LeaveEntry { FromDate = DateTime.Today, ToDate = DateTime.Today, AppliedOn = DateTime.Today }
                               : db.LeaveEntries.First(x => x.Id == id);
            var emps = db.Employees.Where(e => e.IsActive || e.Id == l.EmployeeId).AsEnumerable()
                .OrderBy(e => AttendanceProcessor.SortKey(e.EnrollNo)).ToList();
            var types = db.LeaveTypes.OrderBy(t => t.Code).ToList();
            var dlg = new FormDialog(id == null ? "Add Leave" : "Edit Leave");
            var emp = dlg.AddCombo("Employee", emps, emps.FirstOrDefault(e => e.Id == l.EmployeeId));
            var type = dlg.AddCombo("Leave type", types, types.FirstOrDefault(t => t.Id == l.LeaveTypeId));
            var from = dlg.AddDate("From", l.FromDate);
            var to = dlg.AddDate("To", l.ToDate);
            var half = dlg.AddCheck("Half day", l.IsHalfDay, "Half day (single date)");
            var applied = dlg.AddDate("Applied on (email / request date)", l.AppliedOn, optional: true);
            var status = dlg.AddCombo("Status", StatusNames, StatusNames[(int)l.Status]);
            var by = dlg.AddText("Approved / Rejected by", l.ApprovedBy ?? (id == null ? AppDbContext.GetSetting("Leave.LastApprover") : ""));
            var reason = dlg.AddText("Reason / remark", l.Reason, multiline: true);
            dlg.AddNote("Only 'Approved' leave counts for attendance, salary and quota. Days of a 'Pending' leave count as absent until it is approved.");
            void Toggle() => by.Enabled = status.SelectedIndex != (int)LeaveStatus.Pending;
            status.SelectedIndexChanged += (_, _) => Toggle();
            Toggle();
            dlg.Validator = () =>
            {
                if (emp.SelectedItem == null || type.SelectedItem == null) return "Select an employee and a leave type.";
                if (to.Value.Date < from.Value.Date) return "The 'To' date cannot be before the 'From' date.";
                if (half.Checked && to.Value.Date != from.Value.Date) return "A half-day leave can only be for a single date.";
                if (status.SelectedIndex != (int)LeaveStatus.Pending && string.IsNullOrWhiteSpace(by.Text))
                    return "Enter the name of the person who approved / rejected it.";
                return null;
            };
            if (dlg.ShowDialog(this) != DialogResult.OK) return;

            var newStatus = (LeaveStatus)status.SelectedIndex;
            l.EmployeeId = ((Employee)emp.SelectedItem!).Id;
            l.LeaveTypeId = ((LeaveType)type.SelectedItem!).Id;
            l.FromDate = from.Value.Date;
            l.ToDate = to.Value.Date;
            l.IsHalfDay = half.Checked;
            l.AppliedOn = applied.Checked ? applied.Value.Date : null;
            l.Reason = reason.Text.Trim();
            if (newStatus == LeaveStatus.Approved && !ConfirmQuota(l, (LeaveType)type.SelectedItem!)) return;
            SetStatus(l, newStatus, by.Text);
            if (id == null) db.LeaveEntries.Add(l);
            db.SaveChanges();
            LoadData();
            AppState.RaiseDataChanged();
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    /// <summary>Approve / reject the selected requests in one go.</summary>
    private void Decide(LeaveStatus decision)
    {
        var ids = Ui.SelectedIds(_leaves);
        if (ids.Count == 0) { Ui.Info("Select a leave request first."); return; }
        var word = decision == LeaveStatus.Approved ? "Approve" : "Reject";
        var by = FormDialog.Prompt(this, $"{word} leave", $"{word} {ids.Count} leave request(s).\n{(decision == LeaveStatus.Approved ? "Approved" : "Rejected")} by (name)?",
            AppDbContext.GetSetting("Leave.LastApprover"));
        if (string.IsNullOrWhiteSpace(by)) return;
        try
        {
            using var db = new AppDbContext();
            foreach (var l in db.LeaveEntries.Include(x => x.LeaveType).Where(x => ids.Contains(x.Id)).ToList())
            {
                if (decision == LeaveStatus.Approved && l.Status != LeaveStatus.Approved && l.LeaveType != null && !ConfirmQuota(l, l.LeaveType)) continue;
                SetStatus(l, decision, by);
            }
            db.SaveChanges();
            LoadData();
            AppState.RaiseDataChanged();
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private static void SetStatus(LeaveEntry l, LeaveStatus status, string by)
    {
        if (status == LeaveStatus.Pending) { l.ApprovedBy = null; l.ApprovedOn = null; }
        else
        {
            if (l.Status != status || l.ApprovedOn == null) l.ApprovedOn = DateTime.Today;
            l.ApprovedBy = by.Trim();
            AppDbContext.SetSetting("Leave.LastApprover", l.ApprovedBy);
        }
        l.Status = status;
    }

    /// <summary>Warns when the new leave goes beyond the yearly quota (the extra days become unpaid).</summary>
    private bool ConfirmQuota(LeaveEntry entry, LeaveType type)
    {
        if (!type.IsPaid || type.YearlyQuota <= 0) return true;
        double days = PayrollService.DaysFor(entry);
        if (entry.FromDate.Year != entry.ToDate.Year) return true;
        var (quota, taken) = PayrollService.Balance(entry.EmployeeId, type.Id, entry.FromDate.Year, entry.Id);
        double left = Math.Max(0, quota - taken);
        if (days <= left) return true;
        return Ui.Confirm($"{type.Code} balance: {left:0.#} day(s) (quota {quota:0.#}, already taken {taken:0.#}).\n" +
                          $"{days - left:0.#} of the {days:0.#} day(s) of this leave will be unpaid (LWP).\n\nSave anyway?");
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
                if (string.IsNullOrWhiteSpace(name.Text)) return "Name is required.";
                using var db2 = new AppDbContext();
                return db2.Holidays.Any(x => x.Date == date.Value.Date && x.Id != h.Id) ? "A holiday already exists on this date." : null;
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
            var paid = dlg.AddCheck("Paid", t.IsPaid, "Paid leave (counted in Paid Days)");
            var quota = dlg.AddNumber("Yearly quota (days, 0 = no limit)", (decimal)t.YearlyQuota, 0, 366);
            quota.DecimalPlaces = 1;
            quota.Increment = 0.5m;
            dlg.AddNote("When the quota is used up, further leave of this type is counted as unpaid (LWP).");
            dlg.Validator = () => string.IsNullOrWhiteSpace(code.Text) || string.IsNullOrWhiteSpace(name.Text) ? "Code and Name are required." : null;
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
        if (ids.Count == 0 || !Ui.Confirm($"Delete {ids.Count} record(s)?")) return;
        try
        {
            using (var db = new AppDbContext()) delete(db, ids);
            LoadData();
        }
        catch (Exception ex) { Ui.Error(ex); }
    }
}
