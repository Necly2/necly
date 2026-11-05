using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Sugrob;

/// Настройки, сохраняются в %APPDATA%\Sugrob\settings.json.
public class AppSettings
{
    public bool Snowing { get; set; } = true;
    public int Level { get; set; } = 1;
    public bool FastPiles { get; set; }
    public bool Taskbar { get; set; } = true;
    public bool Behind { get; set; }
    public bool Garland { get; set; } = true;
    public bool GTaskbar { get; set; } = true;
    public bool GTop { get; set; }
    public bool GWindows { get; set; }
    public int GMode { get; set; }
    public int GPalette { get; set; }
    public int GBright { get; set; } = 90;
    public string Word { get; set; } = "СЕРГЕЙ";
    public int Fps { get; set; } = 1;              // 0 — 30 кадров, 1 — 60 кадров

    static string Dir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Sugrob");
    static string FilePath => Path.Combine(Dir, "settings.json");

    public static AppSettings Load()
    {
        try { if (File.Exists(FilePath)) return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath)) ?? new(); }
        catch { }
        return new();
    }

    public void Save()
    {
        try { Directory.CreateDirectory(Dir); File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true })); }
        catch { }
    }

    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    public static bool Autostart
    {
        get { using var k = Registry.CurrentUser.OpenSubKey(RunKey); return k?.GetValue("Sugrob") != null; }
        set
        {
            using var k = Registry.CurrentUser.OpenSubKey(RunKey, true) ?? Registry.CurrentUser.CreateSubKey(RunKey);
            if (value) k.SetValue("Sugrob", "\"" + Environment.ProcessPath + "\""); else k.DeleteValue("Sugrob", false);
        }
    }
}

/// Приложение в трее: оверлеи на всех экранах, цикл кадров, меню и настройки.
public class TrayApp : ApplicationContext
{
    readonly AppSettings s = AppSettings.Load();
    readonly WinDesktop desk = new();
    readonly Engine engine;
    readonly Renderer renderer;
    readonly List<Overlay> overlays = new();
    readonly NotifyIcon tray = new();
    readonly System.Windows.Forms.Timer timer = new() { Interval = 15 };
    readonly Stopwatch clock = Stopwatch.StartNew();
    double last, frameAcc;
    int topAcc;
    bool paused;
    SettingsForm? settingsForm;

    static readonly (string Name, float Value)[] Levels = { ("Лёгкий снег", 2), ("Снегопад", 4.5f), ("Метель", 10) };

    public TrayApp()
    {
        float scale = W.GetDpiForSystem() / 96f;
        bool win11 = Environment.OSVersion.Version.Build >= 22000;
        engine = new Engine(desk, scale, win11 ? 8 * scale : 0);
        renderer = new Renderer(engine);
        Apply();
        BuildOverlays();
        SystemEvents.DisplaySettingsChanged += (_, _) => BuildOverlays();

        tray.Icon = MakeIcon();
        tray.Text = "Сугроб";
        tray.Visible = true;
        tray.ContextMenuStrip = new ContextMenuStrip();
        tray.ContextMenuStrip.Opening += (_, _) => BuildMenu();
        tray.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) OpenSettings(); };
        BuildMenu();

        W.timeBeginPeriod(1);
        timer.Tick += (_, _) => Tick();
        timer.Start();
    }

    void Apply()
    {
        engine.Snowing = s.Snowing;
        engine.Intensity = Levels[Math.Clamp(s.Level, 0, Levels.Length - 1)].Value;
        engine.FastPiles = s.FastPiles;
        engine.TaskbarEnabled = s.Taskbar;
        engine.SnowBehindWindows = s.Behind;
        engine.Garland = new GarlandSettings
        {
            Enabled = s.Garland, OnTaskbar = s.GTaskbar, OnTop = s.GTop, OnWindows = s.GWindows,
            Mode = s.GMode, Palette = s.GPalette, Brightness = s.GBright / 100f,
        };
    }

    void BuildOverlays()
    {
        foreach (var o in overlays) { o.Close(); o.Dispose(); }
        overlays.Clear();
        foreach (var sc in Screen.AllScreens)
        {
            var o = new Overlay(sc.Bounds);
            o.Show();
            overlays.Add(o);
        }
        engine.ScreensChanged();
    }

    void Tick()
    {
        double now = clock.Elapsed.TotalSeconds;
        frameAcc += now - last;
        last = now;
        // 30 кадров — копим время и рисуем реже
        if (s.Fps == 0 && frameAcc < 1 / 31.0) return;
        double dt = frameAcc;
        frameAcc = 0;
        if (paused) return;

        engine.Step(dt);
        foreach (var o in overlays)
        {
            if (WinDesktop.FullscreenOn(o.ScreenRect)) { o.Render((_, _) => { }); continue; }
            o.Render(renderer.Draw);
        }
        // Раз в 2 секунды снова поднимаемся над панелью задач
        if (++topAcc > 120) { topAcc = 0; foreach (var o in overlays) o.BringToTop(); }
    }

    void BuildMenu()
    {
        var m = tray.ContextMenuStrip!;
        m.Items.Clear();
        m.Items.Add("Сюрприз 🚀", null, (_, _) => Surprise());
        m.Items.Add("Стряхнуть весь снег", null, (_, _) => engine.ShakeAll());
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(paused ? "Продолжить" : "Пауза", null, (_, _) => TogglePause());
        m.Items.Add("Настройки…", null, (_, _) => OpenSettings());
        m.Items.Add("Выйти", null, (_, _) => Quit());
    }

    void Surprise()
    {
        if (paused) TogglePause();
        var sc = Screen.PrimaryScreen!.Bounds;
        float fontPx = Math.Min(sc.Width * 0.14f, 230 * engine.S);
        engine.LaunchSurprise(Renderer.TextPoints(string.IsNullOrWhiteSpace(s.Word) ? "СЕРГЕЙ" : s.Word.Trim(), fontPx, 2200));
    }

    void TogglePause()
    {
        paused = !paused;
        if (paused) foreach (var o in overlays) o.Render((_, _) => { });
        last = clock.Elapsed.TotalSeconds;
    }

    void Quit()
    {
        timer.Stop();
        tray.Visible = false;
        foreach (var o in overlays) o.Close();
        W.timeEndPeriod(1);
        ExitThread();
    }

    void Save() { s.Save(); Apply(); }

    void OpenSettings()
    {
        if (settingsForm != null && !settingsForm.IsDisposed) settingsForm.Close();
        var w = new SettingsForm("Сугроб — настройки");

        w.Section("Снег");
        w.Checkbox("", "Снег идёт", s.Snowing, on => { s.Snowing = on; Save(); });
        w.Popup("Интенсивность:", Levels.Select(l => l.Name).ToArray(), s.Level, i => { s.Level = i; Save(); });
        w.Checkbox("", "Быстрые сугробы (копятся в 5 раз быстрее)", s.FastPiles, on => { s.FastPiles = on; Save(); });
        w.Checkbox("", "Снег на панели задач", s.Taskbar, on => { s.Taskbar = on; Save(); });
        w.Checkbox("", "Снег за окнами (падает только над рабочим столом)", s.Behind, on => { s.Behind = on; Save(); });

        w.Section("Гирлянда");
        w.Checkbox("", "Включить гирлянду", s.Garland, on => { s.Garland = on; Save(); });
        w.Checkboxes("Где:", new[] { ("Панель задач", s.GTaskbar), ("Верх экрана", s.GTop), ("Окна", s.GWindows) }, (i, on) =>
        {
            if (i == 0) s.GTaskbar = on; else if (i == 1) s.GTop = on; else s.GWindows = on;
            Save();
        });
        w.Popup("Режим:", GarlandSettings.Modes, s.GMode, i => { s.GMode = i; Save(); });
        w.Popup("Цвета:", GarlandSettings.Palettes.Select(p => p.Name).ToArray(), s.GPalette, i => { s.GPalette = i; Save(); });
        w.Slider("Яркость:", s.GBright, 30, 100, v => { s.GBright = v; Save(); });

        w.Section("Сюрприз");
        w.TextField("Слово:", s.Word, "Сохранить", 200, v => { s.Word = v; Save(); });
        w.Button("", "Запустить сюрприз 🚀", Surprise);

        w.Section("Прочее");
        w.Popup("Плавность:", new[] { "30 кадров/с (меньше нагрузка)", "60 кадров/с" }, s.Fps, i => { s.Fps = i; Save(); });
        w.Checkbox("", "Запускать вместе с Windows", AppSettings.Autostart, on => AppSettings.Autostart = on);

        settingsForm = w;
        w.Show();
        w.Activate();
    }

    /// Иконка в трее — снежинка.
    static Icon MakeIcon()
    {
        var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using var bg = new SolidBrush(Color.FromArgb(40, 110, 200));
            g.FillEllipse(bg, 1, 1, 30, 30);
            using var pen = new Pen(Color.White, 2.4f) { StartCap = LineCap.Round, EndCap = LineCap.Round };
            for (int k = 0; k < 3; k++)
            {
                double a = k * Math.PI / 3;
                float dx = (float)Math.Cos(a) * 10, dy = (float)Math.Sin(a) * 10;
                g.DrawLine(pen, 16 - dx, 16 - dy, 16 + dx, 16 + dy);
            }
        }
        return Icon.FromHandle(bmp.GetHicon());
    }
}
