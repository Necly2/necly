using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;

namespace Sugrob;

/// Окно, которое видит движок (координаты экрана в пикселях, ось Y вниз).
public record WinInfo(long Id, RectangleF Frame);

/// Источник данных о рабочем столе (Windows или тестовая заглушка).
public interface IDesktop
{
    /// Окна спереди назад.
    List<WinInfo> Windows();
    RectangleF? Taskbar();
    PointF Cursor { get; }
    RectangleF[] Screens { get; }
    /// Открыт «Представление задач» / Alt+Tab и т.п.
    bool SystemTransition { get; }
}

/// Поверхность, на которой копится снег: верхняя кромка окна или панель задач.
public class Surface
{
    public readonly long Id;
    public RectangleF Frame;
    public float[] Heights;
    public bool[] Visible;
    public float[] Profile = Array.Empty<float>();
    public float[] Lumps = Array.Empty<float>();
    public float[] Heap;        // куча, сметённая курсором (только панель задач) — из неё лепится снеговик
    public float CornerR;
    public PointF Velocity;
    public double LastChange;
    public readonly bool IsTaskbar;
    readonly Engine e;

    public Surface(Engine engine, long id, RectangleF frame, bool isTaskbar = false)
    {
        e = engine; Id = id; Frame = frame; IsTaskbar = isTaskbar;
        CornerR = isTaskbar ? 0 : e.WindowCorner;
        int n = Columns(frame.Width);
        Heights = new float[n];
        Visible = Enumerable.Repeat(true, n).ToArray();
        Heap = new float[n];
        MakeShape(n);
    }

    /// Высота снега вместе с кучей.
    public float Total(int i) => Heights[i] + (i < Heap.Length ? Heap[i] : 0);

    public int Columns(float w) => Math.Max(1, (int)(w / e.ColW));
    public float Top => Frame.Top;
    public float MaxHeight => (IsTaskbar ? 20 : 26) * e.S;
    public float ColX(int i) => Frame.Left + (i + 0.5f) * e.ColW;

    public int? Column(float x)
    {
        float v = (x - Frame.Left) / e.ColW;
        if (v < 0) return null;
        int i = (int)v;
        return i < Heights.Length ? i : null;
    }

    /// Случайный, но плавный рельеф: холмы + бугорки + шум.
    public void MakeShape(int n)
    {
        var r = e.Rnd;
        double a1 = 2 * Math.PI / (22 + r.NextDouble() * 18), a2 = 2 * Math.PI / (7 + r.NextDouble() * 5);
        double p1 = r.NextDouble() * 6.28, p2 = r.NextDouble() * 6.28;
        Profile = new float[n];
        Lumps = new float[n];
        for (int i = 0; i < n; i++)
        {
            double v = 0.55 + 0.3 * Math.Sin(i * a1 + p1) + 0.15 * Math.Sin(i * a2 + p2) + (r.NextDouble() - 0.5) * 0.12;
            Profile[i] = (float)Math.Clamp(v, 0.15, 1);
            Lumps[i] = (float)r.NextDouble();
        }
    }

    /// Предельная высота колонки: у скруглённых углов снега нет, к центру — холмы.
    public float Cap(int i)
    {
        float x = ColX(i);
        float dx = Math.Min(x - Frame.Left, Frame.Right - x);
        float start = CornerR * 0.7f + 2 * e.S;
        if (dx <= start) return 0;
        float edge = 1 * e.S + (dx - start) * 0.9f;
        float shape = i < Profile.Length ? Profile[i] : 1;
        return Math.Min(edge, MaxHeight * (0.35f + 0.65f * shape));
    }

    /// На сколько опущена кромка из-за скругления угла.
    public float Base(int i)
    {
        float r = Math.Min(CornerR, Frame.Width / 2);
        if (r <= 0) return 0;
        float x = ColX(i);
        float dx = Math.Min(x - Frame.Left, Frame.Right - x);
        if (dx >= r) return 0;
        float k = r - Math.Max(0, dx);
        return r - MathF.Sqrt(Math.Max(0, r * r - k * k));
    }
}

public struct Flake
{
    public float X, Y, Vx, Vy, R, Phase, Alpha;
    public bool Loose;
    public long IgnoreId;
    public double IgnoreUntil;
}

public struct WordFlake { public float X, Y, Vx, Vy, Tx, Ty, R, Delay; }
public struct Puff { public float X, Y, R, Life, MaxLife; }

public class GarlandSettings
{
    public bool Enabled = true, OnTaskbar = true, OnTop = false, OnWindows = false;
    public int Mode, Palette;
    public float Brightness = 0.9f;
    public static readonly string[] Modes = { "Плавное мерцание", "Бегущие огни", "Случайное мигание", "Горит постоянно" };
    public static readonly (string Name, Color[] Colors)[] Palettes =
    {
        ("Разноцветная", new[] { Color.FromArgb(255, 64, 64), Color.FromArgb(255, 204, 51), Color.FromArgb(77, 230, 90), Color.FromArgb(77, 153, 255), Color.FromArgb(217, 102, 255) }),
        ("Тёплая белая", new[] { Color.FromArgb(255, 217, 140), Color.FromArgb(255, 199, 115) }),
        ("Холодная (бело-голубая)", new[] { Color.FromArgb(217, 237, 255), Color.FromArgb(115, 191, 255) }),
        ("Красно-зелёная", new[] { Color.FromArgb(255, 51, 51), Color.FromArgb(64, 217, 77) }),
    };
}

/// Физика снега — перенос с версии для macOS.
public partial class Engine
{
    public readonly Random Rnd = new();
    public float S = 1;                 // масштаб (DPI / 96)
    public float ColW => 3 * S;
    public float WindowCorner = 8;      // радиус скругления окон (Windows 11)

    // Настройки
    public bool Snowing = true;
    public float Intensity = 4.5f;
    public bool FastPiles;
    public bool TaskbarEnabled = true;
    public bool SnowBehindWindows;
    public GarlandSettings Garland = new();

    public List<Flake> Flakes = new();
    readonly Dictionary<long, Surface> surfaces = new();
    readonly Dictionary<long, (Surface S, double T)> stash = new();
    List<Surface> windowOrder = new();
    public List<Surface> Order = new();
    public Surface? TaskbarSurface;
    public IReadOnlyList<Surface> WindowSurfaces => windowOrder;

    public double T;
    double transitionUntil = -1;
    public bool Frozen => T < transitionUntil;
    float frameDt = 1 / 60f;
    float spawnAcc, wind;
    PointF mouse; PointF mouseV; bool hasMouse;
    public RectangleF Bounds = RectangleF.Empty;
    const int MaxFlakes = 5000;
    readonly IDesktop desk;
    double taskbarAcc = 10;

    public Engine(IDesktop desktop, float scale, float windowCorner)
    {
        desk = desktop; S = scale; WindowCorner = windowCorner;
        ScreensChanged();
    }

    public void ScreensChanged()
    {
        var sc = desk.Screens;
        Bounds = sc.Length == 0 ? RectangleF.Empty : sc.Aggregate(RectangleF.Union);
        taskbarAcc = 10;
    }

    // MARK: Шаг

    public void Step(double dtIn)
    {
        float dt = (float)Math.Clamp(dtIn, 0.001, 1 / 20.0);
        T += dtIn;
        frameDt = dt;
        wind = (MathF.Sin((float)T * 0.13f) * 12 + MathF.Sin((float)T * 0.37f) * 6) * S;

        taskbarAcc += dtIn;
        if (taskbarAcc >= 1) { taskbarAcc = 0; PollTaskbar(); RebuildOrder(); }
        PollWindows();
        UpdateMouse(dt);
        Spawn(dt);
        MoveFlakes(dt);
        Relax();
        Brush();
        UpdateWeatherEffects(dt);
        UpdateSnowmen(dt);
        UpdateSurprise(dt);
    }

    // MARK: Окна

    void PollWindows()
    {
        var found = desk.Windows();
        var seen = new HashSet<long>(found.Select(w => w.Id));

        // Если разом сдвинулись/пропали несколько окон — это системная анимация, а не пользователь.
        int changed = 0;
        foreach (var w in found)
            if (surfaces.TryGetValue(w.Id, out var e))
            {
                float d = Math.Abs(e.Frame.X - w.Frame.X) + Math.Abs(e.Frame.Y - w.Frame.Y)
                          + Math.Abs(e.Frame.Width - w.Frame.Width) + Math.Abs(e.Frame.Height - w.Frame.Height);
                if (d > 2) changed++;
            }
        int vanished = surfaces.Keys.Count(k => !seen.Contains(k));
        int total = Math.Max(1, Math.Max(surfaces.Count, found.Count));
        if (desk.SystemTransition || (changed + vanished >= 2 && (changed + vanished) * 2 >= total))
            transitionUntil = T + 0.4;
        bool freeze = Frozen;

        var newOrder = new List<Surface>();
        foreach (var w in found)
        {
            Surface s;
            if (surfaces.TryGetValue(w.Id, out var ex))
            {
                s = ex;
                if (freeze) QuietMove(s, w.Frame); else Update(s, w.Frame);
            }
            else if (stash.Remove(w.Id, out var st))
            {
                s = st.S; QuietMove(s, w.Frame); surfaces[w.Id] = s;   // окно вернулось со своим снегом
            }
            else
            {
                s = new Surface(this, w.Id, w.Frame) { LastChange = T };
                surfaces[w.Id] = s;
            }
            newOrder.Add(s);
        }
        foreach (var id in surfaces.Keys.Where(k => !seen.Contains(k)).ToList())
        {
            var s = surfaces[id];
            if (freeze) stash[id] = (s, T);
            else Shed(s, 1, s.Frame, PointF.Empty, 40 * S, false);   // окно закрыли — снег падает
            surfaces.Remove(id);
        }
        foreach (var id in stash.Where(kv => T - kv.Value.T > 900).Select(kv => kv.Key).ToList()) stash.Remove(id);
        windowOrder = newOrder;
        RebuildOrder();
    }

    void QuietMove(Surface s, RectangleF r)
    {
        if (Math.Abs(r.Width - s.Frame.Width) > 0.5f) Remap(s, r, PointF.Empty, true);
        else s.Frame = r;
        s.Velocity = PointF.Empty;
        s.LastChange = T;
    }

    void Update(Surface s, RectangleF r)
    {
        var old = s.Frame;
        bool sizeChanged = Math.Abs(r.Width - old.Width) > 0.5f || Math.Abs(r.Height - old.Height) > 0.5f;
        if (sizeChanged)
        {
            bool topMoved = Math.Abs(r.Top - old.Top) > 0.5f, widthChanged = Math.Abs(r.Width - old.Width) > 0.5f;
            Remap(s, r, PointF.Empty, false);
            if (widthChanged || topMoved) Shed(s, 0.2f, s.Frame, new PointF(0, -40 * S), 70 * S, true);
            s.Velocity = PointF.Empty; s.LastChange = T;
            return;
        }
        if (r.Location != old.Location)
        {
            float dtc = (float)Math.Max(T - s.LastChange, 1 / 240.0);
            var v = new PointF((r.X - old.X) / dtc, (r.Y - old.Y) / dtc);
            s.Velocity = new PointF(s.Velocity.X * 0.5f + v.X * 0.5f, s.Velocity.Y * 0.5f + v.Y * 0.5f);
            s.Frame = r; s.LastChange = T;
            if (Len(s.Velocity) > 2600 * S)
                Shed(s, Math.Min(0.5f, 1.2f * frameDt), r, Mul(s.Velocity, 0.8f), 90 * S, true);
        }
        else if (T - s.LastChange > 0.07 && (s.Velocity.X != 0 || s.Velocity.Y != 0))
        {
            // Окно резко остановилось после быстрого движения — «бросок»: снег летит дальше.
            float speed = Len(s.Velocity);
            if (speed > 1400 * S)
            {
                float frac = Math.Min(1, 0.4f + (speed - 1400 * S) / (2500 * S));
                Shed(s, frac, r, new PointF(s.Velocity.X * 0.55f, s.Velocity.Y * 0.55f - 120 * S), 120 * S, true);
            }
            s.Velocity = PointF.Empty;
        }
    }

    void Remap(Surface s, RectangleF r, PointF v, bool dropOutside)
    {
        var old = s.Frame; var oldH = s.Heights; var oldHeap = s.Heap;
        int n = s.Columns(r.Width);
        var nh = new float[n];
        var nheap = new float[n];
        for (int j = 0; j < oldHeap.Length; j++)
        {
            if (oldHeap[j] <= 0.1f) continue;
            float pos = (old.Left + (j + 0.5f) * ColW - r.Left) / ColW;
            if (pos >= 0 && (int)pos < n) nheap[(int)pos] = Math.Max(nheap[(int)pos], oldHeap[j]);
        }
        for (int j = 0; j < oldH.Length; j++)
        {
            if (oldH[j] <= 0.3f) continue;
            float x = old.Left + (j + 0.5f) * ColW;
            float pos = (x - r.Left) / ColW;
            if (pos >= 0 && (int)pos < n) nh[(int)pos] = Math.Max(nh[(int)pos], oldH[j]);
            else if (!dropOutside) Emit(x, old.Top, oldH[j], new PointF(v.X * 0.6f, 0), 50 * S, s.Id);
        }
        s.Frame = r; s.Heights = nh; s.Heap = nheap; s.Visible = Enumerable.Repeat(true, n).ToArray();
        if (s.Profile.Length != n) s.MakeShape(n);
    }

    void PollTaskbar()
    {
        RectangleF? r = TaskbarEnabled ? desk.Taskbar() : null;
        if (r is RectangleF rr && (rr.Height < 10 * S || !rr.IntersectsWith(Bounds) || rr.Top >= Bounds.Bottom - 2)) r = null;
        if (r == null)
        {
            if (TaskbarSurface != null) { Shed(TaskbarSurface, 1, TaskbarSurface.Frame, PointF.Empty, 30 * S, false); TaskbarSurface = null; }
            return;
        }
        if (TaskbarSurface == null) TaskbarSurface = new Surface(this, -1, r.Value, true);
        else if (TaskbarSurface.Frame != r.Value) Remap(TaskbarSurface, r.Value, PointF.Empty, false);
    }

    void RebuildOrder()
    {
        Order = (TaskbarSurface != null ? new List<Surface> { TaskbarSurface } : new List<Surface>()).Concat(windowOrder).ToList();
        ComputeVisibility();
    }

    /// Сугробы, закрытые окнами спереди, прячем.
    void ComputeVisibility()
    {
        for (int k = 0; k < Order.Count; k++)
        {
            var s = Order[k];
            int n = s.Heights.Length;
            if (s.Visible.Length != n) s.Visible = new bool[n];
            float band = s.Top - s.MaxHeight - 2;
            var occ = new List<RectangleF>();
            for (int j = 0; j < k; j++)
            {
                var r = Order[j].Frame;
                if (r.Top <= s.Top + 1 && r.Bottom >= band && r.Right > s.Frame.Left && r.Left < s.Frame.Right) occ.Add(r);
            }
            for (int i = 0; i < n; i++)
            {
                float x = s.ColX(i);
                bool vis = true;
                foreach (var r in occ) if (x >= r.Left && x < r.Right) { vis = false; break; }
                s.Visible[i] = vis;
            }
        }
    }

    // MARK: Снежинки

    void Spawn(float dt)
    {
        float rate = SnowRate;
        if (rate <= 0 || Bounds.IsEmpty) return;
        spawnAcc += rate * (Bounds.Width / S) / 100 * dt;
        while (spawnAcc >= 1)
        {
            spawnAcc -= 1;
            if (Flakes.Count >= MaxFlakes) { spawnAcc = 0; break; }
            float r = (1.2f + (float)Rnd.NextDouble() * 2.2f);
            Flakes.Add(new Flake
            {
                X = Bounds.Left + (float)Rnd.NextDouble() * Bounds.Width, Y = Bounds.Top - 5,
                Vx = ((float)Rnd.NextDouble() * 16 - 8) * S, Vy = (35 + r * 14 + (float)Rnd.NextDouble() * 15) * S,
                R = r * S, Phase = (float)Rnd.NextDouble() * 6.28f, Alpha = 0.65f + (float)Rnd.NextDouble() * 0.3f,
                IgnoreId = long.MinValue,
            });
        }
    }

    void MoveFlakes(float dt)
    {
        float time = (float)T, dep = FastPiles ? 5 : 1;
        for (int i = 0; i < Flakes.Count;)
        {
            var f = Flakes[i];
            float prevY = f.Y;
            if (f.Loose)
            {
                f.Vy += 1100 * S * dt;
                f.Vx *= 1 - 0.8f * dt;
                f.X += f.Vx * dt; f.Y += f.Vy * dt;
            }
            else
            {
                float sway = MathF.Sin(time * 1.3f + f.Phase) * 14 * S;
                f.X += (f.Vx + sway + wind) * dt;
                f.Y += f.Vy * dt;
            }
            if (hasMouse)
            {
                float dx = f.X - mouse.X, dy = f.Y - mouse.Y, d2 = dx * dx + dy * dy, R = 30 * S;
                if (d2 < R * R && d2 > 0.01f)
                {
                    float d = MathF.Sqrt(d2), push = (R - d) * 0.25f;
                    f.X += dx / d * push; f.Y += dy / d * push;
                }
            }
            bool landed = false;
            if (!f.Loose || f.Vy > 0)
                foreach (var s in Order)
                {
                    if (f.Loose && f.IgnoreId == s.Id && T < f.IgnoreUntil) continue;
                    if (Frozen && !s.IsTaskbar) continue;
                    if (s.Column(f.X) is not int c) continue;
                    float sy = s.Top + s.Base(c) - s.Total(c);
                    if (prevY <= sy + 0.5f && f.Y >= sy && s.Visible[c])
                    {
                        Deposit(s, c, f.Loose ? f.R * 0.9f : f.R * 0.55f * dep);
                        landed = true; break;
                    }
                }
            bool dead = landed || f.Y > Bounds.Bottom + 10 || f.X < Bounds.Left - 60 || f.X > Bounds.Right + 60;
            if (dead) { Flakes[i] = Flakes[^1]; Flakes.RemoveAt(Flakes.Count - 1); }
            else { Flakes[i] = f; i++; }
        }
    }

    void Deposit(Surface s, int c, float amt)
    {
        int n = s.Heights.Length;
        s.Heights[c] = Math.Min(s.Cap(c), s.Heights[c] + amt * 0.7f);
        if (c > 0) s.Heights[c - 1] = Math.Min(s.Cap(c - 1), s.Heights[c - 1] + amt * 0.15f);
        if (c < n - 1) s.Heights[c + 1] = Math.Min(s.Cap(c + 1), s.Heights[c + 1] + amt * 0.15f);
    }

    void Relax()
    {
        float th = 2.6f * S;
        foreach (var s in Order)
        {
            var h = s.Heights; int n = h.Length;
            for (int i = 0; i < n - 1; i++)
            {
                float d = h[i] - h[i + 1];
                if (Math.Abs(d) > th)
                {
                    float m = (Math.Abs(d) - th) * 0.2f;
                    if (d > 0) { h[i] -= m; h[i + 1] += m; } else { h[i] += m; h[i + 1] -= m; }
                }
            }
            for (int i = 0; i < n; i++) { float c = s.Cap(i); if (h[i] > c) h[i] = c; }
        }
    }

    // MARK: Курсор

    void UpdateMouse(float dt)
    {
        var p = desk.Cursor;
        if (hasMouse)
        {
            var v = new PointF((p.X - mouse.X) / dt, (p.Y - mouse.Y) / dt);
            mouseV = new PointF(mouseV.X * 0.5f + v.X * 0.5f, mouseV.Y * 0.5f + v.Y * 0.5f);
        }
        mouse = p; hasMouse = true;
    }

    /// Курсор сметает снег с кромки окна или панели задач.
    void Brush()
    {
        if (!hasMouse || Frozen || Len(mouseV) < 60 * S) return;
        float R = 16 * S;
        foreach (var s in Order)
        {
            float below = (s.IsTaskbar ? 14 : 8) * S;
            if (mouse.Y > s.Top + below || mouse.Y < s.Top - s.MaxHeight - 12 * S ||
                mouse.X < s.Frame.Left - R || mouse.X > s.Frame.Right + R) continue;
            int i0 = Math.Max(0, (int)Math.Floor((mouse.X - R - s.Frame.Left) / ColW));
            int i1 = Math.Min(s.Heights.Length - 1, (int)Math.Floor((mouse.X + R - s.Frame.Left) / ColW));
            if (s.IsTaskbar && SnowmanEnabled) { SweepIntoHeap(s, i0, i1); continue; }
            for (int i = i0; i <= i1; i++)
            {
                if (!s.Visible[i] || s.Heights[i] <= 0.4f) continue;
                float amt = s.Heights[i];
                if (mouse.Y < s.Top - amt - 12 * S) continue;
                s.Heights[i] = 0;
                float kick = -Math.Abs(mouseV.X) * 0.15f - (60 + (float)Rnd.NextDouble() * 120) * S;
                Emit(s.ColX(i), s.Top, amt, new PointF(mouseV.X * 0.5f, kick), 50 * S, s.Id);
            }
        }
    }

    // MARK: Комки

    void Shed(Surface s, float fraction, RectangleF f, PointF v, float spread, bool ignore)
    {
        for (int i = 0; i < s.Heights.Length; i++)
        {
            float amt = s.Heights[i] * fraction;
            if (amt < 0.4f) continue;
            s.Heights[i] -= amt;
            Emit(f.Left + (i + 0.5f) * ColW, f.Top - s.Heights[i], amt, v, spread, ignore ? s.Id : long.MinValue);
        }
    }

    void Emit(float x, float top, float amount, PointF v, float spread, long ignoreId)
    {
        int count = Math.Max(1, (int)(amount / (1.8f * S) + Rnd.NextDouble()));
        for (int k = 0; k < count; k++)
        {
            if (Flakes.Count >= MaxFlakes) return;
            Flakes.Add(new Flake
            {
                X = x + ((float)Rnd.NextDouble() * 3 - 1.5f) * S,
                Y = top - (float)Rnd.NextDouble() * Math.Max(amount, 0.1f),
                Vx = v.X + ((float)Rnd.NextDouble() * 2 - 1) * spread,
                Vy = v.Y + ((float)Rnd.NextDouble() * 1.4f - 1) * spread,
                R = (1.1f + (float)Rnd.NextDouble() * 1.1f) * S, Loose = true, Alpha = 1,
                IgnoreId = ignoreId, IgnoreUntil = T + 0.5,
            });
        }
    }

    public void AddLoose(float x, float y, float vx, float vy, float r) =>
        Flakes.Add(new Flake { X = x, Y = y, Vx = vx, Vy = vy, R = r, Loose = true, Alpha = 1, IgnoreId = long.MinValue });

    public void ShakeAll()
    {
        foreach (var s in Order) Shed(s, 1, s.Frame, new PointF(0, -120 * S), 140 * S, true);
    }

    static float Len(PointF p) => MathF.Sqrt(p.X * p.X + p.Y * p.Y);
    static PointF Mul(PointF p, float k) => new(p.X * k, p.Y * k);

    // MARK: Сюрприз — ракета в панель задач, снег собирается в слово

    public List<WordFlake> Word = new();
    public List<PointF> WordPoints = new();
    public List<Puff> Puffs = new();
    public double SurpriseStart = -1, ImpactTime = -1;
    public PointF RocketFrom, RocketTo;
    public const double RocketDuration = 1.3;
    const float WordHold = 5.8f;

    /// textPoints — точки букв относительно центра надписи (готовит Renderer).
    public void LaunchSurprise(List<PointF> textPoints)
    {
        var sc = desk.Screens.FirstOrDefault();
        if (sc.IsEmpty) return;
        var impact = TaskbarSurface != null
            ? new PointF(TaskbarSurface.Frame.Left + TaskbarSurface.Frame.Width / 2, TaskbarSurface.Top)
            : new PointF(sc.Left + sc.Width / 2, sc.Bottom - 4 * S);
        RocketFrom = new PointF(sc.Left + sc.Width / 2, sc.Top - 90 * S);
        RocketTo = impact;
        SurpriseStart = T; ImpactTime = -1;
        Word.Clear();
        WordPoints = textPoints.Select(p => new PointF(sc.Left + sc.Width / 2 + p.X, sc.Top + sc.Height * 0.38f + p.Y)).ToList();
    }

    public PointF RocketPos()
    {
        float p = (float)Math.Min(1, (T - SurpriseStart) / RocketDuration), e = p * p;
        return new PointF(RocketFrom.X + (RocketTo.X - RocketFrom.X) * e, RocketFrom.Y + (RocketTo.Y - RocketFrom.Y) * e);
    }

    void UpdateSurprise(float dt)
    {
        for (int i = 0; i < Puffs.Count; i++)
        {
            var p = Puffs[i]; p.Life -= dt; p.R += 16 * S * dt; p.Y -= 12 * S * dt; Puffs[i] = p;
        }
        Puffs.RemoveAll(p => p.Life <= 0);
        if (SurpriseStart < 0) return;
        if (ImpactTime < 0)
        {
            if (T - SurpriseStart < RocketDuration)
            {
                var p = RocketPos();
                Puffs.Add(new Puff { X = p.X + ((float)Rnd.NextDouble() * 10 - 5) * S, Y = p.Y - 80 * S, R = (4 + (float)Rnd.NextDouble() * 4) * S, Life = 0.9f, MaxLife = 0.9f });
            }
            else Explode();
            return;
        }
        float it = (float)(T - ImpactTime);
        for (int i = 0; i < Word.Count; i++)
        {
            var w = Word[i];
            float local = it - w.Delay;
            if (local < 0.55f)
            {
                w.Vy += 500 * S * dt; w.Vx *= 1 - 1.2f * dt; w.Vy *= 1 - 1.2f * dt;
                w.X += w.Vx * dt; w.Y += w.Vy * dt;
            }
            else
            {
                float k = Math.Min(9, 2 + (local - 0.55f) * 6), a = Math.Min(1, k * dt);
                w.X += (w.Tx - w.X) * a; w.Y += (w.Ty - w.Y) * a;
            }
            Word[i] = w;
        }
        if (it > WordHold) ReleaseWord();
    }

    void Explode()
    {
        ImpactTime = T;
        var c = RocketTo;
        if (TaskbarSurface != null) Shed(TaskbarSurface, 0.9f, TaskbarSurface.Frame, new PointF(0, -500 * S), 300 * S, true);
        Word = WordPoints.Select(p =>
        {
            double ang = Math.PI * (1.05 + Rnd.NextDouble() * 0.9);
            float sp = (400 + (float)Rnd.NextDouble() * 700) * S;
            return new WordFlake
            {
                X = c.X, Y = c.Y - 4, Vx = (float)Math.Cos(ang) * sp, Vy = (float)Math.Sin(ang) * sp,
                Tx = p.X, Ty = p.Y, R = (1.8f + (float)Rnd.NextDouble() * 1.2f) * S, Delay = (float)Rnd.NextDouble() * 0.35f,
            };
        }).ToList();
        for (int k = 0; k < 350; k++)
        {
            double ang = Math.PI * (1 + Rnd.NextDouble());
            float sp = (200 + (float)Rnd.NextDouble() * 700) * S;
            AddLoose(c.X, c.Y - 4, (float)Math.Cos(ang) * sp, (float)Math.Sin(ang) * sp, (1.2f + (float)Rnd.NextDouble() * 1.4f) * S);
        }
    }

    void ReleaseWord()
    {
        foreach (var w in Word) AddLoose(w.X, w.Y, ((float)Rnd.NextDouble() * 50 - 25) * S, (float)Rnd.NextDouble() * 40 * S, w.R * 0.8f);
        Word.Clear();
        SurpriseStart = -1; ImpactTime = -1;
    }
}
