using System;
using System.Drawing;
using System.Windows.Forms;

namespace Lenta;

/// Простое окно настроек: подпись слева, элемент справа, разделы.
public class SettingsForm : Form
{
    TableLayoutPanel grid = NewGrid();
    readonly FlowLayoutPanel columns = new()
    {
        FlowDirection = FlowDirection.LeftToRight, WrapContents = false, AutoSize = true,
        AutoSizeMode = AutoSizeMode.GrowAndShrink, Location = new Point(0, 0),
    };
    readonly Panel scroller = new() { Dock = DockStyle.Fill, AutoScroll = true };

    static TableLayoutPanel NewGrid()
    {
        var g = new TableLayoutPanel
        {
            ColumnCount = 2, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Padding = new Padding(18, 14, 18, 14),
        };
        g.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        g.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        return g;
    }

    public SettingsForm(string title)
    {
        Text = title;
        Font = new Font("Segoe UI", 9.5f);
        // Размер окна можно менять; если не помещается — появляется прокрутка
        FormBorderStyle = FormBorderStyle.Sizable;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        ShowIcon = false;
        MinimumSize = new Size(420, 260);
        columns.Controls.Add(grid);
        scroller.Controls.Add(columns);
        Controls.Add(scroller);
    }

    /// Начать новую колонку справа — окно получается широким, а не высоким.
    public void Column()
    {
        grid = NewGrid();
        columns.Controls.Add(grid);
    }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        var pref = columns.PreferredSize;
        var wa = Screen.FromPoint(Cursor.Position).WorkingArea;
        var extra = Size - ClientSize;
        Size = new Size(Math.Min(pref.Width + extra.Width + 4, (int)(wa.Width * 0.92)),
                        Math.Min(pref.Height + extra.Height + 4, (int)(wa.Height * 0.88)));
        CenterToScreen();
    }

    void Add(string label, Control c)
    {
        var l = new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Right, Margin = new Padding(3, 7, 8, 3) };
        c.Margin = new Padding(3, 4, 3, 4);
        c.Anchor = AnchorStyles.Left;
        grid.Controls.Add(l);
        grid.Controls.Add(c);
    }

    public void Section(string title)
    {
        var l = new Label
        {
            Text = title, AutoSize = true, Font = new Font(Font, FontStyle.Bold),
            Margin = new Padding(3, grid.Controls.Count > 0 ? 14 : 2, 3, 4),
        };
        grid.Controls.Add(l);
        grid.SetColumnSpan(l, 2);
    }

    public void Popup(string label, string[] items, int selected, Action<int> onChange)
    {
        var cb = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 300 };
        cb.Items.AddRange(items);
        if (selected >= 0 && selected < items.Length) cb.SelectedIndex = selected;
        cb.SelectedIndexChanged += (_, _) => onChange(cb.SelectedIndex);
        Add(label, cb);
    }

    public void Checkbox(string label, string text, bool on, Action<bool> onChange)
    {
        var c = new CheckBox { Text = text, Checked = on, AutoSize = true };
        c.CheckedChanged += (_, _) => onChange(c.Checked);
        Add(label, c);
    }

    public void Checkboxes(string label, (string Text, bool On)[] items, Action<int, bool> onChange)
    {
        var p = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = Padding.Empty };
        for (int i = 0; i < items.Length; i++)
        {
            int idx = i;
            var c = new CheckBox { Text = items[i].Text, Checked = items[i].On, AutoSize = true, Margin = new Padding(0, 0, 14, 0) };
            c.CheckedChanged += (_, _) => onChange(idx, c.Checked);
            p.Controls.Add(c);
        }
        Add(label, p);
    }

    public void TextField(string label, string value, string button, int width, Action<string> onCommit)
    {
        var p = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = Padding.Empty };
        var t = new TextBox { Text = value, Width = width };
        var b = new Button { Text = button, AutoSize = true };
        b.Click += (_, _) => onCommit(t.Text);
        t.KeyDown += (_, e) => { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; onCommit(t.Text); } };
        p.Controls.Add(t);
        p.Controls.Add(b);
        Add(label, p);
    }

    public void Button(string label, string text, Action action)
    {
        var b = new Button { Text = text, AutoSize = true };
        b.Click += (_, _) => action();
        Add(label, b);
    }

    public void Slider(string label, int value, int min, int max, Action<int> onChange)
    {
        var t = new TrackBar { Minimum = min, Maximum = max, Value = Math.Clamp(value, min, max), Width = 220, TickStyle = TickStyle.None };
        t.ValueChanged += (_, _) => onChange(t.Value);
        Add(label, t);
    }

    public void Note(string text)
    {
        var l = new Label { Text = text, AutoSize = true, MaximumSize = new Size(420, 0), ForeColor = SystemColors.GrayText };
        grid.Controls.Add(new Label { AutoSize = true });
        grid.Controls.Add(l);
    }
}
