using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;

namespace Sugrob;

public struct RainDrop { public float X, Y, Vx, Vy, Len; }
public struct Splash { public float X, Y, Vx, Vy, Life; }
/// Кристаллик инея: смещение от левого края окна, длина, наклон.
public struct FrostSpike { public float Off, Len, Angle; public bool Branch; }

/// Снеговик на панели задач. Положение — смещение от центра панели.
public class Snowman
{
    public float XFromCenter;
    public DateTime Created;
    public float Build;   // 0…1 — анимация лепки
    public float Melt;    // 0…1 — таяние
}

/// Погода и снеговики — то же, что в версии для macOS.
public partial class Engine
{
    public static readonly string[] WeatherModes = { "Снег всегда", "По погоде в городе", "Дождь (проверка)", "Иней (проверка)" };
    public static readonly string[] SnowmanLifetimes = { "До весны (до 1 марта)", "Тает в оттепель (по погоде)", "1 час", "До выхода из приложения" };
    public static readonly string[] SnowmanStyles = { "Цилиндр и шарф", "Ведро и шарф", "Шапка с помпоном", "Без шапки" };
    public static readonly int[] SnowmanCounts = { 1, 3, 5 };

    public int WeatherMode;          // 0 снег всегда, 1 по погоде, 2 дождь, 3 иней
    public WeatherNow? Weather;
    public List<RainDrop> Drops = new();
    public List<Splash> Splashes = new();
    float rainAcc;
    public float FrostLevel;
    readonly Dictionary<long, FrostSpike[]> frostCache = new();

    public bool SnowmanEnabled = true;
    public int SnowmanLifetime, SnowmanStyle;
    public int MaxSnowmen = 3;
    public List<Snowman> Snowmen = new();
    public Action? OnSnowmenChanged;

    /// Снежинок в секунду на 100 точек ширины.
    public float SnowRate
    {
        get
        {
            if (!Snowing) return 0;
            if (WeatherMode == 0) return Intensity;
            if (WeatherMode != 1 || Weather == null) return 0;
            if (Weather.Kind == WeatherKind.Snow) return new[] { 2f, 4.5f, 10f }[Math.Clamp(Weather.Intensity, 0, 2)];
            return Weather.Kind == WeatherKind.Sleet ? 2 : 0;
        }
    }

    public float RainRate
    {
        get
        {
            if (!Snowing) return 0;
            if (WeatherMode == 2) return 11;
            if (WeatherMode != 1 || Weather == null) return 0;
            if (Weather.Kind == WeatherKind.Rain) return new[] { 5f, 11f, 24f }[Math.Clamp(Weather.Intensity, 0, 2)];
            return Weather.Kind == WeatherKind.Sleet ? 5 : 0;
        }
    }

    bool FrostWanted => WeatherMode == 3 ||
        (WeatherMode == 1 && Weather != null && Weather.Kind == WeatherKind.Clear && Weather.TempC <= -3 && Weather.IsNight);

    float MeltRate
    {
        get
        {
            if (WeatherMode == 2) return 0.12f * S;
            if (WeatherMode != 1 || Weather == null || Weather.TempC <= 1) return 0;
            return (Math.Min(0.6f, (float)(Weather.TempC - 1) * 0.03f) + (Weather.Kind == WeatherKind.Rain ? 0.12f : 0)) * S;
        }
    }

    void UpdateWeatherEffects(float dt)
    {
        FrostLevel = FrostWanted ? Math.Min(1, FrostLevel + dt / 60) : Math.Max(0, FrostLevel - dt / 20);

        float melt = MeltRate * dt;
        if (melt > 0)
            foreach (var s in Order)
            {
                for (int i = 0; i < s.Heights.Length; i++) if (s.Heights[i] > 0) s.Heights[i] = Math.Max(0, s.Heights[i] - melt);
                for (int i = 0; i < s.Heap.Length; i++) if (s.Heap[i] > 0) s.Heap[i] = Math.Max(0, s.Heap[i] - melt * 0.5f);
            }

        float rate = RainRate;
        if (rate > 0 && !Bounds.IsEmpty)
        {
            rainAcc += rate * (Bounds.Width / S) / 100 * dt;
            while (rainAcc >= 1)
            {
                rainAcc -= 1;
                if (Drops.Count >= 1500) { rainAcc = 0; break; }
                Drops.Add(new RainDrop
                {
                    X = Bounds.Left - 150 * S + (float)Rnd.NextDouble() * (Bounds.Width + 200 * S), Y = Bounds.Top - 20 * S,
                    Vx = wind * 4 + 70 * S, Vy = (760 + (float)Rnd.NextDouble() * 220) * S, Len = (10 + (float)Rnd.NextDouble() * 9) * S,
                });
            }
        }

        for (int i = 0; i < Drops.Count;)
        {
            var d = Drops[i];
            float prevY = d.Y;
            d.X += d.Vx * dt; d.Y += d.Vy * dt;
            bool hit = false;
            foreach (var s in Order)
            {
                if (Frozen && !s.IsTaskbar) continue;
                if (s.Column(d.X) is not int c) continue;
                float sy = s.Top + s.Base(c) - s.Total(c);
                if (prevY <= sy && d.Y >= sy && s.Visible[c])
                {
                    hit = true;
                    if (Splashes.Count < 900)
                        for (int k = 0, n = Rnd.Next(2, 5); k < n; k++)
                            Splashes.Add(new Splash
                            {
                                X = d.X, Y = sy - 1, Vx = ((float)Rnd.NextDouble() * 180 - 90) * S,
                                Vy = -(70 + (float)Rnd.NextDouble() * 120) * S, Life = 0.22f + (float)Rnd.NextDouble() * 0.16f,
                            });
                    if (s.Heights[c] > 0) s.Heights[c] = Math.Max(0, s.Heights[c] - 0.15f * S);   // дождь подъедает снег
                    break;
                }
            }
            if (hit || d.Y > Bounds.Bottom + 10) { Drops[i] = Drops[^1]; Drops.RemoveAt(Drops.Count - 1); }
            else { Drops[i] = d; i++; }
        }
        for (int k = 0; k < Splashes.Count;)
        {
            var sp = Splashes[k];
            sp.Vy += 900 * S * dt; sp.X += sp.Vx * dt; sp.Y += sp.Vy * dt; sp.Life -= dt;
            if (sp.Life <= 0) { Splashes[k] = Splashes[^1]; Splashes.RemoveAt(Splashes.Count - 1); }
            else { Splashes[k] = sp; k++; }
        }
    }

    /// Кристаллики инея для окна (одни и те же для одного окна).
    public FrostSpike[] FrostSpikes(Surface s)
    {
        if (frostCache.TryGetValue(s.Id, out var c)) return c;
        var r = new Random((int)(s.Id ^ (s.Id >> 32)) ^ 12345);
        var list = new List<FrostSpike>();
        for (float off = 0; off < 6000 * S;)
        {
            off += (3 + (float)r.NextDouble() * 5) * S;
            list.Add(new FrostSpike
            {
                Off = off, Len = (2.5f + (float)(r.NextDouble() * r.NextDouble()) * 9) * S,
                Angle = ((float)r.NextDouble() - 0.5f) * 1.3f, Branch = r.NextDouble() > 0.55,
            });
        }
        return frostCache[s.Id] = list.ToArray();
    }

    // MARK: Снеговики

    /// Курсор сдвигает снег с панели задач вперёд по ходу движения — в конце получается куча.
    void SweepIntoHeap(Surface s, int i0, int i1)
    {
        if (i0 > i1) return;
        int dir = mouseV.X >= 0 ? 1 : -1, n = s.Heights.Length;
        int ahead = (int)(24 * S / ColW);
        int target = Math.Clamp((dir > 0 ? i1 : i0) + dir * ahead, 0, n - 1);
        float moved = 0;
        for (int i = i0; i <= i1; i++)
        {
            if (!s.Visible[i]) continue;
            if (s.Heights[i] > 0.4f && mouse.Y >= s.Top - s.Heights[i] - 12 * S) { moved += s.Heights[i]; s.Heights[i] = 0; }
            if (s.Heap[i] > 0.2f && i != target) { moved += s.Heap[i]; s.Heap[i] = 0; }
        }
        if (moved <= 0) return;
        s.Heap[target] = Math.Min(s.MaxHeight * 3.2f, s.Heap[target] + moved * 0.85f);
        Emit(s.ColX(target), s.Top - s.Total(target), Math.Min(moved * 0.15f, 6 * S),
             new PointF(mouseV.X * 0.3f, -(60 + (float)Rnd.NextDouble() * 80) * S), 40 * S, s.Id);
    }

    void UpdateSnowmen(float dt)
    {
        if (TaskbarSurface is Surface d)
        {
            var h = d.Heap; int n = h.Length;
            float th = 4 * S;
            for (int i = 0; i < n - 1; i++)
            {
                float diff = h[i] - h[i + 1];
                if (Math.Abs(diff) > th)
                {
                    float m = (Math.Abs(diff) - th) * 0.12f;
                    if (diff > 0) { h[i] -= m; h[i + 1] += m; } else { h[i] += m; h[i + 1] -= m; }
                }
            }
            if (SnowmanEnabled && n > 0)
            {
                int idx = 0;
                for (int i = 1; i < n; i++) if (h[i] > h[idx]) idx = i;
                // Нужна и высокая горка, и много сгребённого снега рядом с ней
                float mass = 0;
                for (int i = 0; i < n; i++) if (Math.Abs(i - idx) * ColW <= 60 * S) mass += h[i];
                if (h[idx] >= d.MaxHeight * 1.25f && mass >= 250 * S)
                {
                    float x = d.ColX(idx), fromCenter = x - (d.Frame.Left + d.Frame.Width / 2);
                    bool free = !Snowmen.Any(sm => Math.Abs(sm.XFromCenter - fromCenter) < 45 * S);
                    if (Snowmen.Count < MaxSnowmen && free)
                    {
                        Snowmen.Add(new Snowman { XFromCenter = fromCenter, Created = DateTime.Now });
                        for (int i = 0; i < n; i++) if (Math.Abs(d.ColX(i) - x) < 32 * S) h[i] = 0;
                        OnSnowmenChanged?.Invoke();
                    }
                }
            }
        }

        var now = DateTime.Now;
        bool spring = now.Month >= 3 && now.Month <= 10;
        foreach (var sm in Snowmen)
        {
            sm.Build = Math.Min(1, sm.Build + dt / 1.2f);
            bool melting = SnowmanLifetime switch
            {
                0 => spring,
                1 => (Weather?.TempC ?? -10) > 2 || WeatherMode == 2,
                2 => (now - sm.Created).TotalSeconds > 3600,
                _ => false,
            };
            if (melting) sm.Melt = Math.Min(1, sm.Melt + dt * (SnowmanLifetime == 1 ? 1f / 600 : 1f / 4));
        }
        if (Snowmen.RemoveAll(sm => sm.Melt >= 1) > 0) OnSnowmenChanged?.Invoke();
    }

    public void BuildSnowmanNow()
    {
        if (TaskbarSurface is not Surface d) return;
        float half = d.Frame.Width / 2 - 30 * S;
        if (half <= 0) return;
        for (int k = 0; k < 20; k++)
        {
            float x = ((float)Rnd.NextDouble() * 2 - 1) * half;
            if (Snowmen.Any(sm => Math.Abs(sm.XFromCenter - x) < 45 * S)) continue;
            if (Snowmen.Count >= MaxSnowmen) Snowmen.RemoveAt(0);
            Snowmen.Add(new Snowman { XFromCenter = x, Created = DateTime.Now });
            OnSnowmenChanged?.Invoke();
            return;
        }
    }

    public void RemoveAllSnowmen()
    {
        Snowmen.Clear();
        OnSnowmenChanged?.Invoke();
    }
}
