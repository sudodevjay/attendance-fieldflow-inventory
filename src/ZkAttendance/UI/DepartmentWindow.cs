using Microsoft.EntityFrameworkCore;
using ZkAttendance.Data;
using ZkAttendance.Services;

namespace ZkAttendance.UI;

/// <summary>"Department Management": company tree with sub-departments, like the original.</summary>
public class DepartmentWindow : Form
{
    private readonly TreeView _tree = new()
    {
        Dock = DockStyle.Fill, BorderStyle = BorderStyle.None, HideSelection = false, LabelEdit = true, AllowDrop = true,
        Font = Theme.Base, ShowLines = true, ShowRootLines = true, FullRowSelect = false, ItemHeight = 18
    };

    public static void Open(IWin32Window owner)
    {
        if (MainForm.Instance is { } main)
        {
            main.OpenScreen("departments", "Department Management", Icons.Get(Icons.Home, Color.SeaGreen), () => new DepartmentWindow());
            return;
        }
        using var w = new DepartmentWindow();
        w.ShowDialog(owner);
    }

    public DepartmentWindow()
    {
        Text = "Department Management";
        Font = Theme.Base;
        Size = new Size(540, 400);
        MinimumSize = new Size(460, 320);
        StartPosition = FormStartPosition.CenterParent;
        ShowInTaskbar = false;
        MinimizeBox = false;
        BackColor = Theme.Background;

        var images = new ImageList { ImageSize = new Size(16, 16), ColorDepth = ColorDepth.Depth32Bit };
        images.Images.Add(Icons.Get(Icons.Home, Color.SeaGreen));
        images.Images.Add(Icons.Get(Icons.Folder, Color.DarkGoldenrod));
        _tree.ImageList = images;

        var bar = Bars.Medium();
        Bars.Button(bar, "Add", Icons.Get(Icons.Add, Color.FromArgb(200, 60, 40), 20), (_, _) => AddDept());
        Bars.Button(bar, "Delete", Icons.Get(Icons.Close, Color.Red, 20), (_, _) => DeleteDept());
        Bars.Button(bar, "Rename", Icons.Get(Icons.Check, Color.Green, 20, Color.FromArgb(40, 170, 60)), (_, _) => _tree.SelectedNode?.BeginEdit());
        Bars.Button(bar, "Employee", Icons.Get(Icons.Add, Theme.Accent, 20), (_, _) => EmployeeWindow.Open(this, (_tree.SelectedNode?.Tag as int?)));

        var prompt = new Panel { Dock = DockStyle.Right, Width = 220, BackColor = Theme.Prompt, Padding = new Padding(10) };
        var icon = new PictureBox { Image = Icons.Get(Icons.Warning, Color.DarkGoldenrod, 24), Size = new Size(26, 26), Location = new Point(18, 14) };
        var title = new Label { Text = "Prompt", Font = Theme.Bold, AutoSize = true, Location = new Point(50, 20) };
        var help = new Label
        {
            Location = new Point(12, 52), Size = new Size(196, 240), Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Bottom,
            Text = "Here you can set up department names.\n\n" +
                   "• New department: select the department to create it under and click 'Add'.\n\n" +
                   "• Rename: click a department and press 'Rename' or F2.\n\n" +
                   "• To move a department under another one, drag it with the mouse and drop it on the new 'superior' department."
        };
        prompt.Controls.AddRange([icon, title, help]);

        var treePanel = new Panel { Dock = DockStyle.Fill, BorderStyle = BorderStyle.Fixed3D, BackColor = Color.White };
        treePanel.Controls.Add(_tree);

        Controls.Add(treePanel);
        Controls.Add(prompt);
        Controls.Add(bar);

        _tree.AfterLabelEdit += (_, e) => RenameDept(e);
        _tree.BeforeLabelEdit += (_, e) => { if (e.Node?.Tag == null) e.CancelEdit = true; };
        _tree.KeyDown += (_, e) =>
        {
            if (e.KeyCode == Keys.F2) _tree.SelectedNode?.BeginEdit();
            if (e.KeyCode == Keys.Delete) DeleteDept();
        };
        _tree.ItemDrag += (_, e) => { if (e.Item is TreeNode { Tag: int }) DoDragDrop(e.Item, DragDropEffects.Move); };
        _tree.DragEnter += (_, e) => e.Effect = DragDropEffects.Move;
        _tree.DragOver += (_, e) =>
        {
            var target = _tree.GetNodeAt(_tree.PointToClient(new Point(e.X, e.Y)));
            if (target != null) _tree.SelectedNode = target;
        };
        _tree.DragDrop += (_, e) => MoveDept(e);

        Load += (_, _) => LoadTree();
    }

    private void LoadTree(int? select = null)
    {
        using var db = new AppDbContext();
        var depts = db.Departments.AsNoTracking().OrderBy(d => d.Name).ToList();
        _tree.BeginUpdate();
        _tree.Nodes.Clear();
        var root = new TreeNode(ReportService.CompanyName.ToUpperInvariant(), 0, 0);
        _tree.Nodes.Add(root);
        var nodes = depts.ToDictionary(d => d.Id, d => new TreeNode(d.Name, 1, 1) { Tag = d.Id });
        foreach (var d in depts)
        {
            var parent = d.ParentId is int p && nodes.TryGetValue(p, out var pn) ? pn : root;
            parent.Nodes.Add(nodes[d.Id]);
        }
        _tree.ExpandAll();
        _tree.SelectedNode = select is int s && nodes.TryGetValue(s, out var sel) ? sel : root;
        _tree.EndUpdate();
    }

    private void AddDept()
    {
        var name = FormDialog.Prompt(this, "Add New Department", "Input name of the department to add");
        if (name == null) return;
        using var db = new AppDbContext();
        var d = new Department { Name = name, ParentId = _tree.SelectedNode?.Tag as int? };
        db.Departments.Add(d);
        db.SaveChanges();
        LoadTree(d.Id);
    }

    private void RenameDept(NodeLabelEditEventArgs e)
    {
        if (e.Node?.Tag is not int id || string.IsNullOrWhiteSpace(e.Label)) { e.CancelEdit = true; return; }
        using var db = new AppDbContext();
        db.Departments.First(d => d.Id == id).Name = e.Label.Trim();
        db.SaveChanges();
    }

    private void DeleteDept()
    {
        if (_tree.SelectedNode?.Tag is not int id) return;
        if (_tree.SelectedNode.Nodes.Count > 0) { Ui.Info("This department has sub-departments. Delete or move them first."); return; }
        using var db = new AppDbContext();
        int count = db.Employees.Count(e => e.DepartmentId == id);
        if (!Ui.Confirm($"Delete department '{_tree.SelectedNode.Text}'?" + (count > 0 ? $"\n{count} employee(s) will be left without a department." : ""))) return;
        db.Employees.Where(e => e.DepartmentId == id).ExecuteUpdate(s => s.SetProperty(e => e.DepartmentId, (int?)null));
        db.Departments.Where(d => d.Id == id).ExecuteDelete();
        LoadTree();
    }

    private void MoveDept(DragEventArgs e)
    {
        if (e.Data?.GetData(typeof(TreeNode)) is not TreeNode { Tag: int id } node) return;
        var target = _tree.GetNodeAt(_tree.PointToClient(new Point(e.X, e.Y)));
        if (target == null || target == node) return;
        for (var t = target; t != null; t = t.Parent)
            if (t == node) { Ui.Info("A department cannot be moved under one of its own sub-departments."); return; }

        using var db = new AppDbContext();
        db.Departments.First(d => d.Id == id).ParentId = target.Tag as int?;
        db.SaveChanges();
        LoadTree(id);
    }

    /// <summary>The department and all its sub-departments (for "Include sub department").</summary>
    public static HashSet<int> WithChildren(int id)
    {
        using var db = new AppDbContext();
        var all = db.Departments.AsNoTracking().Select(d => new { d.Id, d.ParentId }).ToList();
        var set = new HashSet<int> { id };
        bool added;
        do
        {
            added = false;
            foreach (var d in all)
                if (d.ParentId is int p && set.Contains(p) && set.Add(d.Id)) added = true;
        } while (added);
        return set;
    }
}
