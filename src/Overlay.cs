using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Windows.Forms;

namespace Sugrob;

/// Прозрачное окно на весь экран с попиксельной прозрачностью. Клики проходят насквозь.
public class Overlay : Form
{
    public readonly Rectangle ScreenRect;
    IntPtr memDC, dib, oldBmp, bits;
    Bitmap? bmp;
    Graphics? g;

    public Overlay(Rectangle screen)
    {
        ScreenRect = screen;
        AutoScaleMode = AutoScaleMode.None;     // размер — в пикселях экрана, без масштабирования
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        Bounds = screen;
        TopMost = true;
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            // LAYERED + TRANSPARENT (клики насквозь) + TOOLWINDOW + NOACTIVATE + TOPMOST
            cp.ExStyle |= 0x80000 | 0x20 | 0x80 | 0x08000000 | 0x8;
            return cp;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        CreateSurface();
    }

    void CreateSurface()
    {
        int w = ScreenRect.Width, h = ScreenRect.Height;
        var screenDC = W.GetDC(IntPtr.Zero);
        memDC = W.CreateCompatibleDC(screenDC);
        W.ReleaseDC(IntPtr.Zero, screenDC);
        var bi = new W.BITMAPINFOHEADER
        {
            biSize = 40, biWidth = w, biHeight = -h, biPlanes = 1, biBitCount = 32, biCompression = 0,
        };
        dib = W.CreateDIBSection(memDC, ref bi, 0, out bits, IntPtr.Zero, 0);
        oldBmp = W.SelectObject(memDC, dib);
        // GDI+ рисует прямо в память DIB — без копирования каждый кадр
        bmp = new Bitmap(w, h, w * 4, PixelFormat.Format32bppPArgb, bits);
        g = Graphics.FromImage(bmp);
        g.PageUnit = GraphicsUnit.Pixel;
    }

    /// Нарисовать кадр. draw получает Graphics в глобальных экранных координатах.
    public void Render(Action<Graphics, RectangleF> draw)
    {
        if (g == null || !IsHandleCreated) return;
        g.ResetTransform();
        g.Clear(Color.Transparent);
        g.TranslateTransform(-ScreenRect.X, -ScreenRect.Y);
        draw(g, ScreenRect);
        g.Flush();

        var screenDC = W.GetDC(IntPtr.Zero);
        var pos = new W.POINT { x = ScreenRect.X, y = ScreenRect.Y };
        var size = new W.SIZE { cx = ScreenRect.Width, cy = ScreenRect.Height };
        var src = new W.POINT();
        var blend = new W.BLENDFUNCTION { BlendOp = 0, SourceConstantAlpha = 255, AlphaFormat = 1 };
        W.UpdateLayeredWindow(Handle, screenDC, ref pos, ref size, memDC, ref src, 0, ref blend, 2 /*ULW_ALPHA*/);
        W.ReleaseDC(IntPtr.Zero, screenDC);
    }

    /// Снова поверх всего (в том числе панели задач).
    public void BringToTop() => W.SetWindowPos(Handle, W.HWND_TOPMOST, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);

    protected override void Dispose(bool disposing)
    {
        g?.Dispose(); bmp?.Dispose();
        if (memDC != IntPtr.Zero) { W.SelectObject(memDC, oldBmp); W.DeleteObject(dib); W.DeleteDC(memDC); }
        memDC = IntPtr.Zero;
        base.Dispose(disposing);
    }
}
