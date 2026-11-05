using System;
using System.Threading;
using System.Windows.Forms;

namespace Sugrob;

static class Program
{
    [STAThread]
    static void Main()
    {
        using var mutex = new Mutex(true, "Sugrob.SingleInstance", out bool first);
        if (!first) return;
        ApplicationConfiguration.Initialize();
        Application.Run(new TrayApp());
    }
}
