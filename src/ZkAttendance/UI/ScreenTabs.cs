using System.Drawing.Drawing2D;

namespace ZkAttendance.UI;

/// <summary>
/// Tabbed work area inside the main window. Screens (Employee List, AC Log, Report ...) open here as tabs
/// instead of separate windows, so they stay part of the program. The first tab (Machine List) cannot be closed.
/// </summary>
public class ScreenTabs : TabControl
{
    private const int CloseSize = 12;
    private readonly ImageList _icons = new() { ImageSize = new Size(16, 16), ColorDepth = ColorDepth.Depth32Bit };
    private int _hoverClose = -1;

    public ScreenTabs()
    {
        Dock = DockStyle.Fill;
        DrawMode = TabDrawMode.OwnerDrawFixed;
        SizeMode = TabSizeMode.Normal;
        Padding = new Point(22, 5);
        Font = Theme.Base;
        ImageList = _icons;
        SetStyle(ControlStyles.OptimizedDoubleBuffer, true);

        var menu = new ContextMenuStrip { Renderer = BlueColorTable.Renderer };
        menu.Items.Add("Close", Icons.Get(Icons.Close, Color.Red), (_, _) => { if (SelectedTab != null) CloseTab(SelectedTab); });
        menu.Items.Add("Close all other tabs", null, (_, _) =>
        {
            foreach (var p in TabPages.Cast<TabPage>().Where(p => p != SelectedTab && IsClosable(p)).ToList()) CloseTab(p);
        });
        // Only offer the menu when right-clicking a tab header, not the screen contents.
        menu.Opening += (_, e) =>
        {
            var pt = PointToClient(Cursor.Position);
            e.Cancel = !Enumerable.Range(0, TabCount).Any(i => GetTabRect(i).Contains(pt));
        };
        ContextMenuStrip = menu;
    }

    /// <summary>Opens (or switches to) the screen identified by <paramref name="key"/>.</summary>
    public Control Open(string key, string title, Image? icon, Func<Control> factory, bool closable = true)
    {
        var existing = TabPages.Cast<TabPage>().FirstOrDefault(p => p.Name == key);
        if (existing != null)
        {
            SelectedTab = existing;
            return Hosted(existing)!;
        }

        var content = factory();
        // Tab width is measured from Text in the regular font, so it is padded with spaces to make room
        // for the icon, the bold selected text and the close button (the text is trimmed when drawn).
        var page = new TabPage("     " + title + (closable ? "          " : "   ")) { Name = key, BackColor = Theme.Background, Padding = new Padding(3), Tag = closable };
        if (icon != null)
        {
            _icons.Images.Add(key, icon);
            page.ImageKey = key;
        }

        var frame = new Panel { Dock = DockStyle.Fill, BorderStyle = BorderStyle.FixedSingle, BackColor = Theme.Background };
        if (content is Form form)
        {
            // Embed a Form as a child control so it looks like part of the main window.
            form.TopLevel = false;
            form.FormBorderStyle = FormBorderStyle.None;
            form.ShowInTaskbar = false;
            form.MinimumSize = Size.Empty;
            form.Dock = DockStyle.Fill;
            frame.Controls.Add(form);
            form.Show();
        }
        else
        {
            content.Dock = DockStyle.Fill;
            frame.Controls.Add(content);
        }
        if (closable) frame.Controls.Add(new HeaderBar(title));
        page.Controls.Add(frame);

        TabPages.Add(page);
        SelectedTab = page;
        if (content is PageBase pb) pb.OnActivated();
        return content;
    }

    public static Control? Hosted(TabPage page) =>
        page.Controls.OfType<Panel>().FirstOrDefault()?.Controls.Cast<Control>().FirstOrDefault(c => c is not HeaderBar);

    private static bool IsClosable(TabPage p) => p.Tag is true;

    public void CloseTab(TabPage page)
    {
        if (!IsClosable(page)) return;
        int index = TabPages.IndexOf(page);
        var content = Hosted(page);
        if (content is Form f) f.Close();
        TabPages.Remove(page);
        content?.Dispose();
        page.Dispose();
        if (!string.IsNullOrEmpty(page.ImageKey)) _icons.Images.RemoveByKey(page.ImageKey);
        if (TabCount > 0) SelectedIndex = Math.Max(0, Math.Min(index - 1, TabCount - 1));
    }

    protected override void OnSelectedIndexChanged(EventArgs e)
    {
        base.OnSelectedIndexChanged(e);
        if (SelectedTab != null && Hosted(SelectedTab) is PageBase pb) pb.OnActivated();
    }

    private Rectangle CloseRect(int index)
    {
        var r = GetTabRect(index);
        return new Rectangle(r.Right - CloseSize - 6, r.Top + (r.Height - CloseSize) / 2 + 1, CloseSize, CloseSize);
    }

    protected override void OnDrawItem(DrawItemEventArgs e)
    {
        var page = TabPages[e.Index];
        var r = GetTabRect(e.Index);
        bool selected = e.Index == SelectedIndex;
        var g = e.Graphics;

        using (var b = selected
                   ? new LinearGradientBrush(r, Color.White, Color.FromArgb(214, 229, 250), LinearGradientMode.Vertical)
                   : new LinearGradientBrush(r, Color.FromArgb(236, 242, 250), Color.FromArgb(200, 216, 240), LinearGradientMode.Vertical))
            g.FillRectangle(b, r);
        if (selected)
            using (var top = new Pen(Color.FromArgb(255, 170, 40), 2))
                g.DrawLine(top, r.Left + 1, r.Top + 1, r.Right - 1, r.Top + 1);

        int x = r.Left + 6;
        if (!string.IsNullOrEmpty(page.ImageKey) && _icons.Images.ContainsKey(page.ImageKey))
        {
            g.DrawImage(_icons.Images[page.ImageKey]!, x, r.Top + (r.Height - 16) / 2);
            x += 20;
        }
        var textRect = new Rectangle(x, r.Top, r.Right - x - (IsClosable(page) ? CloseSize + 8 : 4), r.Height);
        TextRenderer.DrawText(g, page.Text.Trim(), selected ? Theme.Bold : Theme.Base, textRect, selected ? Theme.HeaderText : Color.FromArgb(40, 40, 40),
            TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);

        if (IsClosable(page))
        {
            var c = CloseRect(e.Index);
            bool hover = e.Index == _hoverClose;
            if (hover)
            {
                using var hb = new SolidBrush(Color.FromArgb(232, 80, 60));
                g.FillRectangle(hb, c);
            }
            using var pen = new Pen(hover ? Color.White : Color.FromArgb(90, 90, 90), 1.5f);
            g.DrawLine(pen, c.Left + 3, c.Top + 3, c.Right - 3, c.Bottom - 3);
            g.DrawLine(pen, c.Right - 3, c.Top + 3, c.Left + 3, c.Bottom - 3);
        }
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        int hover = -1;
        for (int i = 0; i < TabCount; i++)
            if (IsClosable(TabPages[i]) && CloseRect(i).Contains(e.Location)) hover = i;
        if (hover != _hoverClose) { _hoverClose = hover; Invalidate(); }
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        if (_hoverClose != -1) { _hoverClose = -1; Invalidate(); }
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        for (int i = 0; i < TabCount; i++)
        {
            bool onTab = GetTabRect(i).Contains(e.Location);
            if (!onTab) continue;
            if (e.Button == MouseButtons.Right) SelectedIndex = i;
            if ((e.Button == MouseButtons.Left && CloseRect(i).Contains(e.Location)) || e.Button == MouseButtons.Middle)
            {
                CloseTab(TabPages[i]);
                return;
            }
        }
        base.OnMouseDown(e);
    }
}
