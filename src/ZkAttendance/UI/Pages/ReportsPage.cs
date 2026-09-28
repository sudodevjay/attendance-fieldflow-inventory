using Microsoft.EntityFrameworkCore;
using ZkAttendance.Data;
using ZkAttendance.Services;

namespace ZkAttendance.UI.Pages;

public class ReportsPage : PageBase
{
    public override string Title => "Reports";

    private readonly ComboBox _kind = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 250, Margin = new Padding(0, 4, 8, 0) };
    private readonly DateTimePicker _from = new() { Format = DateTimePickerFormat.Custom, CustomFormat = "dd-MM-yyyy", Width = 120, Margin = new Padding(0, 4, 8, 0) };
    private readonly DateTimePicker _to = new() { Format = DateTimePickerFormat.Custom, CustomFormat = "dd-MM-yyyy", Width = 120, Margin = new Padding(0, 4, 8, 0) };
    private readonly Label _fromLabel = Ui.Label("From");
    private readonly Label _toLabel = Ui.Label("To");
    private readonly ComboBox _dept = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 160, Margin = new Padding(0, 4, 8, 0) };
    private readonly ComboBox _emp = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 200, Margin = new Padding(0, 4, 8, 0) };
    private readonly DataGridView _grid = Ui.Grid();
    private readonly Label _caption = new() { Dock = DockStyle.Top, Height = 40, Font = Theme.Bold, Padding = new Padding(12, 0, 0, 0), TextAlign = ContentAlignment.MiddleLeft };
    private readonly HashSet<string> _statusCols = new();
    private ReportResult? _result;

    public ReportsPage()
    {
        foreach (var c in ReportService.Catalog) _kind.Items.Add(c.Name);
        _kind.SelectedIndex = 0;
        _kind.SelectedIndexChanged += (_, _) => UpdatePickers();
        _from.Value = DateTime.Today;
        _to.Value = DateTime.Today;

        Toolbar.Controls.AddRange([_kind, _fromLabel, _from, _toLabel, _to, _dept, _emp]);
        Toolbar.Controls.Add(Ui.Button("▶ Generate", async (s, _) => await Ui.Busy((Control)s!, Generate), ButtonStyle.Primary));
        Toolbar.Controls.Add(Ui.Button("⤓ Excel", (_, _) => Export(pdf: false), ButtonStyle.Success));
        Toolbar.Controls.Add(Ui.Button("⤓ PDF", (_, _) => Export(pdf: true), ButtonStyle.Danger));
        Toolbar.Controls.Add(Ui.Button("🧾 Salary Slip", async (s, _) => await Ui.Busy((Control)s!, SalarySlip)));

        Ui.ColorStatus(_grid, _statusCols);
        _grid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.AllCells;
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Card };
        panel.Controls.Add(_grid);
        panel.Controls.Add(_caption);
        Body.Controls.Add(Ui.Card(panel));
        UpdatePickers();
    }

    public override void OnActivated()
    {
        using var db = new AppDbContext();
        _dept.Items.Clear();
        _dept.Items.Add("All departments");
        _dept.Items.AddRange(db.Departments.AsNoTracking().OrderBy(d => d.Name).ToArray<object>());
        _dept.SelectedIndex = 0;
        _emp.Items.Clear();
        _emp.Items.Add("All employees");
        _emp.Items.AddRange(db.Employees.AsNoTracking().Where(e => e.IsActive).AsEnumerable().OrderBy(e => AttendanceProcessor.SortKey(e.EnrollNo)).ToArray<object>());
        _emp.SelectedIndex = 0;
    }

    private (ReportKind kind, string name, bool monthly) Selected => ReportService.Catalog[_kind.SelectedIndex];

    private void UpdatePickers()
    {
        var sel = Selected;
        bool single = sel.kind == ReportKind.DailyAttendance;
        bool yearly = sel.kind == ReportKind.LeaveBalance;
        _toLabel.Visible = _to.Visible = !single && !sel.monthly && !yearly;
        _fromLabel.Text = yearly ? "Year" : sel.monthly ? "Month" : single ? "Date" : "From";
        _from.CustomFormat = yearly ? "yyyy" : sel.monthly ? "MMMM yyyy" : "dd-MM-yyyy";
        _from.ShowUpDown = sel.monthly || yearly;
        if (!single && !sel.monthly && !yearly && _from.Value.Date == _to.Value.Date)
            _from.Value = new DateTime(_to.Value.Year, _to.Value.Month, 1);
    }

    private async Task Generate()
    {
        var sel = Selected;
        int? dept = (_dept.SelectedItem as Department)?.Id;
        int? emp = (_emp.SelectedItem as Employee)?.Id;
        var from = _from.Value.Date;
        var to = _to.Value.Date;
        bool range = !sel.monthly && sel.kind is not (ReportKind.DailyAttendance or ReportKind.LeaveBalance);
        if (range && to < from) { Ui.Info("The 'To' date is before the 'From' date."); return; }
        if (range && (to - from).TotalDays > 400) { Ui.Info("A report can cover at most 400 days at a time."); return; }

        _result = await Task.Run(() => ReportService.Build(sel.kind, from, to, dept, emp));
        _statusCols.Clear();
        foreach (var c in _result.StatusColumns) _statusCols.Add(c);
        _grid.DataSource = _result.Table;
        foreach (DataGridViewColumn c in _grid.Columns) c.SortMode = DataGridViewColumnSortMode.Automatic;
        _caption.Text = $"{_result.Title}  —  {_result.Subtitle}   ({_result.Table.Rows.Count} rows)";
    }

    /// <summary>Salary slip PDF for the chosen month (the "From" / "Month" picker), for one employee or all shown by the filters.</summary>
    private async Task SalarySlip()
    {
        var month = new DateTime(_from.Value.Year, _from.Value.Month, 1);
        int? dept = (_dept.SelectedItem as Department)?.Id;
        var emp = _emp.SelectedItem as Employee;
        var lines = await Task.Run(() => PayrollService.Compute(month,
            AttendanceProcessor.Process(month, month.AddMonths(1).AddDays(-1), dept, emp?.Id)));
        if (lines.Count == 0) { Ui.Info("No employees found for the selected filters."); return; }

        var who = emp != null ? $"{emp.EnrollNo}_{emp.Name.Replace(' ', '_')}" : "All";
        var path = Ui.SaveFile("PDF (*.pdf)|*.pdf", $"Salary_Slip_{month:yyyy_MM}_{who}.pdf");
        if (path == null) return;
        try
        {
            await Task.Run(() => SalarySlipPdf.Export(lines, month, path));
            if (Ui.Confirm($"Salary slip saved ({lines.Count} employee(s), {month:MMMM yyyy}):\n{path}\n\nOpen it now?"))
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(path) { UseShellExecute = true });
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private void Export(bool pdf)
    {
        if (_result == null) { Ui.Info("Click 'Generate' first."); return; }
        var file = $"{_result.Title.Replace(' ', '_').Replace("/", "")}_{_from.Value:yyyyMMdd}";
        var path = pdf ? Ui.SaveFile("PDF (*.pdf)|*.pdf", file + ".pdf") : Ui.SaveFile("Excel (*.xlsx)|*.xlsx", file + ".xlsx");
        if (path == null) return;
        try
        {
            Cursor = Cursors.WaitCursor;
            if (pdf) PdfExporter.Export(_result, path);
            else ExcelExporter.Export(_result, path);
            Cursor = Cursors.Default;
            if (Ui.Confirm($"File saved:\n{path}\n\nOpen it now?"))
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(path) { UseShellExecute = true });
        }
        catch (Exception ex) { Cursor = Cursors.Default; Ui.Error(ex); }
    }
}
