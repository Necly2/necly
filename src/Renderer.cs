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

        DrawFrost(g, region);
        DrawPiles(g, region);
        DrawSnowmen(g, region);
        DrawRain(g, region);
        DrawFlakes(g, region);
        DrawGarland(g, region);
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
            if (!s.Visible[i] || s.Total(i) < 0.3f) { i++; continue; }
            int start = i;
            while (i < n && s.Visible[i] && s.Total(i) >= 0.3f) i++;
            int end = i - 1;
            var pts = new List<PointF>();
            var bases = new List<PointF>();
            for (int k = start; k <= end; k++)
            {
                float h = s.Total(k), b = top + s.Base(k);
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

    // MARK: Дождь

    readonly Pen rainShadow = new(Color.FromArgb(30, 0, 0, 0), 2.4f) { StartCap = LineCap.Round, EndCap = LineCap.Round };
    readonly Pen rainPen = new(Color.FromArgb(153, 199, 224, 255), 1.1f) { StartCap = LineCap.Round, EndCap = LineCap.Round };
    readonly SolidBrush splashBrush = new(Color.FromArgb(190, 204, 230, 255));

    void DrawRain(Graphics g, RectangleF region)
    {
        if (e.Drops.Count == 0 && e.Splashes.Count == 0) return;
        var area = Inflated(region, 30, 30);
        var windows = e.SnowBehindWindows ? e.WindowSurfaces.Select(w => w.Frame).ToArray() : Array.Empty<RectangleF>();
        rainShadow.Width = 2.4f * S; rainPen.Width = 1.1f * S;
        using var path = new GraphicsPath();
        foreach (var d in e.Drops)
        {
            if (!area.Contains(d.X, d.Y)) continue;
            if (windows.Length > 0 && windows.Any(r => r.Contains(d.X, d.Y))) continue;
            float k = d.Len / d.Vy;
            path.StartFigure();
            path.AddLine(d.X, d.Y, d.X - d.Vx * k, d.Y - d.Len);
        }
        g.DrawPath(rainShadow, path);
        g.DrawPath(rainPen, path);
        foreach (var sp in e.Splashes)
            if (area.Contains(sp.X, sp.Y)) g.FillEllipse(splashBrush, sp.X - S, sp.Y - S, 2 * S, 2 * S);
    }

    // MARK: Иней

    void DrawFrost(Graphics g, RectangleF region)
    {
        float lv = e.FrostLevel;
        if (lv <= 0.01f) return;
        using var path = new GraphicsPath();
        using var band = new GraphicsPath();
        foreach (var s in e.Order)
        {
            if (e.Frozen && !s.IsTaskbar) continue;
            if (!Inflated(s.Frame, 10, 20).IntersectsWith(region)) continue;
            float inset = s.CornerR + 2 * S, x0 = s.Frame.Left + inset, x1 = s.Frame.Right - inset;
            if (x1 <= x0) continue;
            band.StartFigure();
            band.AddLine(x0, s.Top + 0.8f * S, x1, s.Top + 0.8f * S);
            foreach (var sp in e.FrostSpikes(s))
            {
                float x = s.Frame.Left + sp.Off;
                if (x < x0) continue;
                if (x > x1) break;
                if (s.Column(x) is not int c || !s.Visible[c]) continue;
                float y = s.Top + s.Base(c), len = sp.Len * lv;
                // Кристаллы растут вверх от кромки окна
                var tip = new PointF(x + MathF.Sin(sp.Angle) * len, y - MathF.Cos(sp.Angle) * len);
                path.StartFigure(); path.AddLine(x, y, tip.X, tip.Y);
                if (sp.Branch && len > 3 * S)
                {
                    var mid = new PointF((x + tip.X) / 2, (y + tip.Y) / 2);
                    path.StartFigure();
                    path.AddLine(mid.X, mid.Y, mid.X + MathF.Sin(sp.Angle + 0.9f) * len * 0.4f, mid.Y - MathF.Cos(sp.Angle + 0.9f) * len * 0.4f);
                    path.StartFigure();
                    path.AddLine(mid.X, mid.Y, mid.X + MathF.Sin(sp.Angle - 0.9f) * len * 0.4f, mid.Y - MathF.Cos(sp.Angle - 0.9f) * len * 0.4f);
                }
            }
        }
        using var bandPen = new Pen(Color.FromArgb((int)(140 * lv), 219, 240, 255), 1.6f * S);
        using var shade = new Pen(Color.FromArgb((int)(46 * lv), 51, 89, 128), 1.8f * S) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        using var ice = new Pen(Color.FromArgb((int)(217 * lv), 224, 242, 255), 0.8f * S) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        g.DrawPath(bandPen, band);
        g.DrawPath(shade, path);
        g.DrawPath(ice, path);
    }

    // MARK: Снеговики

    void DrawSnowmen(Graphics g, RectangleF region)
    {
        if (e.TaskbarSurface is not Surface d || e.Snowmen.Count == 0 || !Inflated(d.Frame, 10, 80).IntersectsWith(region)) return;
        foreach (var sm in e.Snowmen)
        {
            float x = d.Frame.Left + d.Frame.Width / 2 + sm.XFromCenter;
            if (x < d.Frame.Left + 10 * S || x > d.Frame.Right - 10 * S) continue;
            float grow = 1 - MathF.Pow(1 - sm.Build, 3);
            DrawSnowman(g, x, d.Top + S, grow, 1 - sm.Melt * 0.75f, 1 - sm.Melt * 0.4f);
        }
    }

    void DrawSnowman(Graphics g, float x, float baseY, float scale, float squash, float fade)
    {
        if (scale <= 0.02f) return;
        var saved = g.Save();
        g.TranslateTransform(x, baseY);
        g.ScaleTransform(S * scale * (1 + (1 - squash) * 0.4f), S * scale * squash);
        int A(int a) => (int)(a * fade);

        float r1 = 12, r2 = 8.5f, r3 = 6.5f;
        var c1 = new PointF(0, -r1 * 0.92f);
        var c2 = new PointF(0, c1.Y - r1 * 0.78f - r2 * 0.72f);
        var c3 = new PointF(0, c2.Y - r2 * 0.7f - r3 * 0.78f);
        RectangleF Ball(PointF c, float r) => new(c.X - r, c.Y - r, r * 2, r * 2);

        // Руки-веточки
        using (var arm = new Pen(Color.FromArgb(A(255), 107, 69, 33), 1.4f) { StartCap = LineCap.Round, EndCap = LineCap.Round })
        {
            g.DrawLine(arm, -r2 * 0.8f, c2.Y, -r2 - 9, c2.Y - 7);
            g.DrawLine(arm, -r2 - 5, c2.Y - 4, -r2 - 7, c2.Y - 9);
            g.DrawLine(arm, r2 * 0.8f, c2.Y, r2 + 9, c2.Y - 6);
            g.DrawLine(arm, r2 + 5, c2.Y - 3, r2 + 8, c2.Y - 1);
        }
        // Три кома с тенью
        using (var sh = new SolidBrush(Color.FromArgb(A(60), 0, 0, 0)))
        {
            g.FillEllipse(sh, RectangleF.Inflate(Ball(c1, r1), 0.8f, 0.8f));
            g.FillEllipse(sh, RectangleF.Inflate(Ball(c2, r2), 0.8f, 0.8f));
            g.FillEllipse(sh, RectangleF.Inflate(Ball(c3, r3), 0.8f, 0.8f));
        }
        using (var white = new SolidBrush(Color.FromArgb(A(255), 250, 252, 255)))
        {
            g.FillEllipse(white, Ball(c1, r1)); g.FillEllipse(white, Ball(c2, r2)); g.FillEllipse(white, Ball(c3, r3));
        }
        using (var outline = new Pen(Color.FromArgb(A(128), 153, 178, 204), 0.6f))
        {
            g.DrawEllipse(outline, Ball(c1, r1)); g.DrawEllipse(outline, Ball(c2, r2)); g.DrawEllipse(outline, Ball(c3, r3));
        }
        // Пуговицы, глаза, нос-морковка
        using (var coal = new SolidBrush(Color.FromArgb(A(255), 31, 31, 31)))
        {
            g.FillEllipse(coal, -0.9f, c2.Y - 2.5f - 0.9f, 1.8f, 1.8f);
            g.FillEllipse(coal, -0.9f, c2.Y + 2.5f - 0.9f, 1.8f, 1.8f);
            g.FillEllipse(coal, -0.9f, c1.Y - 4 - 0.9f, 1.8f, 1.8f);
            g.FillEllipse(coal, -2.6f, c3.Y - 2, 1.5f, 1.5f);
            g.FillEllipse(coal, 1.1f, c3.Y - 2, 1.5f, 1.5f);
        }
        using (var carrot = new SolidBrush(Color.FromArgb(A(255), 255, 128, 25)))
            g.FillPolygon(carrot, new[] { new PointF(0, c3.Y - 0.2f), new PointF(7, c3.Y + 1), new PointF(0, c3.Y + 1.6f) });
        // Шарф
        using var red = new SolidBrush(Color.FromArgb(A(255), 217, 31, 38));
        float neck = c2.Y - r2 * 0.72f;
        g.FillRectangle(red, -r2 * 0.75f, neck - 1.6f, r2 * 1.5f, 3.2f);
        g.FillRectangle(red, r2 * 0.25f, neck, 2.6f, 7);
        // Головной убор
        float top = c3.Y - r3 * 0.8f;
        switch (e.SnowmanStyle)
        {
            case 0:
                using (var black = new SolidBrush(Color.FromArgb(A(255), 26, 26, 26)))
                {
                    g.FillRectangle(black, -6.5f, top - 1, 13, 1.8f);
                    g.FillRectangle(black, -4.2f, top - 9, 8.4f, 8.5f);
                }
                g.FillRectangle(red, -4.2f, top - 2.6f, 8.4f, 1.4f);
                break;
            case 1:
                using (var tin = new SolidBrush(Color.FromArgb(A(255), 140, 153, 166)))
                    g.FillPolygon(tin, new[] { new PointF(-5.5f, top + 0.5f), new PointF(5.5f, top + 0.5f), new PointF(4, top - 7), new PointF(-4, top - 7) });
                using (var rim = new Pen(Color.FromArgb(A(255), 89, 89, 89), 0.6f)) g.DrawLine(rim, -5, top - 1.5f, 5, top - 1.5f);
                break;
            case 2:
                g.FillPie(red, -6, top - 5, 12, 12, 180, 180);
                using (var wb = new SolidBrush(Color.FromArgb(A(255), 255, 255, 255)))
                {
                    g.FillRectangle(wb, -6.3f, top - 0.5f, 12.6f, 2);
                    g.FillEllipse(wb, -2.2f, top - 8.5f, 4.4f, 4.4f);
                }
                break;
        }
        g.Restore(saved);
    }
}
