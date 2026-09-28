namespace ZkAttendance.UI;

/// <summary>Base for every screen hosted in the main window: toolbar on top, body below.</summary>
public class PageBase : UserControl
{
    protected readonly FlowLayoutPanel Toolbar = Ui.Toolbar();
    protected readonly Panel Body = new() { Dock = DockStyle.Fill, BackColor = Theme.Background };

    public virtual string Title => GetType().Name;

    public PageBase()
    {
        Dock = DockStyle.Fill;
        BackColor = Theme.Background;
        Padding = new Padding(8);
        Font = Theme.Base;
        Controls.Add(Body);
        Controls.Add(Toolbar);
    }

    /// <summary>Called every time the page is navigated to.</summary>
    public virtual void OnActivated() { }
}

/// <summary>Child window hosting a page (AC Log, Report, Timetables ...), like the separate windows of the original program.</summary>
public class PageWindow : Form
{
    public PageWindow(PageBase page, Size size)
    {
        Text = page.Title;
        Font = Theme.Base;
        BackColor = Theme.Background;
        Size = size;
        MinimumSize = new Size(640, 400);
        StartPosition = FormStartPosition.CenterParent;
        ShowInTaskbar = false;
        MinimizeBox = false;
        Controls.Add(page);
        Load += (_, _) => page.OnActivated();
    }

    private static readonly Dictionary<string, (string glyph, Color color)> PageIcons = new()
    {
        ["AttendanceLogsPage"] = (Icons.Clock, Theme.Accent),
        ["LiveLogPage"] = (Icons.Fingerprint, Color.SeaGreen),
        ["ReportsPage"] = (Icons.Report, Color.SteelBlue),
        ["ShiftsPage"] = (Icons.Timer, Color.Brown),
        ["LeavePage"] = (Icons.Flag, Color.Purple),
        ["SettingsPage"] = (Icons.Settings, Color.DimGray),
    };

    /// <summary>Opens the page as a tab inside the main window (separate window only if there is no main window).</summary>
    public static void Show(IWin32Window owner, PageBase page, int width = 1000, int height = 620)
    {
        if (MainForm.Instance is { } main)
        {
            var key = page.GetType().Name;
            var icon = PageIcons.TryGetValue(key, out var i) ? Icons.Get(i.glyph, i.color) : null;
            var shown = main.OpenScreen(key, page.Title, icon, () => page);
            if (shown != page) page.Dispose();
            return;
        }
        using var w = new PageWindow(page, new Size(width, height));
        w.ShowDialog(owner);
    }
}
