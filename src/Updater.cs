using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Sugrob;

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
            if (interactive) Offer(latest.Value);
            else if (getSkipped() != latest)
                Notify?.Invoke($"Доступна новая версия «{title}». Нажмите, чтобы обновить.", () => Offer(latest.Value));
        }
        else
        {
            Available = null;
            if (interactive) MessageBox.Show($"«{title}», сборка {CurrentBuild}.", "Установлена последняя версия");
        }
    }

    public void Offer(int build)
    {
        var r = MessageBox.Show($"Сборка {build} (у вас — {CurrentBuild}).\nПрограмма скачает её, заменит себя и перезапустится — переустанавливать вручную не нужно.",
            $"Доступна новая версия «{title}»", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
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
