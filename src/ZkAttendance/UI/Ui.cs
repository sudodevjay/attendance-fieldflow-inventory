using System.Data;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using ZkAttendance.Services;

namespace ZkAttendance.UI;

/// <summary>Classic "Attendance Management Program" look: Tahoma, light-blue gradients, system controls.</summary>
public static class Theme
{
    public static readonly Color Background = Color.FromArgb(240, 240, 240);
    public static readonly Color Card = Color.White;
    public static readonly Color Border = Color.FromArgb(160, 175, 195);
    public static readonly Color GridLine = Color.FromArgb(214, 222, 235);
    public static readonly Color Text = Color.Black;
    public static readonly Color Muted = Color.FromArgb(90, 90, 90);
    public static readonly Color Accent = Color.FromArgb(29, 83, 181);
    public static readonly Color Success = Color.FromArgb(0, 128, 0);
    public static readonly Color Danger = Color.FromArgb(200, 0, 0);
    public static readonly Color Warning = Color.FromArgb(200, 110, 0);

    /// <summary>Selected row in grids (strong blue like the original).</summary>
    public static readonly Color Selection = Color.FromArgb(49, 106, 197);
    public static readonly Color BarTop = Color.FromArgb(236, 244, 255);
    public static readonly Color BarBottom = Color.FromArgb(190, 214, 245);
    public static readonly Color HeaderText = Color.FromArgb(21, 66, 139);
    /// <summary>Background of the left navigation panel.</summary>
    public static readonly Color NavBack = Color.FromArgb(62, 114, 204);
    public static readonly Color Prompt = Color.FromArgb(236, 233, 216);

    public static readonly Font Base = new("Tahoma", 8.25f);
    public static readonly Font Bold = new("Tahoma", 8.25f, FontStyle.Bold);
    public static readonly Font Title = new("Tahoma", 10f, FontStyle.Bold);
    public static readonly Font Big = new("Tahoma", 16f, FontStyle.Bold);

    public static void PaintBar(Graphics g, Rectangle r)
    {
        if (r.Width <= 0 || r.Height <= 0) return;
        using var b = new LinearGradientBrush(r, BarTop, BarBottom, LinearGradientMode.Vertical);
        g.FillRectangle(b, r);
    }
}

public enum ButtonStyle { Primary, Secondary, Danger, Success }

/// <summary>Toolbar/menu colors: the light-blue gradient of the original program.</summary>
public class BlueColorTable : ProfessionalColorTable
{
    public override Color ToolStripGradientBegin => Theme.BarTop;
    public override Color ToolStripGradientMiddle => Color.FromArgb(214, 229, 250);
    public override Color ToolStripGradientEnd => Theme.BarBottom;
    public override Color ToolStripBorder => Color.FromArgb(150, 180, 220);
    public override Color MenuStripGradientBegin => Color.FromArgb(246, 249, 254);
    public override Color MenuStripGradientEnd => Color.FromArgb(226, 236, 250);
    public override Color ButtonSelectedGradientBegin => Color.FromArgb(255, 244, 204);
    public override Color ButtonSelectedGradientMiddle => Color.FromArgb(255, 226, 150);
    public override Color ButtonSelectedGradientEnd => Color.FromArgb(255, 214, 120);
    public override Color ButtonSelectedBorder => Color.FromArgb(194, 138, 48);
    public override Color ButtonPressedGradientBegin => Color.FromArgb(254, 200, 120);
    public override Color ButtonPressedGradientEnd => Color.FromArgb(250, 170, 80);
    public override Color StatusStripGradientBegin => Color.FromArgb(226, 236, 250);
    public override Color StatusStripGradientEnd => Color.FromArgb(200, 218, 243);
    public static readonly ToolStripProfessionalRenderer Renderer = new(new BlueColorTable()) { RoundedEdges = false };
}

/// <summary>Draws toolbar/menu icons from the Segoe MDL2 Assets symbol font (ships with Windows 10/11).</summary>
public static class Icons
{
    private static readonly Dictionary<string, Bitmap> Cache = new();
    private static readonly string FontName =
        new InstalledFontCollection().Families.Any(f => f.Name == "Segoe MDL2 Assets") ? "Segoe MDL2 Assets" : "Segoe UI Symbol";

    public const string People = "", Person = "", Clock = "", Report = "", Device = "",
        Fingerprint = "", Close = "", Play = "", Stop = "", Power = "", Add = "",
        Save = "", Delete = "", Undo = "", Refresh = "", Search = "", Import = "",
        Export = "", Upload = "", Download = "", Rename = "", Folder = "", Home = "",
        Calendar = "", Settings = "", Usb = "", Photo = "", Lock = "", Check = "",
        Info = "", Warning = "", Rule = "", Timer = "", Flag = "", Sun = "",
        Print = "", Help = "", Sync = "", Backup = "", Door = "", Table = "",
        Up = "", Down = "", List = "";

    /// <param name="circle">When set, the glyph is drawn white on a shaded ball of this color.</param>
    public static Bitmap Get(string glyph, Color color, int size = 16, Color? circle = null)
    {
        var key = $"{glyph}|{color.ToArgb()}|{size}|{circle?.ToArgb()}";
        if (Cache.TryGetValue(key, out var bmp)) return bmp;

        bmp = new Bitmap(size, size);
        using var g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        float fontPx = size * 0.78f;
        if (circle is { } c)
        {
            var r = new Rectangle(1, 1, size - 3, size - 3);
            using var path = new GraphicsPath();
            path.AddEllipse(r);
            using var pb = new PathGradientBrush(path)
            {
                CenterColor = ControlPaint.Light(c, 0.9f), SurroundColors = [ControlPaint.Dark(c, 0.05f)],
                CenterPoint = new PointF(size * 0.4f, size * 0.35f)
            };
            g.FillEllipse(pb, r);
            using var pen = new Pen(ControlPaint.Dark(c, 0.3f));
            g.DrawEllipse(pen, r);
            color = Color.White;
            fontPx = size * 0.46f;
        }
        using var font = new Font(FontName, fontPx, GraphicsUnit.Pixel);
        using var brush = new SolidBrush(color);
        var fmt = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
        g.DrawString(glyph, font, brush, new RectangleF(0, 1, size, size), fmt);
        Cache[key] = bmp;
        return bmp;
    }
}

public static class Ui
{
    public static Button Button(string text, EventHandler? onClick = null, ButtonStyle style = ButtonStyle.Secondary)
    {
        var b = new FlatButton
        {
            Text = text, AutoSize = true, MinimumSize = new Size(75, 25), Height = 25, Font = Theme.Base,
            FlatStyle = FlatStyle.Standard, UseVisualStyleBackColor = true, Margin = new Padding(0, 0, 6, 0),
            TextImageRelation = TextImageRelation.ImageBeforeText, ImageAlign = ContentAlignment.MiddleLeft
        };
        if (onClick != null) b.Click += onClick;
        return b;
    }

    /// <summary>Button with a colored icon, e.g. the green check "OK" and red cross "Cancel".</summary>
    public static Button IconButton(string text, string glyph, Color color, EventHandler? onClick = null)
    {
        var b = Button("  " + text, onClick);
        b.Image = Icons.Get(glyph, color, 16);
        b.Padding = new Padding(4, 0, 4, 0);
        return b;
    }

    public static Label Label(string text, Font? font = null, Color? color = null) => new()
    {
        Text = text, AutoSize = true, UseMnemonic = false, Font = font ?? Theme.Base, ForeColor = color ?? Theme.Text,
        Margin = new Padding(0, 6, 4, 0)
    };

    public static DataGridView Grid()
    {
        var g = new DataGridView
        {
            Dock = DockStyle.Fill, ReadOnly = true, AllowUserToAddRows = false, AllowUserToDeleteRows = false,
            AllowUserToResizeRows = false, RowHeadersVisible = false, SelectionMode = DataGridViewSelectionMode.FullRowSelect,
            BackgroundColor = Color.White, BorderStyle = BorderStyle.None, CellBorderStyle = DataGridViewCellBorderStyle.Single,
            GridColor = Theme.GridLine, EnableHeadersVisualStyles = true, AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill,
            ColumnHeadersHeightSizeMode = DataGridViewColumnHeadersHeightSizeMode.DisableResizing, ColumnHeadersHeight = 22,
            Font = Theme.Base, MultiSelect = true, StandardTab = true
        };
        g.RowTemplate.Height = 20;
        g.DefaultCellStyle.SelectionBackColor = Theme.Selection;
        g.DefaultCellStyle.SelectionForeColor = Color.White;
        g.RowHeadersWidth = 22;
        typeof(DataGridView).GetProperty("DoubleBuffered", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!
            .SetValue(g, true);
        return g;
    }

    /// <summary>Colors status cells (P/A/HD/...) in a grid.</summary>
    public static void ColorStatus(DataGridView g, ICollection<string> statusColumns)
    {
        g.CellFormatting += (_, e) =>
        {
            if (e.ColumnIndex < 0 || e.RowIndex < 0) return;
            if (!statusColumns.Contains(g.Columns[e.ColumnIndex].Name)) return;
            if (ReportService.StatusColor(e.Value?.ToString() ?? "") is { } c)
            {
                e.CellStyle!.BackColor = c.back;
                e.CellStyle.ForeColor = c.fore;
                e.CellStyle.Alignment = DataGridViewContentAlignment.MiddleCenter;
                e.CellStyle.Font = Theme.Bold;
            }
        };
    }

    public static FlowLayoutPanel Toolbar() => new()
    {
        Dock = DockStyle.Top, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink,
        Padding = new Padding(0, 0, 0, 6), WrapContents = true, BackColor = Theme.Background
    };

    public static Panel Card(Control content, Padding? padding = null)
    {
        var p = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Card, Padding = padding ?? new Padding(0), BorderStyle = BorderStyle.FixedSingle };
        content.Dock = DockStyle.Fill;
        p.Controls.Add(content);
        return p;
    }

    public static void Error(Exception ex)
    {
        var msg = ex is AggregateException { InnerException: { } inner } ? inner.Message : ex.Message;
        if (ex.InnerException is { } ie && ex is Microsoft.EntityFrameworkCore.DbUpdateException) msg += "\n\n" + ie.Message;
        MessageBox.Show(msg, "Attendance Management Program", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    public static void Info(string msg) => MessageBox.Show(msg, "Attendance Management Program", MessageBoxButtons.OK, MessageBoxIcon.Information);

    public static bool Confirm(string msg) =>
        MessageBox.Show(msg, "Attendance Management Program", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes;

    /// <summary>Runs an async UI action with a wait cursor, disabling the sender while it runs.</summary>
    public static async Task Busy(Control owner, Func<Task> work)
    {
        var form = owner.FindForm();
        owner.Enabled = false;
        if (form != null) form.UseWaitCursor = true;
        try { await work(); }
        catch (Exception ex) { Error(ex); }
        finally
        {
            owner.Enabled = true;
            if (form != null) form.UseWaitCursor = false;
        }
    }

    public static int? SelectedId(DataGridView g, string column = "Id")
    {
        if (g.CurrentRow == null || !g.Columns.Contains(column)) return null;
        return g.CurrentRow.Cells[column].Value is int i ? i : null;
    }

    public static List<int> SelectedIds(DataGridView g, string column = "Id") =>
        g.SelectedRows.Cast<DataGridViewRow>().Select(r => r.Cells[column].Value).OfType<int>().ToList();

    public static string? SaveFile(string filter, string fileName)
    {
        using var d = new SaveFileDialog { Filter = filter, FileName = fileName };
        return d.ShowDialog() == DialogResult.OK ? d.FileName : null;
    }

    public static DataTable ToTable<T>(IEnumerable<T> rows, params (string name, Func<T, object?> value)[] cols)
    {
        var t = new DataTable();
        foreach (var c in cols) t.Columns.Add(c.name, typeof(object));
        foreach (var r in rows) t.Rows.Add(cols.Select(c => c.value(r) ?? DBNull.Value).ToArray());
        return t;
    }
}

/// <summary>Button without the dotted focus rectangle.</summary>
public class FlatButton : Button
{
    protected override bool ShowFocusCues => false;
}

/// <summary>Light-blue gradient caption bar ("Machine List").</summary>
public class HeaderBar : Control
{
    public HeaderBar(string text)
    {
        Text = text;
        Dock = DockStyle.Top;
        Height = 22;
        Font = Theme.Base;
        ForeColor = Theme.HeaderText;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Theme.PaintBar(e.Graphics, ClientRectangle);
        using var pen = new Pen(Color.FromArgb(150, 180, 220));
        e.Graphics.DrawLine(pen, 0, Height - 1, Width, Height - 1);
        e.Graphics.FillRectangle(Brushes.SteelBlue, 6, 5, 2, Height - 10);
        TextRenderer.DrawText(e.Graphics, Text, Font, new Rectangle(14, 0, Width - 14, Height), ForeColor,
            TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.NoPrefix);
    }
}

/// <summary>Standard toolbar (large icons, text below) used by the main window and child windows.</summary>
public static class Bars
{
    public static ToolStrip Large() => new()
    {
        GripStyle = ToolStripGripStyle.Hidden, ImageScalingSize = new Size(32, 32), Renderer = BlueColorTable.Renderer,
        Padding = new Padding(6, 2, 6, 2), Font = Theme.Base, Dock = DockStyle.Top, AutoSize = true, ShowItemToolTips = false
    };

    public static ToolStrip Medium() => new()
    {
        GripStyle = ToolStripGripStyle.Hidden, ImageScalingSize = new Size(20, 20), Renderer = BlueColorTable.Renderer,
        Padding = new Padding(4, 1, 4, 1), Font = Theme.Base, Dock = DockStyle.Top, AutoSize = true, ShowItemToolTips = false
    };

    public static ToolStripButton Button(ToolStrip bar, string text, Image image, EventHandler onClick)
    {
        var b = new ToolStripButton(text, image, onClick)
        {
            TextImageRelation = TextImageRelation.ImageAboveText, DisplayStyle = ToolStripItemDisplayStyle.ImageAndText,
            AutoSize = true, Margin = new Padding(3, 1, 3, 2), ImageScaling = ToolStripItemImageScaling.SizeToFit
        };
        bar.Items.Add(b);
        return b;
    }
}
