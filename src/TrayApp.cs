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
    public int Level { get; set; } = 1;            // старая шкала из 3 уровней
    public int SnowLevel { get; set; } = -1;       // новая шкала из 5 уровней
    public bool FastPiles { get; set; }
    public bool Taskbar { get; set; } = true;
    public bool Behind { get; set; }
    public bool Garland { get; set; }
    public bool GTaskbar { get; set; } = true;
    public bool GTop { get; set; }
    public bool GWindows { get; set; }
    public int GMode { get; set; }
    public int GPalette { get; set; }
    public int GBright { get; set; } = 90;
    public int Fps { get; set; } = 1;              // старая настройка 30/60
    public int FrameRate { get; set; } = -1;       // индекс в FrameClock.Values
    public bool AutoUpdate { get; set; } = true;
    public int SkippedBuild { get; set; }
    public int WeatherMode { get; set; }
    public string City { get; set; } = "Москва";
    public double CityLat { get; set; } = 55.75;
    public double CityLon { get; set; } = 37.62;
    public bool Snowman { get; set; }
    public int SnowmanLife { get; set; }
    public int SnowmanStyle { get; set; }
    public int SnowmanMax { get; set; } = 1;
    public List<double[]> Snowmen { get; set; } = new();

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
    Updater updater = null!;
    Action? balloonAction;
    FrameClock clock = null!;
    readonly Control marshal = new();
    readonly System.Windows.Forms.Timer weatherTimer = new() { Interval = 15 * 60 * 1000 };
    string? weatherError;
    double topAcc;
    bool paused;
    SettingsForm? settingsForm;

    static readonly (string Name, float Value)[] Levels =
        { ("Почти не идёт", 0.25f), ("Редкие снежинки", 0.8f), ("Лёгкий снег", 2), ("Снегопад", 4.5f), ("Метель", 10) };

    public TrayApp()
    {
        // Перенос старых настроек: было 3 уровня снега и «30/60 кадров»
        if (s.SnowLevel < 0) s.SnowLevel = Math.Clamp(s.Level + 2, 0, 4);
        if (s.FrameRate < 0) s.FrameRate = s.Fps == 0 ? 1 : 2;
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
        updater = new Updater("Sugrob", "Сугроб", "sugrob-windows-latest", "Sugrob-Windows.zip",
            () => s.SkippedBuild, b => { s.SkippedBuild = b; s.Save(); }, Quit)
        {
            AutoUpdate = () => s.AutoUpdate,
            Notify = (text, action) => { balloonAction = action; tray.ShowBalloonTip(8000, "Сугроб", text, ToolTipIcon.Info); },
        };
        tray.BalloonTipClicked += (_, _) => balloonAction?.Invoke();
        updater.Start();
        tray.ContextMenuStrip = new ContextMenuStrip();
        tray.ContextMenuStrip.Opening += (_, _) => BuildMenu();
        tray.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) OpenSettings(); };
        BuildMenu();

        // Сохранённые снеговики
        if (s.SnowmanLife != 3)
            engine.Snowmen = s.Snowmen.Where(a => a.Length == 2)
                .Select(a => new Snowman { XFromCenter = (float)a[0] * engine.S, Created = DateTime.FromBinary((long)a[1]), Build = 1 }).ToList();
        engine.OnSnowmenChanged = SaveSnowmen;

        W.timeBeginPeriod(1);
        marshal.CreateControl();
        clock = new FrameClock(marshal, Tick) { TargetFps = FrameClock.Fps(s.FrameRate) };
        clock.Start();
        weatherTimer.Tick += (_, _) => RefreshWeather();
        weatherTimer.Start();
        RefreshWeather();
    }

    // MARK: Погода и снеговики

    void SaveSnowmen()
    {
        s.Snowmen = engine.Snowmen.Select(sm => new[] { sm.XFromCenter / engine.S, (double)sm.Created.ToBinary() }).ToList();
        s.Save();
    }

    bool NeedsWeather => s.WeatherMode == 1 || s.SnowmanLife == 1;

    async void RefreshWeather()
    {
        if (!NeedsWeather) return;
        var w = await WeatherService.Current(s.CityLat, s.CityLon);
        if (w != null) { engine.Weather = w; weatherError = null; }
        else weatherError = "Не удалось получить погоду";
    }

    async void SetCity(string name)
    {
        name = name.Trim();
        if (name.Length == 0) return;
        var g = await WeatherService.Geocode(name);
        if (g is var (n, lat, lon))
        {
            s.City = n; s.CityLat = lat; s.CityLon = lon; s.Save();
            engine.Weather = null;
            RefreshWeather();
        }
        else weatherError = $"Город «{name}» не найден";
        if (settingsForm != null && !settingsForm.IsDisposed) OpenSettings();
    }

    string WeatherLine => engine.Weather is WeatherNow w ? $"{s.City}: {w.TempText}, {w.Description}" : weatherError ?? $"{s.City}: погода загружается…";

    void Apply()
    {
        engine.Snowing = s.Snowing;
        engine.Intensity = Levels[Math.Clamp(s.SnowLevel, 0, Levels.Length - 1)].Value;
        if (clock != null) clock.TargetFps = FrameClock.Fps(s.FrameRate);
        engine.FastPiles = s.FastPiles;
        engine.TaskbarEnabled = s.Taskbar;
        engine.SnowBehindWindows = s.Behind;
        engine.WeatherMode = s.WeatherMode;
        engine.SnowmanEnabled = s.Snowman;
        engine.SnowmanLifetime = s.SnowmanLife;
        engine.SnowmanStyle = s.SnowmanStyle;
        engine.MaxSnowmen = Engine.SnowmanCounts[Math.Clamp(s.SnowmanMax, 0, 2)];
        while (engine.Snowmen.Count > engine.MaxSnowmen) engine.Snowmen.RemoveAt(0);
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

    void Tick(double dt)
    {
        if (paused) return;
        engine.Step(dt);
        foreach (var o in overlays)
        {
            if (WinDesktop.FullscreenOn(o.ScreenRect)) { o.Render((_, _) => { }); continue; }
            o.Render(renderer.Draw);
        }
        // Раз в 2 секунды снова поднимаемся над панелью задач
        topAcc += dt;
        if (topAcc > 2) { topAcc = 0; foreach (var o in overlays) o.BringToTop(); }
    }

    void BuildMenu()
    {
        var m = tray.ContextMenuStrip!;
        m.Items.Clear();
        if (NeedsWeather)
        {
            m.Items.Add(new ToolStripMenuItem(WeatherLine) { Enabled = false });
            m.Items.Add(new ToolStripSeparator());
        }
        m.Items.Add("Стряхнуть весь снег", null, (_, _) => engine.ShakeAll());
        m.Items.Add(new ToolStripSeparator());
        m.Items.Add(paused ? "Продолжить" : "Пауза", null, (_, _) => TogglePause());
        if (updater.Available is int b) m.Items.Add($"⬆ Обновить до сборки {b}…", null, (_, _) => updater.Offer(b));
        m.Items.Add("Проверить обновления…", null, async (_, _) => await updater.Check(true));
        m.Items.Add("Настройки…", null, (_, _) => OpenSettings());
        m.Items.Add("Выйти", null, (_, _) => Quit());
    }

    void TogglePause()
    {
        paused = !paused;
        if (paused) foreach (var o in overlays) o.Render((_, _) => { });
    }

    void Quit()
    {
        clock.Dispose();
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
        w.Popup("Интенсивность:", Levels.Select(l => l.Name).ToArray(), s.SnowLevel, i => { s.SnowLevel = i; Save(); });
        w.Checkbox("", "Быстрые сугробы (копятся в 5 раз быстрее)", s.FastPiles, on => { s.FastPiles = on; Save(); });
        w.Checkbox("", "Снег на панели задач", s.Taskbar, on => { s.Taskbar = on; Save(); });
        w.Checkbox("", "Снег за окнами (падает только над рабочим столом)", s.Behind, on => { s.Behind = on; Save(); });

        w.Section("Погода");
        w.Popup("Что показывать:", Engine.WeatherModes, s.WeatherMode, i => { s.WeatherMode = i; Save(); RefreshWeather(); });
        w.TextField("Город:", s.City, "Применить", 180, SetCity);
        w.Note(WeatherLine + ". По погоде: снег — идёт снег, дождь — капли и сугробы тают, ясная морозная ночь — иней на краях окон. Обновление раз в 15 минут.");

        w.Column();
        w.Section("Снеговик");
        w.Checkbox("", "Лепить снеговика из кучи снега на панели задач", s.Snowman, on => { s.Snowman = on; Save(); });
        w.Popup("Сколько стоит:", Engine.SnowmanLifetimes, s.SnowmanLife, i => { s.SnowmanLife = i; Save(); RefreshWeather(); });
        w.Popup("Наряд:", Engine.SnowmanStyles, s.SnowmanStyle, i => { s.SnowmanStyle = i; Save(); });
        w.Popup("Сколько может быть:", Engine.SnowmanCounts.Select(c => "до " + c).ToArray(), s.SnowmanMax, i => { s.SnowmanMax = i; Save(); SaveSnowmen(); });
        w.Button("", "Слепить снеговика сейчас", () => engine.BuildSnowmanNow());
        w.Button("", "Убрать всех снеговиков", () => engine.RemoveAllSnowmen());
        w.Note("Ведите курсором по снегу на панели задач в одну сторону: снег сгребается в кучу, и когда она станет большой — из неё вырастет снеговик.");

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

        w.Section("Прочее");
        w.Popup("Частота кадров:", FrameClock.Titles, s.FrameRate, i => { s.FrameRate = i; Save(); });
        w.Note($"Ваш экран: до {FrameClock.ScreenMax} Гц. Больше кадров — плавнее снег, но выше нагрузка; 30–60 — экономно.");
        w.Checkbox("", "Запускать вместе с Windows", AppSettings.Autostart, on => AppSettings.Autostart = on);

        w.Section("Обновления");
        w.Checkbox("", "Проверять обновления автоматически (раз в день)", s.AutoUpdate, on => { s.AutoUpdate = on; s.Save(); });
        w.Button("", "Проверить сейчас", async () => await updater.Check(true));
        w.Note($"Установлена сборка {Updater.CurrentBuild}. Новая версия скачивается с GitHub и ставится сама — с перезапуском.");

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
