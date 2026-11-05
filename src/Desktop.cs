using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace Sugrob;

/// Окна, панель задач и курсор — через функции Windows.
public class WinDesktop : IDesktop
{
    readonly uint ownPid = (uint)Environment.ProcessId;

    static readonly HashSet<string> SkipClasses = new()
    {
        "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow",
        "NotifyIconOverflowWindow", "TopLevelWindowForOverflowXamlIsland", "XamlExplorerHostIslandWindow",
        "MultitaskingViewFrame", "ForegroundStaging", "TaskSwitcherWnd", "Windows.Internal.Shell.TabProxyWindow",
    };
    static readonly HashSet<string> TransitionClasses = new()
    {
        "MultitaskingViewFrame", "XamlExplorerHostIslandWindow", "ForegroundStaging", "TaskSwitcherWnd",
    };

    public List<WinInfo> Windows()
    {
        var list = new List<WinInfo>();
        W.EnumWindows((h, _) =>
        {
            if (Accept(h, out var r)) list.Add(new WinInfo(h.ToInt64(), r));
            return true;
        }, IntPtr.Zero);
        return list;   // EnumWindows отдаёт окна спереди назад
    }

    bool Accept(IntPtr h, out RectangleF r)
    {
        r = default;
        if (!W.IsWindowVisible(h) || W.IsIconic(h)) return false;
        W.GetWindowThreadProcessId(h, out uint pid);
        if (pid == ownPid) return false;
        long ex = W.GetWindowLongPtr(h, W.GWL_EXSTYLE).ToInt64();
        if ((ex & W.WS_EX_TOOLWINDOW) != 0 && (ex & W.WS_EX_APPWINDOW) == 0) return false;
        if ((ex & W.WS_EX_NOACTIVATE) != 0) return false;                         // оверлеи, бегущие строки
        if (W.GetWindow(h, W.GW_OWNER) != IntPtr.Zero && (ex & W.WS_EX_APPWINDOW) == 0) return false;
        if (W.GetWindowTextLength(h) == 0) return false;
        if (SkipClasses.Contains(ClassName(h))) return false;
        if (W.DwmGetWindowAttribute(h, W.DWMWA_CLOAKED, out int cloaked, 4) == 0 && cloaked != 0) return false; // другой рабочий стол
        if (!FrameBounds(h, out var rc)) return false;
        if (rc.Width < 120 || rc.Height < 60) return false;
        r = rc;
        return true;
    }

    /// Видимая рамка окна (без невидимых рамок изменения размера).
    static bool FrameBounds(IntPtr h, out RectangleF r)
    {
        if (W.DwmGetWindowAttribute(h, W.DWMWA_EXTENDED_FRAME_BOUNDS, out W.RECT rc, Marshal.SizeOf<W.RECT>()) != 0)
            if (!W.GetWindowRect(h, out rc)) { r = default; return false; }
        r = new RectangleF(rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top);
        return true;
    }

    static string ClassName(IntPtr h)
    {
        var sb = new StringBuilder(128);
        W.GetClassName(h, sb, sb.Capacity);
        return sb.ToString();
    }

    public RectangleF? Taskbar()
    {
        var h = W.FindWindow("Shell_TrayWnd", null);
        if (h == IntPtr.Zero || !W.GetWindowRect(h, out var rc)) return null;
        var r = new RectangleF(rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top);
        var scr = Screen.PrimaryScreen!.Bounds;
        // Поддерживаем панель задач внизу экрана (она шире, чем выше)
        if (r.Width < r.Height || r.Top < scr.Top + scr.Height / 2) return null;
        return r;
    }

    public PointF Cursor => W.GetCursorPos(out var p) ? new PointF(p.x, p.y) : PointF.Empty;

    public RectangleF[] Screens => Screen.AllScreens.Select(s => (RectangleF)s.Bounds).ToArray();

    public bool SystemTransition
    {
        get
        {
            var fg = W.GetForegroundWindow();
            return fg != IntPtr.Zero && TransitionClasses.Contains(ClassName(fg));
        }
    }

    /// Полноэкранное приложение (игра, видео) на этом экране — снег там не рисуем.
    public static bool FullscreenOn(Rectangle screen)
    {
        var fg = W.GetForegroundWindow();
        if (fg == IntPtr.Zero) return false;
        var cls = ClassName(fg);
        if (cls is "Progman" or "WorkerW" or "Shell_TrayWnd") return false;
        if (!W.GetWindowRect(fg, out var rc)) return false;
        return rc.left <= screen.Left && rc.top <= screen.Top && rc.right >= screen.Right && rc.bottom >= screen.Bottom;
    }
}

static class W
{
    public const int GWL_STYLE = -16, GWL_EXSTYLE = -20;
    public const long WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000, WS_EX_NOACTIVATE = 0x08000000;
    public const uint GW_OWNER = 4;
    public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14;
    public static readonly IntPtr HWND_TOPMOST = new(-1);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] public struct SIZE { public int cx, cy; }
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    public struct BLENDFUNCTION { public byte BlendOp, BlendFlags, SourceConstantAlpha, AlphaFormat; }
    [StructLayout(LayoutKind.Sequential)]
    public struct BITMAPINFOHEADER
    {
        public int biSize, biWidth, biHeight;
        public short biPlanes, biBitCount;
        public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant;
    }

    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string? title);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT v, int size);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateDIBSection(IntPtr dc, ref BITMAPINFOHEADER bi, uint usage, out IntPtr bits, IntPtr sec, uint off);
    [DllImport("user32.dll")] public static extern bool UpdateLayeredWindow(IntPtr h, IntPtr dst, ref POINT pos, ref SIZE size, IntPtr src, ref POINT srcPos, int key, ref BLENDFUNCTION blend, int flags);
    [DllImport("winmm.dll")] public static extern uint timeBeginPeriod(uint p);
    [DllImport("winmm.dll")] public static extern uint timeEndPeriod(uint p);
    [DllImport("user32.dll")] public static extern uint GetDpiForSystem();
}
