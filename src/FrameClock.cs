using System;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace Sugrob;

/// Кадры в такт с экраном (через DWM), поэтому работает и на 120/144/165/240 Гц.
/// Обычный таймер Windows Forms не умеет чаще ~64 кадров в секунду.
public sealed class FrameClock : IDisposable
{
    public static readonly int[] Values = { 0, 30, 60, 90, 120, 144, 165, 240 };

    /// Максимальная частота среди подключённых мониторов.
    public static int ScreenMax
    {
        get
        {
            int m = 0;
            foreach (var s in Screen.AllScreens)
            {
                var dm = new DEVMODE { dmSize = (short)Marshal.SizeOf<DEVMODE>() };
                if (EnumDisplaySettings(s.DeviceName, -1, ref dm)) m = Math.Max(m, dm.dmDisplayFrequency);
            }
            return m > 1 ? m : 60;
        }
    }

    public static string[] Titles
    {
        get
        {
            int max = ScreenMax;
            return Values.Select(v => v == 0 ? $"Как у экрана ({max} Гц)" : $"{v} кадров/с").ToArray();
        }
    }

    /// Итоговая частота для выбранного пункта (не выше, чем умеет экран).
    public static int Fps(int index)
    {
        int v = Values[Math.Clamp(index, 0, Values.Length - 1)], m = ScreenMax;
        return v == 0 ? m : Math.Min(v, m);
    }

    readonly Control ui;
    readonly Action<double> onFrame;
    volatile int target = 60;
    volatile bool running;

    public FrameClock(Control ui, Action<double> onFrame) { this.ui = ui; this.onFrame = onFrame; }

    public int TargetFps { get => target; set => target = Math.Max(1, value); }

    public void Start()
    {
        if (running) return;
        running = true;
        new Thread(Loop) { IsBackground = true, Name = "FrameClock", Priority = ThreadPriority.AboveNormal }.Start();
    }

    void Loop()
    {
        var sw = Stopwatch.StartNew();
        double last = sw.Elapsed.TotalSeconds, acc = 0;
        while (running)
        {
            double before = sw.Elapsed.TotalSeconds;
            // Ждём следующий кадр экрана; если DWM недоступен — короткая пауза
            if (DwmFlush() != 0 || sw.Elapsed.TotalSeconds - before < 0.0003) Thread.Sleep(1);
            double now = sw.Elapsed.TotalSeconds;
            acc += now - last;
            last = now;
            if (acc < 1.0 / target - 0.002) continue;      // ограничение частоты ниже частоты экрана
            double dt = Math.Min(acc, 0.1);
            acc = 0;
            try
            {
                if (ui.IsDisposed || !ui.IsHandleCreated) break;
                ui.Invoke(onFrame, dt);
            }
            catch { break; }
        }
    }

    public void Dispose() => running = false;

    [DllImport("dwmapi.dll")] static extern int DwmFlush();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplaySettings(string? device, int mode, ref DEVMODE dm);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DEVMODE
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
        public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }
}
