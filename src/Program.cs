using System;
using System.Linq;
using System.Threading;
using System.Windows.Forms;

namespace Lenta;

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        // Только одна копия. После обновления новая копия ждёт, пока старая закроется.
        using var mutex = new Mutex(false, "Lenta.SingleInstance");
        bool got;
        try { got = mutex.WaitOne(args.Contains("--after-update") ? 15000 : 0); }
        catch (AbandonedMutexException) { got = true; }
        if (!got) return;
        try
        {
            Updater.CleanupOld();
            ApplicationConfiguration.Initialize();
            Application.Run(new TrayApp());
        }
        finally { try { mutex.ReleaseMutex(); } catch { } }
    }
}
