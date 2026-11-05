using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Lenta;

/// Автообновление с GitHub: проверяет номер последней сборки, скачивает новую версию,
/// заменяет программу и перезапускает её.
public class Updater
{
    const string Base = "https://github.com/Necly2/necly/releases/download/";
    readonly string appName, title, tag, zipName;
    readonly Func<int> getSkipped;
    readonly Action<int> setSkipped;
    readonly Action quit;
    static readonly HttpClient http = MakeClient();
    readonly System.Windows.Forms.Timer daily = new() { Interval = 24 * 3600 * 1000 };
    public int? Available { get; private set; }
    public bool Busy { get; private set; }
    public Func<bool> AutoUpdate = () => true;
    /// Показать уведомление в трее (текст, по клику — действие).
    public Action<string, Action>? Notify;

    static HttpClient MakeClient()
    {
        var c = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
        c.DefaultRequestHeaders.UserAgent.ParseAdd("Necly-updater");
        return c;
    }

    public Updater(string appName, string title, string tag, string zipName, Func<int> getSkipped, Action<int> setSkipped, Action quit)
    {
        this.appName = appName; this.title = title; this.tag = tag; this.zipName = zipName;
        this.getSkipped = getSkipped; this.setSkipped = setSkipped; this.quit = quit;
    }

    /// Номер сборки этой копии программы.
    public static int CurrentBuild => Assembly.GetExecutingAssembly().GetName().Version?.Build ?? 0;

    /// Удалить старую версию, оставшуюся после обновления.
    public static void CleanupOld()
    {
        try { var old = Environment.ProcessPath + ".old"; if (File.Exists(old)) File.Delete(old); } catch { }
    }

    public void Start()
    {
        var first = new System.Windows.Forms.Timer { Interval = 15000 };
        first.Tick += async (_, _) => { first.Stop(); first.Dispose(); if (AutoUpdate()) await Check(false); };
        first.Start();
        daily.Tick += async (_, _) => { if (AutoUpdate()) await Check(false); };
        daily.Start();
    }

    async Task<int?> LatestBuild()
    {
        try
        {
            var s = await http.GetStringAsync(Base + tag + "/version.txt?t=" + DateTime.UtcNow.Ticks);
            return int.TryParse(s.Trim(), out var n) ? n : null;
        }
        catch { return null; }
    }

    /// interactive — пользователь сам нажал «Проверить обновления».
    public async Task Check(bool interactive)
    {
        if (Busy) return;
        var latest = await LatestBuild();
        if (latest == null)
        {
            if (interactive) MessageBox.Show("Нет связи с GitHub. Попробуйте позже.", "Не удалось проверить обновления");
            return;
        }
        if (latest > CurrentBuild)
        {
            Available = latest;
            if (interactive) await OfferAsync(latest.Value);
            else if (getSkipped() != latest)
                Notify?.Invoke($"Доступна новая версия «{title}». Нажмите, чтобы обновить.", () => Offer(latest.Value));
        }
        else
        {
            Available = null;
            if (interactive) MessageBox.Show($"«{title}», сборка {CurrentBuild}.", "Установлена последняя версия");
        }
    }

    /// Ветка на GitHub, где лежит история изменений («sugrob-windows-latest» → «sugrob-windows»).
    string Branch => tag.Replace("-latest", "");

    /// Что изменилось между установленной и новой сборкой — из CHANGELOG.md, иначе из notes.txt.
    async Task<string> ChangesSummary(int build)
    {
        var parts = new System.Collections.Generic.List<string>();
        try
        {
            var log = await http.GetStringAsync($"https://raw.githubusercontent.com/Necly2/necly/{Branch}/CHANGELOG.md?t={DateTime.UtcNow.Ticks}");
            int num = -1;
            var cur = new System.Text.StringBuilder();
            void Flush() { if (num > CurrentBuild && num <= build && cur.Length > 0) parts.Add(cur.ToString().Trim()); cur.Clear(); }
            foreach (var raw in log.Split('\n'))
            {
                var line = raw.TrimEnd('\r');
                if (line.StartsWith("## "))
                {
                    Flush();
                    var digits = new string(line.SkipWhile(c => !char.IsDigit(c)).TakeWhile(char.IsDigit).ToArray());
                    num = int.TryParse(digits, out var n) ? n : 0;
                }
                else if (num >= 0 && line.Trim().Length > 0) cur.AppendLine(line);
            }
            Flush();
        }
        catch { }
        if (parts.Count == 0)
            try { parts.Add((await http.GetStringAsync(Base + tag + "/notes.txt")).Trim()); } catch { }
        var text = string.Join("\n", parts).Replace("**", "").Replace("\r", "");
        text = string.Join("\n", text.Split('\n').Select(l => l.StartsWith("- ") ? "• " + l[2..] : l));
        var lines = text.Split('\n');
        if (lines.Length > 14) text = string.Join("\n", lines.Take(14)) + "\n…и другие изменения — подробнее на GitHub.";
        return text;
    }

    public void Offer(int build) => _ = OfferAsync(build);

    async Task OfferAsync(int build)
    {
        var summary = await ChangesSummary(build);
        var msg = $"Сборка {build} (у вас — {CurrentBuild}).";
        if (summary.Length > 0) msg += "\n\nЧто нового:\n" + summary;
        msg += "\n\nПрограмма скачает обновление, заменит себя и перезапустится — переустанавливать вручную не нужно.";
        var r = MessageBox.Show(msg, $"Доступна новая версия «{title}»", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
        if (r == DialogResult.Yes) _ = Install();
        else setSkipped(build);
    }

    async Task Install()
    {
        if (Busy) return;
        Busy = true;
        string exe = Environment.ProcessPath!;
        try
        {
            var work = Path.Combine(Path.GetTempPath(), $"{appName}-update-{Guid.NewGuid():N}");
            Directory.CreateDirectory(work);
            var zip = Path.Combine(work, zipName);
            await File.WriteAllBytesAsync(zip, await http.GetByteArrayAsync(Base + tag + "/" + zipName));
            ZipFile.ExtractToDirectory(zip, work);
            var newExe = Directory.GetFiles(work, appName + ".exe", SearchOption.AllDirectories).FirstOrDefault()
                         ?? throw new Exception("в архиве нет " + appName + ".exe");
            // Работающую программу нельзя перезаписать, но можно переименовать
            var old = exe + ".old";
            if (File.Exists(old)) File.Delete(old);
            File.Move(exe, old);
            File.Move(newExe, exe);
            Process.Start(new ProcessStartInfo(exe, "--after-update") { UseShellExecute = false });
            quit();
        }
        catch (UnauthorizedAccessException)
        {
            MessageBox.Show($"Нет прав на запись в папку программы.\nПереместите {appName}.exe в свою папку (например, «Документы») и запустите оттуда.",
                "Не удалось обновить");
        }
        catch (Exception e)
        {
            MessageBox.Show("Ошибка: " + e.Message + "\nМожно скачать новую версию вручную со страницы GitHub.", "Не удалось обновить");
        }
        finally { Busy = false; }
    }
}
