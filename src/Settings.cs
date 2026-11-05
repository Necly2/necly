using System;
using System.Drawing;
using System.IO;
using System.Text.Json;
using Microsoft.Win32;

namespace Lenta;

/// Настройки, сохраняются в %APPDATA%\Lenta\settings.json.
public class AppSettings
{
    public string Source { get; set; } = "https://www.rbc.ru";
    public int Content { get; set; } = 2;          // 0 новости, 1 котировки, 2 всё вместе
    public string Stocks { get; set; } = "SBER, GAZP, LKOH, YDEX, ROSN, VTBR";
    public bool Index { get; set; } = true;
    public string Currencies { get; set; } = "USD,EUR,CNY";
    public bool UrgentOn { get; set; } = true;
    public bool UrgentSound { get; set; } = true;
    public string UrgentRulesText { get; set; } = UrgentRules.DefaultText;
    public int Position { get; set; } = 0;
    public int Size { get; set; } = 1;
    public int Theme { get; set; } = 0;
    public int Speed { get; set; } = 1;
    public int FrameRate { get; set; } = 0;        // 0 — как у экрана
    public bool Visible { get; set; } = true;
    public bool AutoUpdate { get; set; } = true;
    public int SkippedBuild { get; set; }
    public int NewsInterval { get; set; } = 1;     // индекс в TrayApp.NewsIntervals
    public int QuotesInterval { get; set; } = 1;

    static string Dir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Lenta");
    static string FilePath => Path.Combine(Dir, "settings.json");

    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(FilePath))
                return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath)) ?? new AppSettings();
        }
        catch { }
        return new AppSettings();
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Dir);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { }
    }

    // Автозапуск вместе с Windows
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

    public static bool Autostart
    {
        get
        {
            using var k = Registry.CurrentUser.OpenSubKey(RunKey);
            return k?.GetValue("Lenta") != null;
        }
        set
        {
            using var k = Registry.CurrentUser.OpenSubKey(RunKey, true) ?? Registry.CurrentUser.CreateSubKey(RunKey);
            if (value) k.SetValue("Lenta", "\"" + Environment.ProcessPath + "\"");
            else k.DeleteValue("Lenta", false);
        }
    }
}

public record TickerTheme(string Name, Color Background, Color Text, Color Up, Color Down)
{
    public static readonly TickerTheme[] All =
    {
        new("ТАСС (белый на синем)", Color.FromArgb(22, 32, 138), Color.White, Color.FromArgb(120, 240, 150), Color.FromArgb(255, 140, 140)),
        new("Белый на чёрном", Color.FromArgb(12, 12, 12), Color.White, Color.FromArgb(80, 220, 110), Color.FromArgb(255, 95, 95)),
        new("Чёрный на белом", Color.FromArgb(250, 250, 250), Color.FromArgb(15, 15, 15), Color.FromArgb(0, 130, 55), Color.FromArgb(200, 25, 25)),
        new("Белый на тёмно-зелёном", Color.FromArgb(21, 87, 54), Color.White, Color.FromArgb(170, 255, 170), Color.FromArgb(255, 160, 150)),
    };
}

public record TickerSize(string Name, float FontSize, int Height)
{
    public static readonly TickerSize[] All =
    {
        new("Компактный", 9f, 24),
        new("Обычный", 10.5f, 29),
        new("Крупный", 12.5f, 34),
    };
}

public static class Positions
{
    public static readonly string[] Titles =
    {
        "Сверху экрана (окна сдвигаются)",
        "Над панелью задач (окна сдвигаются)",
        "Сверху поверх окон",
        "Внизу поверх панели задач",
    };
    public static bool IsAppBar(int p) => p == 0 || p == 1;
}
