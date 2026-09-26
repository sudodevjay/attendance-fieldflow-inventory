using Microsoft.EntityFrameworkCore;
using ZkAttendance.Data;

namespace ZkAttendance.UI.Pages;

public class ShiftsPage : PageBase
{
    public override string Title => "Shifts";
    private readonly DataGridView _grid = Ui.Grid();
    private static readonly string[] Days = Enum.GetNames<DayOfWeek>();

    public ShiftsPage()
    {
        Toolbar.Controls.Add(Ui.Button("＋ Add Shift", (_, _) => Edit(null), ButtonStyle.Primary));
        Toolbar.Controls.Add(Ui.Button("✎ Edit", (_, _) => Edit(Ui.SelectedId(_grid))));
        Toolbar.Controls.Add(Ui.Button("🗑 Delete", (_, _) => Delete(), ButtonStyle.Danger));
        Toolbar.Controls.Add(Ui.Label("Night shift ke liye End time Start se kam rakhein (jaise 22:00 → 06:00).", color: Theme.Muted));
        _grid.CellDoubleClick += (_, e) => { if (e.RowIndex >= 0) Edit(Ui.SelectedId(_grid)); };
        Body.Controls.Add(Ui.Card(_grid));
    }

    public override void OnActivated() => LoadData();

    private void LoadData()
    {
        using var db = new AppDbContext();
        var counts = db.Employees.GroupBy(e => e.ShiftId).Select(g => new { g.Key, C = g.Count() }).ToDictionary(x => x.Key ?? 0, x => x.C);
        _grid.DataSource = Ui.ToTable(db.Shifts.AsNoTracking().OrderBy(s => s.Name).ToList(),
            ("Id", s => s.Id), ("Name", s => s.Name), ("Start", s => s.StartTime.ToString(@"hh\:mm")), ("End", s => s.EndTime.ToString(@"hh\:mm")),
            ("Hours", s => s.Duration.ToString(@"hh\:mm")), ("Late Grace (min)", s => s.LateGraceMinutes), ("Early Grace (min)", s => s.EarlyGraceMinutes),
            ("Half Day below (min)", s => s.HalfDayMinutes), ("Min OT (min)", s => s.MinOvertimeMinutes), ("Weekly Off", s => s.WeeklyOffs),
            ("Employees", s => counts.GetValueOrDefault(s.Id)));
        _grid.Columns["Id"]!.Visible = false;
    }

    private void Edit(int? id)
    {
        try
        {
            using var db = new AppDbContext();
            var s = id == null ? new Shift() : db.Shifts.Find(id)!;
            var dlg = new FormDialog(id == null ? "Add Shift" : "Edit Shift");
            var name = dlg.AddText("Shift name *", s.Name);
            var start = dlg.AddTime("Start time", s.StartTime);
            var end = dlg.AddTime("End time", s.EndTime);
            var late = dlg.AddNumber("Late grace (min)", s.LateGraceMinutes, 0, 600);
            var early = dlg.AddNumber("Early grace (min)", s.EarlyGraceMinutes, 0, 600);
            var half = dlg.AddNumber("Half day if worked < (min)", s.HalfDayMinutes, 0, 1440);
            var ot = dlg.AddNumber("OT counted after (min)", s.MinOvertimeMinutes, 0, 1440);
            var offs = dlg.AddCheckList("Weekly off", Days, s.WeeklyOffs.Split(',', StringSplitOptions.TrimEntries));
            dlg.AddNote("Late = shift start + grace ke baad aaye. OT = shift ke ghanton se zyada kaam, agar extra time 'OT counted after' se zyada ho.");
            dlg.Validator = () => string.IsNullOrWhiteSpace(name.Text) ? "Shift name zaroori hai." : null;
            if (dlg.ShowDialog(this) != DialogResult.OK) return;

            s.Name = name.Text.Trim();
            s.StartTime = new TimeSpan(start.Value.Hour, start.Value.Minute, 0);
            s.EndTime = new TimeSpan(end.Value.Hour, end.Value.Minute, 0);
            s.LateGraceMinutes = (int)late.Value;
            s.EarlyGraceMinutes = (int)early.Value;
            s.HalfDayMinutes = (int)half.Value;
            s.MinOvertimeMinutes = (int)ot.Value;
            s.WeeklyOffs = string.Join(",", offs.CheckedItems.Cast<string>());
            if (id == null) db.Shifts.Add(s);
            db.SaveChanges();
            LoadData();
        }
        catch (Exception ex) { Ui.Error(ex); }
    }

    private void Delete()
    {
        if (Ui.SelectedId(_grid) is not { } id || !Ui.Confirm("Shift delete karein? Is shift ke employees bina shift ke ho jayenge.")) return;
        try
        {
            using var db = new AppDbContext();
            db.Employees.Where(e => e.ShiftId == id).ExecuteUpdate(x => x.SetProperty(e => e.ShiftId, (int?)null));
            db.Shifts.Where(s => s.Id == id).ExecuteDelete();
            LoadData();
        }
        catch (Exception ex) { Ui.Error(ex); }
    }
}
