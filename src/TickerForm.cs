using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Lenta;

/// Окно-полоса с бегущей строкой.
public class TickerForm : Form
{
    // Кусок строки: несколько «прогонов» текста разными шрифтами и цветами.
    record Run(string Text, Font Font, Color Color, Color? Badge = null);
    record Segment(List<Run> Runs, float Width, Uri? Link, string? Key, float[]? RunWidths = null);

    List<Segment> segments = new();
    float totalWidth;
    float offset;
    public float Speed = 51;          // точек (96 dpi) в секунду
    public bool Paused;
    bool hovering;
    public Action<Uri>? OnOpen;

    TickerTheme theme = TickerTheme.All[0];
    TickerSize size = TickerSize.All[1];
    int position;

    List<Headline> items = new();
    string source = "";
    string? message = "Загрузка…";
    List<Quote> quotes = new();
    int contentMode = 2;
    List<string[]> urgentRules = new();
    bool highlightUrgent = true;

    readonly Stopwatch clock = Stopwatch.StartNew();
    double flashStart = -100;
    bool IsFlashing => clock.Elapsed.TotalSeconds - flashStart < 3.2;
    static readonly Color AlertRed = Color.FromArgb(215, 25, 35);

    Font font = null!, bold = null!, timeFont = null!, badgeFont = null!;
    FrameClock? frames;
    double reassert;
    int targetFps = 60;

    /// Частота кадров (до частоты экрана: 120/144/165/240 Гц).
    public void SetFps(int fps) { targetFps = fps; if (frames != null) frames.TargetFps = fps; }

    public TickerForm()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        DoubleBuffered = true;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
        MakeFonts();
        MouseEnter += (_, _) => hovering = true;
        MouseLeave += (_, _) => { hovering = false; Cursor = Cursors.Default; };
        MouseMove += (_, e) => Cursor = LinkAt(e.X) != null ? Cursors.Hand : Cursors.Default;
        MouseClick += (_, e) => { if (e.Button == MouseButtons.Left && LinkAt(e.X) is Uri u) OnOpen?.Invoke(u); };
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= 0x80 /*TOOLWINDOW*/ | 0x08000000 /*NOACTIVATE*/ | 0x8 /*TOPMOST*/;
            return cp;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Native.timeBeginPeriod(1);        // точнее таймер — плавнее прокрутка
        frames = new FrameClock(this, dt => Tick(dt)) { TargetFps = targetFps };
        frames.Start();
    }

    float Scale96 => DeviceDpi / 96f;

    void MakeFonts()
    {
        float fs = size.FontSize;
        font = new Font("Segoe UI", fs, FontStyle.Regular);
        bold = new Font("Segoe UI", fs, FontStyle.Bold);
        timeFont = new Font("Segoe UI", fs - 1, FontStyle.Regular);
        badgeFont = new Font("Segoe UI", fs - 1.5f, FontStyle.Bold);
    }

    // MARK: Настройки

    public void ApplyLook(TickerTheme t, TickerSize s, int pos)
    {
        bool sizeChanged = s != size;
        theme = t; size = s;
        if (sizeChanged) MakeFonts();
        if (pos != position || sizeChanged || !placed) { position = pos; Place(); }
        Rebuild();
    }

    public void SetContentMode(int m) { contentMode = m; Rebuild(); }
    public void SetUrgent(List<string[]> rules, bool on) { urgentRules = rules; highlightUrgent = on; Rebuild(); }
    /// grouped — блоки по источникам с названием перед каждым; tags — метка источника у каждого заголовка.
    public void SetHeadlines(List<Headline> h, string src, bool grouped = false, bool tags = false)
    { items = h; source = src; groupBySource = grouped; sourceTags = tags; message = null; Rebuild(); }
    bool groupBySource, sourceTags;
    public void SetMessage(string m) { message = m; Rebuild(); }
    public void SetQuotes(List<Quote> q) { quotes = q; Rebuild(); }

    bool ShowNews => contentMode != 1 && message == null && items.Count > 0;
    bool ShowQuotes => contentMode != 0 && quotes.Count > 0;

    // MARK: Сборка строки

    void Rebuild()
    {
        var segs = new List<Segment>();
        if (!ShowNews && !ShowQuotes)
        {
            var msg = message ?? (contentMode == 1 ? "Загрузка котировок…" : "");
            segs.Add(new Segment(new() { new Run("   " + msg, font, Color.FromArgb(220, theme.Text)) }, 0, null, null));
            segments = segs; totalWidth = 0; offset = 0;
            Invalidate();
            return;
        }
        var muted = Color.FromArgb(185, theme.Text);
        var sepColor = Color.FromArgb(140, theme.Text);

        if (ShowQuotes)
            foreach (var q in quotes)
            {
                var runs = new List<Run>
                {
                    new(q.Symbol + (q.Kind == QuoteKind.Currency ? " ₽" : "") + " ", bold, theme.Text),
                    new(QuoteLoader.Format(q.Value), font, theme.Text),
                };
                if (q.ChangePct is double c)
                    runs.Add(new((c >= 0 ? "  ▲ +" : "  ▼ −") + Math.Abs(c).ToString("0.00", System.Globalization.CultureInfo.GetCultureInfo("ru-RU")) + "%",
                        timeFont, c >= 0 ? theme.Up : theme.Down));
                runs.Add(new("      ", font, theme.Text));
                segs.Add(Make(runs, q.Link, null));
            }

        if (ShowNews)
        {
            if (!groupBySource && !sourceTags) segs.Add(Make(new() { new("  " + source + "  ", bold, theme.Text) }, null, null));
            string? prevSource = null;
            for (int i = 0; i < items.Count; i++)
            {
                var h = items[i];
                // Блоки по источникам: название перед первым заголовком каждого источника
                if (groupBySource && h.Source != null && h.Source != prevSource)
                    segs.Add(Make(new() { new("  " + h.Source + "  ", bold, theme.Text) }, null, null));
                prevSource = h.Source;
                var runs = new List<Run>();
                if (sourceTags && h.Source != null) runs.Add(new(h.Source + "  ", bold, Color.FromArgb(220, theme.Text)));
                if (h.Date is DateTimeOffset d) runs.Add(new(d.ToLocalTime().ToString("HH:mm") + "  ", timeFont, muted));
                bool urgent = highlightUrgent && UrgentRules.Matches(h.Title, urgentRules);
                if (urgent) { runs.Add(new(" СРОЧНО ", badgeFont, Color.White, AlertRed)); runs.Add(new("  ", font, theme.Text)); }
                runs.Add(new(h.Title, urgent ? bold : font, theme.Text));
                runs.Add(new(i == items.Count - 1 ? "      " : "    •    ", font, sepColor));
                segs.Add(Make(runs, h.Link, h.Title));
            }
        }
        segments = segs;
        totalWidth = segs.Sum(s => s.Width);
        if (offset > totalWidth) offset = 0;
        Invalidate();
    }

    static readonly StringFormat Fmt = MakeFmt();
    static StringFormat MakeFmt()
    {
        var f = (StringFormat)StringFormat.GenericTypographic.Clone();
        f.FormatFlags |= StringFormatFlags.MeasureTrailingSpaces | StringFormatFlags.NoWrap;
        return f;
    }

    Segment Make(List<Run> runs, Uri? link, string? key)
    {
        using var g = CreateGraphics();
        var widths = runs.Select(r => g.MeasureString(r.Text, r.Font, 100000, Fmt).Width).ToArray();
        return new Segment(runs, (float)Math.Ceiling(widths.Sum()), link, key, widths);
    }

    // MARK: Тревога

    public void Alert(string title)
    {
        flashStart = clock.Elapsed.TotalSeconds;
        float x = 0;
        foreach (var s in segments)
        {
            if (s.Key == title) { offset = Math.Max(0, x - 12 * Scale96); break; }
            x += s.Width;
        }
        Invalidate();
    }

    // MARK: Анимация

    void Tick(double frameDt)
    {
        float dt = (float)Math.Min(frameDt, 0.05);
        if (totalWidth > 0 && !Paused && !hovering)
        {
            offset += Speed * Scale96 * dt;
            if (offset >= totalWidth) offset -= totalWidth;
            Invalidate();
        }
        else if (IsFlashing) Invalidate();

        // Не даём панели задач перекрыть строку
        reassert += frameDt;
        if (reassert > 2)
        {
            reassert = 0;
            if (Visible && !fullscreenApp) Native.SetWindowPos(Handle, Native.HWND_TOPMOST, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(theme.Background);
        if (IsFlashing)
        {
            double el = clock.Elapsed.TotalSeconds - flashStart;
            double k = (0.5 + 0.5 * Math.Sin(el * 11)) * (Math.Max(0, 1 - el / 3.2) * 0.6 + 0.4);
            using var b = new SolidBrush(Color.FromArgb((int)(230 * k), AlertRed));
            g.FillRectangle(b, ClientRectangle);
        }
        if (segments.Count == 0) return;
        g.TextRenderingHint = TextRenderingHint.AntiAlias;   // плавная субпиксельная прокрутка
        g.SmoothingMode = SmoothingMode.AntiAlias;

        float lineH = font.GetHeight(g);
        float y = (ClientSize.Height - lineH) / 2f;
        if (totalWidth <= 0) { DrawSegment(g, segments[0], 6, y); return; }

        float x = -offset;
        int i = 0;
        while (x < ClientSize.Width && i < 10000)
        {
            var s = segments[i % segments.Count];
            if (x + s.Width > 0) DrawSegment(g, s, x, y);
            x += s.Width;
            i++;
        }
    }

    void DrawSegment(Graphics g, Segment s, float x, float y)
    {
        for (int k = 0; k < s.Runs.Count; k++)
        {
            var r = s.Runs[k];
            float rw = s.RunWidths?[k] ?? g.MeasureString(r.Text, r.Font, 100000, Fmt).Width;
            float ry = y + (font.GetHeight(g) - r.Font.GetHeight(g)) / 2f;
            if (r.Badge is Color bc)
            {
                using var bb = new SolidBrush(bc);
                g.FillRectangle(bb, x, ry - 1, rw, r.Font.GetHeight(g) + 2);
            }
            using var br = new SolidBrush(r.Color);
            g.DrawString(r.Text, r.Font, br, x, ry, Fmt);
            x += rw;
        }
    }

    Uri? LinkAt(int px)
    {
        if (totalWidth <= 0) return null;
        float x = -offset;
        int i = 0;
        while (x < ClientSize.Width && i < 10000)
        {
            var s = segments[i % segments.Count];
            if (px >= x && px < x + s.Width) return s.Link;
            x += s.Width;
            i++;
        }
        return null;
    }

    // MARK: Расположение и «закреплённая панель» (AppBar)

    bool placed;
    bool appBarRegistered;
    bool fullscreenApp;
    readonly int callbackMsg = Native.RegisterWindowMessage("LentaAppBarMessage");

    public void Place()
    {
        if (!IsHandleCreated) CreateHandle();
        placed = true;
        var scr = Screen.PrimaryScreen!;
        int h = (int)Math.Round(size.Height * Scale96);

        if (Positions.IsAppBar(position))
        {
            RegisterAppBar();
            SetAppBarPos();
            return;
        }
        UnregisterAppBar();
        var b = scr.Bounds;
        Bounds = position == 2
            ? new Rectangle(b.Left, b.Top, b.Width, h)
            : new Rectangle(b.Left, b.Bottom - h, b.Width, h);
    }

    void RegisterAppBar()
    {
        if (appBarRegistered) return;
        var abd = NewAbd();
        abd.uCallbackMessage = (uint)callbackMsg;
        Native.SHAppBarMessage(Native.ABM_NEW, ref abd);
        appBarRegistered = true;
    }

    public void UnregisterAppBar()
    {
        if (!appBarRegistered) return;
        var abd = NewAbd();
        Native.SHAppBarMessage(Native.ABM_REMOVE, ref abd);
        appBarRegistered = false;
    }

    Native.APPBARDATA NewAbd() => new() { cbSize = Marshal.SizeOf<Native.APPBARDATA>(), hWnd = Handle };

    void SetAppBarPos()
    {
        var scr = Screen.PrimaryScreen!.Bounds;
        int h = (int)Math.Round(size.Height * Scale96);
        var abd = NewAbd();
        abd.uEdge = position == 0 ? Native.ABE_TOP : Native.ABE_BOTTOM;
        abd.rc = new Native.RECT { left = scr.Left, right = scr.Right, top = scr.Top, bottom = scr.Bottom };
        if (position == 0) abd.rc.bottom = abd.rc.top + h; else abd.rc.top = abd.rc.bottom - h;
        Native.SHAppBarMessage(Native.ABM_QUERYPOS, ref abd);
        if (position == 0) abd.rc.bottom = abd.rc.top + h; else abd.rc.top = abd.rc.bottom - h;
        Native.SHAppBarMessage(Native.ABM_SETPOS, ref abd);
        Bounds = new Rectangle(abd.rc.left, abd.rc.top, abd.rc.right - abd.rc.left, abd.rc.bottom - abd.rc.top);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == callbackMsg && appBarRegistered)
        {
            switch ((int)m.WParam)
            {
                case Native.ABN_POSCHANGED:
                    SetAppBarPos();
                    break;
                case Native.ABN_FULLSCREENAPP:
                    // Полноэкранное приложение (игра, видео) — уходим вниз по z-порядку.
                    fullscreenApp = m.LParam != IntPtr.Zero;
                    Native.SetWindowPos(Handle, fullscreenApp ? Native.HWND_BOTTOM : Native.HWND_TOPMOST, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
                    break;
            }
        }
        if (m.Msg == 0x02E0 /*WM_DPICHANGED*/) { base.WndProc(ref m); MakeFonts(); Place(); Rebuild(); return; }
        base.WndProc(ref m);
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        frames?.Dispose();
        UnregisterAppBar();
        Native.timeEndPeriod(1);
        base.OnFormClosed(e);
    }
}

static class Native
{
    public const uint ABM_NEW = 0, ABM_REMOVE = 1, ABM_QUERYPOS = 2, ABM_SETPOS = 3;
    public const uint ABE_TOP = 1, ABE_BOTTOM = 3;
    public const int ABN_POSCHANGED = 1, ABN_FULLSCREENAPP = 2;
    public static readonly IntPtr HWND_TOPMOST = new(-1), HWND_BOTTOM = new(1);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int left, top, right, bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct APPBARDATA
    {
        public int cbSize;
        public IntPtr hWnd;
        public uint uCallbackMessage;
        public uint uEdge;
        public RECT rc;
        public IntPtr lParam;
    }

    [DllImport("shell32.dll")] public static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int RegisterWindowMessage(string msg);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("winmm.dll")] public static extern uint timeBeginPeriod(uint p);
    [DllImport("winmm.dll")] public static extern uint timeEndPeriod(uint p);
}
