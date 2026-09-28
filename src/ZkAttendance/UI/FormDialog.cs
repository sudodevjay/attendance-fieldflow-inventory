namespace ZkAttendance.UI;

/// <summary>Small builder for label/field entry dialogs used by all the master screens.</summary>
public class FormDialog : Form
{
    private readonly TableLayoutPanel _layout;
    public Func<string?>? Validator { get; set; }

    public FormDialog(string title, int width = 460)
    {
        Text = title;
        Font = Theme.Base;
        BackColor = Theme.Background;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = MinimizeBox = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterParent;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Padding = new Padding(14);

        _layout = new TableLayoutPanel
        {
            ColumnCount = 2, AutoSize = true, Dock = DockStyle.Fill, Width = width,
            AutoSizeMode = AutoSizeMode.GrowAndShrink
        };
        _layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 150));
        _layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, width - 150));
        Controls.Add(_layout);
    }

    private T Add<T>(string label, T control) where T : Control
    {
        control.Width = (int)_layout.ColumnStyles[1].Width - 6;
        control.Margin = new Padding(0, 4, 0, 4);
        _layout.Controls.Add(new Label { Text = label, AutoSize = true, Margin = new Padding(0, 9, 8, 0), ForeColor = Theme.Text });
        _layout.Controls.Add(control);
        return control;
    }

    /// <summary>Simple one-line prompt dialog ("Input name of the department to add").</summary>
    public static string? Prompt(IWin32Window? owner, string title, string message, string value = "")
    {
        using var dlg = new FormDialog(title, 340);
        dlg.AddNote(message);
        var t = new TextBox { Text = value, Width = 334, Margin = new Padding(0, 10, 0, 6) };
        dlg._layout.Controls.Add(t);
        dlg._layout.SetColumnSpan(t, 2);
        dlg.Validator = () => string.IsNullOrWhiteSpace(t.Text) ? "Name cannot be empty." : null;
        dlg.Shown += (_, _) => { t.Focus(); t.SelectAll(); };
        return dlg.ShowDialog(owner) == DialogResult.OK ? t.Text.Trim() : null;
    }

    public TextBox AddText(string label, string? value = null, bool multiline = false)
    {
        var t = new TextBox { Text = value ?? "", Multiline = multiline };
        if (multiline) t.Height = 60;
        return Add(label, t);
    }

    public NumericUpDown AddNumber(string label, decimal value, decimal min = 0, decimal max = 100000) =>
        Add(label, new NumericUpDown { Minimum = min, Maximum = max, Value = Math.Clamp(value, min, max) });

    public ComboBox AddCombo(string label, IEnumerable<object> items, object? selected = null, bool allowNone = false)
    {
        var c = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList };
        if (allowNone) c.Items.Add("(none)");
        foreach (var i in items) c.Items.Add(i);
        c.SelectedItem = selected;
        if (c.SelectedIndex < 0 && c.Items.Count > 0) c.SelectedIndex = 0;
        return Add(label, c);
    }

    public DateTimePicker AddDate(string label, DateTime? value, bool optional = false)
    {
        var d = new DateTimePicker { Format = DateTimePickerFormat.Custom, CustomFormat = "dd-MM-yyyy", ShowCheckBox = optional };
        d.Value = value ?? DateTime.Today;
        if (optional) d.Checked = value != null;
        return Add(label, d);
    }

    public DateTimePicker AddTime(string label, TimeSpan value) =>
        Add(label, new DateTimePicker
        {
            Format = DateTimePickerFormat.Custom, CustomFormat = "HH:mm", ShowUpDown = true,
            Value = DateTime.Today + value
        });

    public DateTimePicker AddDateTime(string label, DateTime value) =>
        Add(label, new DateTimePicker { Format = DateTimePickerFormat.Custom, CustomFormat = "dd-MM-yyyy HH:mm:ss", Value = value });

    public CheckBox AddCheck(string label, bool value, string text = "") =>
        Add(label, new CheckBox { Checked = value, Text = text, AutoSize = true });

    public CheckedListBox AddCheckList(string label, IEnumerable<string> items, IEnumerable<string> checkedItems)
    {
        var l = new CheckedListBox { CheckOnClick = true, Height = 130, BorderStyle = BorderStyle.FixedSingle };
        var set = checkedItems.ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var i in items) l.Items.Add(i, set.Contains(i));
        return Add(label, l);
    }

    public void AddNote(string text)
    {
        var l = new Label { Text = text, AutoSize = true, MaximumSize = new Size(_layout.Width, 0), ForeColor = Theme.Text, Margin = new Padding(0, 6, 0, 6) };
        _layout.Controls.Add(l);
        _layout.SetColumnSpan(l, 2);
    }

    protected override void OnLoad(EventArgs e)
    {
        var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 14, 0, 0) };
        var ok = Ui.IconButton("OK", Icons.Check, Color.Green);
        var cancel = Ui.IconButton("Cancel", Icons.Close, Color.Red);
        cancel.DialogResult = DialogResult.Cancel;
        ok.Click += (_, _) =>
        {
            var err = Validator?.Invoke();
            if (err != null) { MessageBox.Show(err, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            DialogResult = DialogResult.OK;
        };
        buttons.Controls.Add(cancel);
        buttons.Controls.Add(ok);
        _layout.Controls.Add(buttons);
        _layout.SetColumnSpan(buttons, 2);
        AcceptButton = ok;
        CancelButton = cancel;
        base.OnLoad(e);
    }
}
