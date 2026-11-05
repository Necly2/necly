using System;
using System.Threading;
using System.Windows.Forms;

namespace Lenta;

static class Program
{
    [STAThread]
    static void Main()
    {
        // Только одна копия приложения
        using var mutex = new Mutex(true, "Lenta.SingleInstance", out bool first);
        if (!first) return;
        ApplicationConfiguration.Initialize();
        Application.Run(new TrayApp());
    }
}
