using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Media;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Lenta;

/// Приложение в трее: иконка, меню, загрузка новостей и котировок.
public class TrayApp : ApplicationContext
{
    readonly AppSettings s = AppSettings.Load();
    readonly TickerForm ticker = new();
    readonly NotifyIcon tray = new();
    Updater updater = null!;
    Action? balloonAction;
    readonly System.Windows.Forms.Timer newsTimer = new() { Interval = 120_000 };
    readonly System.Windows.Forms.Timer quotesTimer = new() { Interval = 60_000 };
    SettingsForm? settingsForm;

    /// Найденные ленты по каждому источнику и все заголовки — в том порядке, как они бегут.
    readonly Dictionary<string, FeedResult> feeds = new();
    List<Headline> combined = new();
    List<string> SourceList => s.Sources ??= new List<string> { s.Source };
    bool loading, loadingQuotes;
    string? lastError;
    readonly HashSet<string> seenTitles = new();

    static readonly (string Name, string Url)[] Presets =
    {
        ("РБК", "https://www.rbc.ru"), ("Коммерсантъ", "https://www.kommersant.ru"),
        ("Интерфакс", "https://www.interfax.ru"), ("Lenta.ru", "https://lenta.ru"),
        ("ТАСС", "https://tass.ru"), ("Хабр", "https://habr.com/ru/"),
    };
    static readonly Dictionary<string, string> Friendly = new()
    {
        ["rbc.ru"] = "РБК", ["kommersant.ru"] = "Коммерсантъ", ["interfax.ru"] = "Интерфакс",
        ["lenta.ru"] = "Lenta.ru", ["habr.com"] = "Хабр", ["tass.ru"] = "ТАСС",
    };
    static readonly (string Name, float Speed)[] Speeds = { ("Медленно", 30), ("Обычно", 51), ("Быстро", 81) };
    static readonly (string Name, int Seconds)[] NewsIntervals = { ("1 мин", 60), ("2 мин", 120), ("5 мин", 300), ("10 мин", 600), ("15 мин", 900), ("30 мин", 1800) };
    static readonly (string Name, int Seconds)[] QuoteIntervals = { ("30 сек", 30), ("1 мин", 60), ("2 мин", 120), ("5 мин", 300), ("15 мин", 900) };

    void ApplyIntervals()
    {
        newsTimer.Interval = NewsIntervals[Math.Clamp(s.NewsInterval, 0, NewsIntervals.Length - 1)].Seconds * 1000;
        quotesTimer.Interval = QuoteIntervals[Math.Clamp(s.QuotesInterval, 0, QuoteIntervals.Length - 1)].Seconds * 1000;
    }

    public TrayApp()
    {
        ticker.OnOpen = Open;
        ApplyAll();
        if (s.Visible) ticker.Show();

        tray.Icon = MakeIcon();
        tray.Text = "Лента";
        tray.Visible = true;
        updater = new Updater("Lenta", "Лента", "lenta-windows-latest", "Lenta-Windows.zip",
            () => s.SkippedBuild, b => { s.SkippedBuild = b; s.Save(); }, Quit)
        {
            AutoUpdate = () => s.AutoUpdate,
            Notify = (text, action) => { balloonAction = action; tray.ShowBalloonTip(8000, "Лента", text, ToolTipIcon.Info); },
        };
        tray.BalloonTipClicked += (_, _) => balloonAction?.Invoke();
        updater.Start();
        tray.ContextMenuStrip = new ContextMenuStrip();
        tray.ContextMenuStrip.Opening += (_, e) => { BuildMenu(); e.Cancel = false; };
        tray.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) OpenSettings(); };
        BuildMenu();

        ApplyIntervals();
        newsTimer.Tick += (_, _) => Refresh();
        quotesTimer.Tick += (_, _) => RefreshQuotes();
        newsTimer.Start();
        quotesTimer.Start();
        Refresh();
        RefreshQuotes();
    }

    void ApplyAll()
    {
        ticker.Speed = Speeds[Math.Clamp(s.Speed, 0, Speeds.Length - 1)].Speed;
        ticker.SetFps(FrameClock.Fps(s.FrameRate));
        ticker.SetContentMode(s.Content);
        ticker.SetUrgent(UrgentRules.Parse(s.UrgentRulesText), s.UrgentOn);
        ticker.ApplyLook(TickerTheme.All[Math.Clamp(s.Theme, 0, TickerTheme.All.Length - 1)],
                         TickerSize.All[Math.Clamp(s.Size, 0, TickerSize.All.Length - 1)], s.Position);
    }

    static void Open(Uri u)
    {
        try { Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true }); } catch { }
    }

    // MARK: Загрузка

    async void Refresh()
    {
        if (loading) return;
        var list = SourceList.Select(src => (src, ok: Uri.TryCreate(src, UriKind.Absolute, out var u), u)).Where(x => x.ok).Select(x => (x.src, x.u!)).ToList();
        if (list.Count == 0) { combined = new(); ticker.SetMessage("Выберите источник новостей в настройках"); return; }
        loading = true;
        try
        {
            // Все источники грузятся одновременно
            var tasks = list.Select(async x =>
            {
                try
                {
                    var target = feeds.TryGetValue(x.src, out var known) && known.IsRss ? known.FeedUrl : x.Item2;
                    var r = await FeedLoader.Load(target);
                    return (x.src, r: (FeedResult?)(r with { SiteName = DisplayName(x.Item2, r.SiteName) }), err: (string?)null);
                }
                catch (Exception e) { return (x.src, r: (FeedResult?)null, err: (string?)e.Message); }
            }).ToList();
            var done = await Task.WhenAll(tasks);
            var failed = new List<string>();
            foreach (var d in done)
            {
                if (d.r != null) feeds[d.src] = d.r;
                else failed.Add(Uri.TryCreate(d.src, UriKind.Absolute, out var u) ? u.Host : d.src);
            }
            lastError = failed.Count == 0 ? null : "Не загрузились: " + string.Join(", ", failed);
            ApplyFeeds();
        }
        finally { loading = false; }
    }

    /// Собрать строку из всех включённых источников.
    void ApplyFeeds()
    {
        var active = SourceList.Where(feeds.ContainsKey).Select(k => feeds[k]).ToList();
        if (active.Count == 0)
        {
            combined = new();
            var first = SourceList.FirstOrDefault();
            if (first != null) ticker.SetMessage("Не удалось получить заголовки с " + (Uri.TryCreate(first, UriKind.Absolute, out var u) ? u.Host : first));
            return;
        }
        if (active.Count == 1)
        {
            combined = active[0].Items;
            ticker.SetHeadlines(combined, active[0].SiteName);
        }
        else
        {
            // Не больше 25 заголовков с каждого источника — чтобы никто не забивал остальных
            var tagged = active.SelectMany(f => f.Items.Take(25).Select(h => h with { Source = f.SiteName })).ToList();
            if (s.MixOrder == 0)
            {
                combined = tagged.OrderByDescending(h => h.Date ?? DateTimeOffset.MinValue).ToList();
                ticker.SetHeadlines(combined, "", tags: true);
            }
            else
            {
                combined = tagged;
                ticker.SetHeadlines(combined, "", grouped: true);
            }
        }
        DetectUrgent(combined);
    }

    static string DisplayName(Uri url, string fallback)
    {
        var host = url.Host.Replace("www.", "");
        foreach (var kv in Friendly) if (host == kv.Key || host.EndsWith("." + kv.Key)) return kv.Value;
        return fallback;
    }

    static string? Normalize(string str)
    {
        str = str.Trim();
        if (str.Length == 0) return null;
        if (!str.StartsWith("http", StringComparison.OrdinalIgnoreCase)) str = "https://" + str;
        return Uri.TryCreate(str, UriKind.Absolute, out var u) && u.Host.Length > 0 ? str : null;
    }

    void SetSources(IEnumerable<string> list)
    {
        s.Sources = list.Distinct().ToList(); s.Save();
        foreach (var k in feeds.Keys.Where(k => !s.Sources.Contains(k)).ToList()) feeds.Remove(k);
        if (combined.Count == 0) ticker.SetMessage("Загрузка заголовков…");
        Refresh();
    }

    List<string> CustomSources => SourceList.Where(src => !Presets.Any(p => p.Url == src)).ToList();

    List<string> StockList => s.Stocks.ToUpperInvariant().Split(new[] { ',', ' ', ';' }, StringSplitOptions.RemoveEmptyEntries).ToList();
    List<string> CurrencyList => s.Currencies.Split(',', StringSplitOptions.RemoveEmptyEntries).ToList();

    async void RefreshQuotes()
    {
        if (s.Content == 0 || loadingQuotes) return;
        loadingQuotes = true;
        try
        {
            var q = await QuoteLoader.Load(StockList, s.Index, CurrencyList);
            if (q.Count > 0 || (StockList.Count == 0 && CurrencyList.Count == 0 && !s.Index)) ticker.SetQuotes(q);
        }
        catch { }
        finally { loadingQuotes = false; }
    }

    // MARK: Срочные новости

    void DetectUrgent(List<Headline> items)
    {
        try
        {
            if (!s.UrgentOn || s.Content == 1) return;
            var rules = UrgentRules.Parse(s.UrgentRulesText);
            var now = DateTimeOffset.Now;
            bool first = seenTitles.Count == 0;
            Headline? newest = null;
            foreach (var h in items)
            {
                if (seenTitles.Contains(h.Title) || !UrgentRules.Matches(h.Title, rules)) continue;
                double age = h.Date is DateTimeOffset d ? (now - d).TotalSeconds : 0;
                if (age > (first ? 1800 : 3600)) continue;
                if (newest == null || (h.Date ?? now) > (newest.Date ?? now)) newest = h;
            }
            if (newest != null) TriggerAlert(newest.Title);
        }
        finally { foreach (var h in items) seenTitles.Add(h.Title); }
    }

    void TriggerAlert(string title)
    {
        ticker.Alert(title);
        if (s.UrgentSound) SystemSounds.Exclamation.Play();
    }

    // MARK: Меню в трее

    void BuildMenu()
    {
        var m = tray.ContextMenuStrip!;
        m.Items.Clear();
        var names = SourceList.Select(src => feeds.TryGetValue(src, out var f) ? f.SiteName : Uri.TryCreate(src, UriKind.Absolute, out var u) ? u.Host : src).ToList();
        var status = (names.Count == 1 ? "Источник: " : "Источники: ") + string.Join(", ", names) + (combined.Count > 0 ? $" · {combined.Count} загол." : "");
        m.Items.Add(new ToolStripMenuItem(status) { Enabled = false });
        if (lastError != null) m.Items.Add(new ToolStripMenuItem("⚠ " + lastError) { Enabled = false });

        if (combined.Count > 0)
        {
            var latest = new ToolStripMenuItem("Последние заголовки");
            var rules = UrgentRules.Parse(s.UrgentRulesText);
            foreach (var h in combined.Take(15))
            {
                var t = h.Title.Length > 90 ? h.Title[..88] + "…" : h.Title;
                if (h.Source != null) t = h.Source + ": " + t;
                if (UrgentRules.Matches(h.Title, rules)) t = "⚡ " + t;
                var it = new ToolStripMenuItem(t) { Enabled = h.Link != null };
                var link = h.Link;
                it.Click += (_, _) => { if (link != null) Open(link); };
                latest.DropDownItems.Add(it);
            }
            m.Items.Add(latest);
        }
        m.Items.Add("Обновить сейчас", null, (_, _) => { Refresh(); RefreshQuotes(); });
        var pause = new ToolStripMenuItem("Пауза") { Checked = ticker.Paused };
        pause.Click += (_, _) => ticker.Paused = !ticker.Paused;
        m.Items.Add(pause);
        m.Items.Add(new ToolStripSeparator());
        if (updater.Available is int b) m.Items.Add($"⬆ Обновить до сборки {b}…", null, (_, _) => updater.Offer(b));
        m.Items.Add("Проверить обновления…", null, async (_, _) => await updater.Check(true));
        m.Items.Add("Настройки…", null, (_, _) => OpenSettings());
        m.Items.Add("Выйти", null, (_, _) => Quit());
    }

    void Quit()
    {
        tray.Visible = false;
        ticker.UnregisterAppBar();
        ticker.Close();
        ExitThread();
    }

    // MARK: Окно настроек

    void OpenSettings()
    {
        if (settingsForm != null && !settingsForm.IsDisposed)
        {
            settingsForm.Close();
        }
        var w = new SettingsForm("Лента — настройки");

        w.Section("Содержимое");
        w.Popup("Показывать:", new[] { "Новости", "Котировки", "Котировки и новости" }, s.Content, i =>
        {
            s.Content = i; s.Save(); ticker.SetContentMode(i); RefreshQuotes();
        });

        w.Section("Новости");
        // Можно включить несколько источников сразу
        var current = new HashSet<string>(SourceList);
        void TogglePreset(int idx, bool on)
        {
            var url = Presets[idx].Url;
            var list = SourceList.Where(x => x != url).ToList();
            if (on) list.Add(url);
            var order = Presets.Select(p => p.Url).ToList();
            SetSources(list.OrderBy(x => order.IndexOf(x) is int k && k >= 0 ? k : 99));
        }
        w.Checkboxes("Источники:", Presets.Take(3).Select(p => (p.Name, current.Contains(p.Url))).ToArray(), (k, on) => TogglePreset(k, on));
        w.Checkboxes("", Presets.Skip(3).Select(p => (p.Name, current.Contains(p.Url))).ToArray(), (k, on) => TogglePreset(k + 3, on));
        w.TextField("Свои сайты:", string.Join(", ", CustomSources), "Применить", 300, v =>
        {
            var custom = v.Split(new[] { ',', ';', ' ', '\n' }, StringSplitOptions.RemoveEmptyEntries).Select(Normalize).Where(x => x != null).Select(x => x!);
            SetSources(SourceList.Where(x => Presets.Any(p => p.Url == x)).Concat(custom));
        });
        w.Popup("Порядок:", new[] { "По времени — вперемешку", "По источникам — блоками" }, s.MixOrder, k => { s.MixOrder = k; s.Save(); ApplyFeeds(); });
        w.Note("Можно включить сколько угодно источников: строка соберёт их вместе. «По времени» — свежие заголовки первыми, у каждого метка источника. Для своих сайтов подойдёт адрес сайта или прямая ссылка на RSS.");

        w.Section("Срочные новости");
        w.Checkbox("", "Выделять срочные и мигать строкой", s.UrgentOn, on =>
        {
            s.UrgentOn = on; s.Save(); ticker.SetUrgent(UrgentRules.Parse(s.UrgentRulesText), on);
        });
        w.Checkbox("", "Звуковой сигнал", s.UrgentSound, on => { s.UrgentSound = on; s.Save(); });
        w.TextField("Слова:", s.UrgentRulesText, "Применить", 420, v =>
        {
            s.UrgentRulesText = v; s.Save(); ticker.SetUrgent(UrgentRules.Parse(v), s.UrgentOn);
        });
        w.Note("Через запятую. Достаточно начала слова: «эвакуац» найдёт «эвакуация». «+» — должны встретиться все части: «ключев+ставк».");
        w.Button("", "Вернуть слова по умолчанию", () =>
        {
            s.UrgentRulesText = UrgentRules.DefaultText; s.Save();
            ticker.SetUrgent(UrgentRules.Parse(s.UrgentRulesText), s.UrgentOn);
            w.BeginInvoke(new Action(OpenSettings));
        });
        w.Button("", "Показать, как выглядит тревога", () =>
        {
            if (combined.FirstOrDefault() is Headline h) TriggerAlert(h.Title);
        });

        w.Column();     // вторая колонка — окно широкое, а не высокое
        w.Section("Котировки");
        w.TextField("Акции (тикеры):", s.Stocks, "Применить", 300, v => { s.Stocks = v; s.Save(); RefreshQuotes(); });
        w.Checkbox("Индекс:", "Индекс Мосбиржи (IMOEX)", s.Index, on => { s.Index = on; s.Save(); RefreshQuotes(); });
        var allCur = new[] { "USD", "EUR", "CNY" };
        w.Checkboxes("Курсы ЦБ:", allCur.Select(c => (c, CurrencyList.Contains(c))).ToArray(), (i, on) =>
        {
            var set = new HashSet<string>(CurrencyList);
            if (on) set.Add(allCur[i]); else set.Remove(allCur[i]);
            s.Currencies = string.Join(",", allCur.Where(set.Contains)); s.Save(); RefreshQuotes();
        });
        w.Note("Акции и индекс — Московская биржа. Валюты — официальный курс ЦБ на сегодня.");

        w.Section("Обновление");
        w.Popup("Новости:", NewsIntervals.Select(x => "каждые " + x.Name).ToArray(), s.NewsInterval, i => { s.NewsInterval = i; s.Save(); ApplyIntervals(); });
        w.Popup("Котировки:", QuoteIntervals.Select(x => "каждые " + x.Name).ToArray(), s.QuotesInterval, i => { s.QuotesInterval = i; s.Save(); ApplyIntervals(); });

        w.Section("Вид");
        w.Popup("Расположение:", Positions.Titles, s.Position, i => { s.Position = i; s.Save(); ApplyAll(); });
        w.Popup("Размер:", TickerSize.All.Select(x => x.Name).ToArray(), s.Size, i => { s.Size = i; s.Save(); ApplyAll(); });
        w.Popup("Цвета:", TickerTheme.All.Select(x => x.Name).ToArray(), s.Theme, i => { s.Theme = i; s.Save(); ApplyAll(); });
        w.Popup("Частота кадров:", FrameClock.Titles, s.FrameRate, i => { s.FrameRate = i; s.Save(); ApplyAll(); });
        w.Popup("Скорость:", Speeds.Select(x => x.Name).ToArray(), s.Speed, i => { s.Speed = i; s.Save(); ApplyAll(); });
        w.Checkbox("", "Показывать строку", s.Visible, on =>
        {
            s.Visible = on; s.Save();
            if (on) { ticker.Show(); ApplyAll(); } else { ticker.UnregisterAppBar(); ticker.Hide(); }
        });
        w.Checkbox("", "Запускать вместе с Windows", AppSettings.Autostart, on => AppSettings.Autostart = on);

        w.Section("Обновления");
        w.Checkbox("", "Проверять обновления автоматически (раз в день)", s.AutoUpdate, on => { s.AutoUpdate = on; s.Save(); });
        w.Button("", "Проверить сейчас", async () => await updater.Check(true));
        w.Note($"Установлена сборка {Updater.CurrentBuild}. Новая версия скачивается с GitHub и ставится сама — с перезапуском.");

        settingsForm = w;
        w.Show();
        w.Activate();
    }

    /// Иконка в трее: синий квадрат ТАСС с «строками».
    static Icon MakeIcon()
    {
        var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using var path = new GraphicsPath();
            path.AddArc(1, 1, 10, 10, 180, 90); path.AddArc(21, 1, 10, 10, 270, 90);
            path.AddArc(21, 21, 10, 10, 0, 90); path.AddArc(1, 21, 10, 10, 90, 90);
            path.CloseFigure();
            using var bg = new SolidBrush(Color.FromArgb(22, 32, 138));
            g.FillPath(bg, path);
            using var pen = new Pen(Color.White, 3) { StartCap = LineCap.Round, EndCap = LineCap.Round };
            g.DrawLine(pen, 8, 10, 24, 10);
            g.DrawLine(pen, 8, 16, 24, 16);
            g.DrawLine(pen, 8, 22, 18, 22);
        }
        return Icon.FromHandle(bmp.GetHicon());
    }
}
