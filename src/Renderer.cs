using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Linq;

namespace Sugrob;

/// Рисует состояние движка через GDI+.
public class Renderer
{
    readonly Engine e;
    float S => e.S;
    static readonly Color SnowColor = Color.FromArgb(255, 247, 250, 255);
    readonly SolidBrush snow = new(SnowColor);
    readonly SolidBrush shadow = new(Color.FromArgb(70, 0, 0, 0));
    readonly SolidBrush halo = new(Color.FromArgb(30, 0, 0, 0));
    readonly Dictionary<(int, int), Bitmap> bulbCache = new();
    int bulbPalette = -1;

    public Renderer(Engine engine) { e = engine; }

    public void Draw(Graphics g, RectangleF region)
    {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.CompositingQuality = CompositingQuality.HighSpeed;
        g.PixelOffsetMode = PixelOffsetMode.HighSpeed;

        DrawPiles(g, region);
        DrawFlakes(g, region);
        DrawGarland(g, region);
        DrawSurprise(g, region);
    }

    // MARK: Сугробы

    void DrawPiles(Graphics g, RectangleF region)
    {
        using var path = new GraphicsPath(FillMode.Winding);
        using var lumps = new GraphicsPath(FillMode.Winding);
        foreach (var s in e.Order)
        {
            if (e.Frozen && !s.IsTaskbar) continue;
            var fr = s.Frame; fr.Inflate(4, 40);
            if (!fr.IntersectsWith(region)) continue;
            AddPile(s, path, lumps);
        }
        // Мягкая «тень» — тот же контур чуть ниже и полупрозрачный
        var st = g.Transform;
        g.TranslateTransform(0, 1.3f * S);
        g.FillPath(shadow, path); g.FillPath(shadow, lumps);
        g.Transform = st;
        g.FillPath(snow, path);
        g.FillPath(snow, lumps);
    }

    void AddPile(Surface s, GraphicsPath path, GraphicsPath lumps)
    {
        int n = s.Heights.Length;
        float top = s.Top;
        float minX = s.Frame.Left + 1.5f * S, maxX = s.Frame.Right - 1.5f * S;
        int i = 0;
        while (i < n)
        {
            if (!s.Visible[i] || s.Heights[i] < 0.3f) { i++; continue; }
            int start = i;
            while (i < n && s.Visible[i] && s.Heights[i] >= 0.3f) i++;
            int end = i - 1;
            var pts = new List<PointF>();
            var bases = new List<PointF>();
            for (int k = start; k <= end; k++)
            {
                float h = s.Heights[k], b = top + s.Base(k);
                float x = Math.Clamp(s.ColX(k), minX, maxX);
                pts.Add(new PointF(x, b - h));
                bases.Add(new PointF(x, b + 0.5f));
                // Комки на верхушке — не у краёв участка
                if (k % 2 == 0 && h > 3 * S && s.Lumps[k] > 0.3f && k - start >= 2 && end - k >= 2)
                {
                    float r = Math.Min(h * 0.35f, (1.3f + s.Lumps[k] * 2.8f) * S);
                    float cx = s.ColX(k) + (s.Lumps[k] - 0.5f) * 2 * S, cy = b - h + r * 0.55f;
                    if (cx - r >= minX && cx + r <= maxX) lumps.AddEllipse(cx - r, cy - r, r * 2, r * 2);
                }
            }
            path.StartFigure();
            path.AddLine(bases[0], pts[0]);
            if (pts.Count > 2) path.AddCurve(pts.ToArray(), 0.4f);
            else if (pts.Count == 2) path.AddLine(pts[0], pts[1]);
            bases.Reverse();
            path.AddLine(pts[^1], bases[0]);
            if (bases.Count > 1) path.AddLines(bases.ToArray());
            path.CloseFigure();
        }
    }

    // MARK: Снежинки

    void DrawFlakes(Graphics g, RectangleF region)
    {
        var area = region; area.Inflate(4, 4);
        var windows = e.SnowBehindWindows
            ? e.WindowSurfaces.Select(s => s.Frame).Where(r => r.IntersectsWith(area)).ToArray()
            : Array.Empty<RectangleF>();
        using var white = new SolidBrush(Color.White);
        foreach (var f in e.Flakes)
        {
            if (!area.Contains(f.X, f.Y)) continue;
            if (windows.Length > 0 && windows.Any(r => r.Contains(f.X, f.Y))) continue;
            float rr = f.R + 0.6f * S;
            g.FillEllipse(halo, f.X - rr, f.Y - rr, rr * 2, rr * 2);
            white.Color = Color.FromArgb((int)(255 * f.Alpha), 255, 255, 255);
            g.FillEllipse(white, f.X - f.R, f.Y - f.R, f.R * 2, f.R * 2);
        }
    }

    // MARK: Гирлянда

    void DrawGarland(Graphics g, RectangleF region)
    {
        var gs = e.Garland;
        if (!gs.Enabled) return;
        if (bulbPalette != gs.Palette) { foreach (var b in bulbCache.Values) b.Dispose(); bulbCache.Clear(); bulbPalette = gs.Palette; }
        int strand = 0;
        if (gs.OnTop)
            foreach (var sc in new[] { region })
                Strand(g, sc.Left + 6 * S, sc.Right - 6 * S, sc.Top + 1, 7 * S, strand++, null);
        if (gs.OnTaskbar && e.TaskbarSurface is Surface tb && Inflated(tb.Frame, 10, 30).IntersectsWith(region))
            Strand(g, tb.Frame.Left + 6 * S, tb.Frame.Right - 6 * S, tb.Top + 2 * S, 6 * S, 7, null);
        if (gs.OnWindows && !e.Frozen)
            foreach (var s in e.WindowSurfaces)
            {
                if (!Inflated(s.Frame, 10, 30).IntersectsWith(region)) continue;
                float inset = s.CornerR + 4 * S;
                if (s.Frame.Width <= inset * 2 + 40 * S) continue;
                var surf = s;
                Strand(g, s.Frame.Left + inset, s.Frame.Right - inset, s.Top + 2 * S, 5 * S, (int)(s.Id % 97),
                    x => surf.Column(x) is int c && surf.Visible[c]);
            }
    }

    static RectangleF Inflated(RectangleF r, float x, float y) { r.Inflate(x, y); return r; }

    void Strand(Graphics g, float x0, float x1, float y, float sag, int seed, Func<float, bool>? visible)
    {
        if (x1 - x0 < 30) return;
        float hook = 66 * S;
        float span = (x1 - x0) / Math.Max(1, MathF.Round((x1 - x0) / hook));
        float WireY(float x) { float f = ((x - x0) / span) % 1; return y + sag * MathF.Sin(MathF.PI * f); }

        // Провод
        using (var pen = new Pen(Color.FromArgb(215, 30, 30, 30), 1.2f * S))
        {
            var pts = new List<PointF>();
            for (float x = x0; x <= x1; x += 3 * S)
            {
                if (visible == null || visible(x)) pts.Add(new PointF(x, WireY(x)));
                else { if (pts.Count > 1) g.DrawLines(pen, pts.ToArray()); pts.Clear(); }
            }
            if (pts.Count > 1) g.DrawLines(pen, pts.ToArray());
        }

        // Лампочки — готовые картинки по цвету и уровню яркости
        var colors = GarlandSettings.Palettes[Math.Clamp(e.Garland.Palette, 0, GarlandSettings.Palettes.Length - 1)].Colors;
        int n = (int)((x1 - x0) / (22 * S));
        if (n <= 0) return;
        float step = (x1 - x0) / n;
        float time = (float)e.T;
        for (int k = 0; k <= n; k++)
        {
            float bx = x0 + k * step;
            if (visible != null && !visible(bx)) continue;
            float by = WireY(bx);
            int idx = k + seed * 3;
            float b = Brightness(idx, time) * e.Garland.Brightness;
            int level = Math.Clamp((int)MathF.Round(b * 6), 0, 6);
            var bmp = Bulb(idx % colors.Length, level, colors[idx % colors.Length]);
            g.DrawImageUnscaled(bmp, (int)(bx - bmp.Width / 2f), (int)(by - 4 * S));
        }
    }

    float Brightness(int k, float time) => e.Garland.Mode switch
    {
        0 => 0.55f + 0.45f * MathF.Sin(time * 2.2f + k * 0.9f),
        1 => ((((int)(time * 7) - k) % 4) + 4) % 4 == 0 ? 1 : 0.18f,
        2 => MathF.Sin(time * (1.3f + Hash(k) * 2.7f) + Hash(k) * 40) > 0.25f ? 1 : 0.2f,
        _ => 1,
    };

    static float Hash(int k) => ((uint)(k * 2654435761u) & 0xFFFF) / 65535f;

    /// Картинка лампочки: свечение, цоколь, колба, блик. Кэшируется.
    Bitmap Bulb(int colorIndex, int level, Color c)
    {
        if (bulbCache.TryGetValue((colorIndex, level), out var bmp)) return bmp;
        float b = level / 6f;
        int size = (int)Math.Ceiling(30 * S);
        bmp = new Bitmap(size, size, PixelFormat.Format32bppPArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float cx = size / 2f, cy = 4 * S + 8 * S;
            // Свечение
            using (var gp = new GraphicsPath())
            {
                float gr = 13 * S;
                gp.AddEllipse(cx - gr, cy - gr, gr * 2, gr * 2);
                using var pgb = new PathGradientBrush(gp)
                {
                    CenterColor = Color.FromArgb((int)(140 * b), c),
                    SurroundColors = new[] { Color.FromArgb(0, c) },
                };
                g.FillPath(pgb, gp);
            }
            // Цоколь
            using (var sb = new SolidBrush(Color.FromArgb(255, 50, 50, 50)))
                g.FillRectangle(sb, cx - 1.6f * S, 4 * S, 3.2f * S, 3 * S);
            // Колба
            float dim = 0.35f + 0.65f * b;
            using (var bb = new SolidBrush(Color.FromArgb(255, (int)(c.R * dim), (int)(c.G * dim), (int)(c.B * dim))))
                g.FillEllipse(bb, cx - 2.8f * S, 6.5f * S, 5.6f * S, 8.5f * S);
            // Блик
            using (var hb = new SolidBrush(Color.FromArgb((int)(140 * b), 255, 255, 255)))
                g.FillEllipse(hb, cx - 1.4f * S, 7.8f * S, 1.6f * S, 2.6f * S);
        }
        bulbCache[(colorIndex, level)] = bmp;
        return bmp;
    }

    // MARK: Сюрприз

    void DrawSurprise(Graphics g, RectangleF region)
    {
        foreach (var p in e.Puffs)
        {
            using var b = new SolidBrush(Color.FromArgb((int)(128 * p.Life / p.MaxLife), 217, 217, 217));
            g.FillEllipse(b, p.X - p.R, p.Y - p.R, p.R * 2, p.R * 2);
        }
        if (e.SurpriseStart >= 0 && e.ImpactTime < 0)
        {
            var p = e.RocketPos();
            if (Inflated(region, 40 * S, 120 * S).Contains(p)) DrawRocket(g, p);
        }
        if (e.ImpactTime >= 0)
        {
            float k = (float)(e.T - e.ImpactTime);
            if (k < 0.4f)
            {
                float rr = (30 + k * 520) * S;
                using var fb = new SolidBrush(Color.FromArgb((int)(204 * (1 - k / 0.4f)), 255, 242, 191));
                g.FillEllipse(fb, e.RocketTo.X - rr, e.RocketTo.Y - rr, rr * 2, rr * 2);
            }
        }
        float time = (float)e.T;
        using var white = new SolidBrush(Color.White);
        for (int i = 0; i < e.Word.Count; i++)
        {
            var w = e.Word[i];
            float x = w.X + MathF.Sin(time * 3 + i) * 0.6f * S, y = w.Y + MathF.Cos(time * 2.6f + i * 1.7f) * 0.6f * S;
            if (!region.Contains(x, y)) continue;
            float rr = w.R + 0.7f * S;
            g.FillEllipse(halo, x - rr, y - rr, rr * 2, rr * 2);
            g.FillEllipse(white, x - w.R, y - w.R, w.R * 2, w.R * 2);
        }
    }

    /// Ракета носом вниз; tip — кончик носа.
    void DrawRocket(Graphics g, PointF tip)
    {
        float x = tip.X, y = tip.Y, s = S;
        float fl = (20 + (float)e.Rnd.NextDouble() * 14) * s;
        using (var b = new SolidBrush(Color.FromArgb(230, 255, 115, 25)))
            g.FillPolygon(b, new[] { new PointF(x - 9 * s, y - 62 * s), new PointF(x + 9 * s, y - 62 * s), new PointF(x, y - 62 * s - fl) });
        using (var b = new SolidBrush(Color.FromArgb(255, 255, 230, 77)))
            g.FillPolygon(b, new[] { new PointF(x - 5 * s, y - 62 * s), new PointF(x + 5 * s, y - 62 * s), new PointF(x, y - 62 * s - fl * 0.55f) });
        using var red = new SolidBrush(Color.FromArgb(255, 217, 31, 38));
        g.FillPolygon(red, new[] { new PointF(x - 11 * s, y - 38 * s), new PointF(x - 21 * s, y - 64 * s), new PointF(x - 11 * s, y - 58 * s) });
        g.FillPolygon(red, new[] { new PointF(x + 11 * s, y - 38 * s), new PointF(x + 21 * s, y - 64 * s), new PointF(x + 11 * s, y - 58 * s) });
        using (var body = RoundRect(new RectangleF(x - 11 * s, y - 62 * s, 22 * s, 50 * s), 6 * s))
        {
            using var bb = new SolidBrush(Color.FromArgb(255, 242, 242, 242));
            g.FillPath(bb, body);
            using var pen = new Pen(Color.FromArgb(255, 77, 77, 77), 1 * s);
            g.DrawPath(pen, body);
            using var win = new SolidBrush(Color.FromArgb(255, 77, 153, 242));
            g.FillEllipse(win, x - 5 * s, y - 43 * s, 10 * s, 10 * s);
            g.DrawEllipse(pen, x - 5 * s, y - 43 * s, 10 * s, 10 * s);
        }
        g.FillPolygon(red, new[] { new PointF(x - 11 * s, y - 14 * s), new PointF(x + 11 * s, y - 14 * s), new PointF(x, y) });
    }

    static GraphicsPath RoundRect(RectangleF r, float rad)
    {
        var p = new GraphicsPath();
        float d = rad * 2;
        p.AddArc(r.Left, r.Top, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Top, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.Left, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    /// Точки внутри букв (относительно центра надписи), примерно target штук.
    public static List<PointF> TextPoints(string text, float fontPx, int target)
    {
        var res = new List<PointF>();
        using var font = new Font("Segoe UI Black", fontPx, FontStyle.Regular, GraphicsUnit.Pixel);
        SizeF sz;
        using (var tmp = new Bitmap(1, 1)) using (var tg = Graphics.FromImage(tmp)) sz = tg.MeasureString(text, font);
        int w = (int)sz.Width + 20, h = (int)sz.Height + 20;
        using var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.Clear(Color.Black);
            g.TextRenderingHint = TextRenderingHint.AntiAlias;
            g.DrawString(text, font, Brushes.White, 10, 10);
        }
        var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        var buf = new byte[data.Stride * h];
        System.Runtime.InteropServices.Marshal.Copy(data.Scan0, buf, 0, buf.Length);
        bmp.UnlockBits(data);
        bool On(int x, int y) => buf[y * data.Stride + x * 4 + 1] > 128;
        int on = 0;
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) if (On(x, y)) on++;
        if (on == 0) return res;
        int step = Math.Max(3, (int)Math.Round(Math.Sqrt(on / (double)target)));
        var rnd = new Random();
        for (int y = 0; y < h; y += step)
            for (int x = 0; x < w; x += step)
                if (On(x, y)) res.Add(new PointF(x - w / 2f + (float)rnd.NextDouble() - 0.5f, y - h / 2f + (float)rnd.NextDouble() - 0.5f));
        return res;
    }
}
