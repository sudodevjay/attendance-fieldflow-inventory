using System.Drawing.Drawing2D;

namespace ZkAttendance.UI;

/// <summary>Left task panel of the main window: blue background with collapsible link groups.</summary>
public class NavPanel : Panel
{
    public NavPanel()
    {
        Dock = DockStyle.Left;
        Width = 208;
        BackColor = Theme.NavBack;
        Padding = new Padding(4, 4, 4, 4);
        AutoScroll = true;
    }

    /// <summary>Groups are shown top-to-bottom in the order they are added.</summary>
    public NavGroup AddGroup(string title)
    {
        var g = new NavGroup(title) { Dock = DockStyle.Top };
        var spacer = new Panel { Dock = DockStyle.Top, Height = 6, BackColor = Theme.NavBack };
        Controls.Add(g);
        Controls.Add(spacer);
        g.BringToFront();
        spacer.BringToFront();
        return g;
    }
}

public class NavGroup : Panel
{
    private readonly Panel _header;
    private readonly FlowLayoutPanel _items;
    private bool _collapsed;

    public NavGroup(string title)
    {
        BackColor = Color.White;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;

        _items = new FlowLayoutPanel
        {
            Dock = DockStyle.Top, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(4, 4, 2, 6),
            BackColor = Color.FromArgb(244, 248, 254)
        };

        _header = new DoubleBufferedPanel { Dock = DockStyle.Top, Height = 24, Cursor = Cursors.Hand };
        _header.Paint += (_, e) => PaintHeader(e.Graphics, title);
        _header.Click += (_, _) => Toggle();

        Controls.Add(_items);
        Controls.Add(_header);
    }

    public NavGroup Item(string text, Image icon, Action onClick, bool enabled = true)
    {
        var l = new LinkLabel
        {
            Text = text, Image = icon, ImageAlign = ContentAlignment.MiddleLeft, AutoSize = false, Width = 194, Height = 19,
            Padding = new Padding(18, 0, 0, 0), TextAlign = ContentAlignment.MiddleLeft, Font = Theme.Base, UseMnemonic = false,
            LinkBehavior = LinkBehavior.HoverUnderline, LinkColor = Color.FromArgb(16, 50, 130),
            ActiveLinkColor = Color.FromArgb(200, 80, 0), DisabledLinkColor = Color.Gray, Enabled = enabled,
            Margin = new Padding(0), Cursor = Cursors.Hand
        };
        l.LinkClicked += (_, _) =>
        {
            try { onClick(); }
            catch (Exception ex) { Ui.Error(ex); }
        };
        _items.Controls.Add(l);
        return this;
    }

    private void Toggle()
    {
        _collapsed = !_collapsed;
        _items.Visible = !_collapsed;
        _header.Invalidate();
    }

    private void PaintHeader(Graphics g, string title)
    {
        var r = _header.ClientRectangle;
        using (var b = new LinearGradientBrush(r, Color.White, Color.FromArgb(198, 216, 244), LinearGradientMode.Horizontal))
            g.FillRectangle(b, r);
        TextRenderer.DrawText(g, title, Theme.Base, new Rectangle(6, 0, r.Width - 30, r.Height), Theme.HeaderText,
            TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);

        // Round collapse button with a chevron, like the original.
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var c = new Rectangle(r.Width - 21, 4, 16, 16);
        using (var cb = new LinearGradientBrush(c, Color.White, Color.FromArgb(180, 200, 235), LinearGradientMode.Vertical))
            g.FillEllipse(cb, c);
        using var pen = new Pen(Color.FromArgb(120, 150, 200));
        g.DrawEllipse(pen, c);
        using var arrow = new Pen(Theme.HeaderText, 1.6f);
        int cx = c.X + 8, cy = c.Y + 8;
        if (_collapsed)
        {
            g.DrawLines(arrow, new Point[] { new Point(cx - 3, cy - 3), new Point(cx, cy), new Point(cx + 3, cy - 3) });
            g.DrawLines(arrow, new Point[] { new Point(cx - 3, cy + 1), new Point(cx, cy + 4), new Point(cx + 3, cy + 1) });
        }
        else
        {
            g.DrawLines(arrow, new Point[] { new Point(cx - 3, cy + 3), new Point(cx, cy), new Point(cx + 3, cy + 3) });
            g.DrawLines(arrow, new Point[] { new Point(cx - 3, cy - 1), new Point(cx, cy - 4), new Point(cx + 3, cy - 1) });
        }
    }
}

public class DoubleBufferedPanel : Panel
{
    public DoubleBufferedPanel()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
    }
}
