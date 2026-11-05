using System;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

namespace Sugrob;

public enum WeatherKind { Clear, Cloudy, Fog, Rain, Snow, Sleet }

/// Текущая погода, приведённая к тому, что умеет рисовать «Сугроб».
public record WeatherNow(WeatherKind Kind, int Intensity, double TempC, bool IsNight, string Source)
{
    public string Description
    {
        get
        {
            var level = new[] { "небольшой ", "", "сильный " }[Math.Clamp(Intensity, 0, 2)];
            return Kind switch
            {
                WeatherKind.Clear => IsNight ? "ясно, ночь" : "ясно",
                WeatherKind.Cloudy => "облачно",
                WeatherKind.Fog => "туман",
                WeatherKind.Rain => level + "дождь",
                WeatherKind.Snow => level + "снег",
                _ => "мокрый снег",
            };
        }
    }

    public string TempText
    {
        get
        {
            int t = (int)Math.Round(TempC);
            return (t > 0 ? "+" : t < 0 ? "−" : "") + Math.Abs(t) + "°";
        }
    }
}

/// Открытые сервисы погоды без ключей: Open-Meteo, запасной — MET Norway.
public static class WeatherService
{
    static readonly HttpClient http = Create();

    static HttpClient Create()
    {
        var c = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        c.DefaultRequestHeaders.UserAgent.ParseAdd("Sugrob/0.3 (github.com/Necly2/necly)");
        return c;
    }

    static async Task<JsonDocument?> Json(string url)
    {
        try
        {
            using var resp = await http.GetAsync(url);
            if (!resp.IsSuccessStatusCode) return null;
            return JsonDocument.Parse(await resp.Content.ReadAsByteArrayAsync());
        }
        catch { return null; }
    }

    public static async Task<(string Name, double Lat, double Lon)?> Geocode(string name)
    {
        var doc = await Json("https://geocoding-api.open-meteo.com/v1/search?name=" + Uri.EscapeDataString(name) + "&count=1&language=ru&format=json");
        if (doc == null || !doc.RootElement.TryGetProperty("results", out var res) || res.GetArrayLength() == 0) return null;
        var r = res[0];
        return (r.TryGetProperty("name", out var n) ? n.GetString() ?? name : name, r.GetProperty("latitude").GetDouble(), r.GetProperty("longitude").GetDouble());
    }

    public static async Task<WeatherNow?> Current(double lat, double lon) =>
        await OpenMeteo(lat, lon) ?? await MetNorway(lat, lon);

    static string F(double v) => v.ToString("0.###", CultureInfo.InvariantCulture);

    static async Task<WeatherNow?> OpenMeteo(double lat, double lon)
    {
        var doc = await Json($"https://api.open-meteo.com/v1/forecast?latitude={F(lat)}&longitude={F(lon)}&current=temperature_2m,weather_code,is_day&timezone=auto");
        if (doc == null || !doc.RootElement.TryGetProperty("current", out var cur)) return null;
        try
        {
            var (kind, inten) = FromWmo(cur.GetProperty("weather_code").GetInt32());
            bool night = cur.TryGetProperty("is_day", out var d) && d.GetInt32() == 0;
            return new WeatherNow(kind, inten, cur.GetProperty("temperature_2m").GetDouble(), night, "Open-Meteo");
        }
        catch { return null; }
    }

    /// Коды погоды WMO → вид и сила осадков.
    public static (WeatherKind, int) FromWmo(int c) => c switch
    {
        0 or 1 => (WeatherKind.Clear, 0),
        2 or 3 => (WeatherKind.Cloudy, 0),
        45 or 48 => (WeatherKind.Fog, 0),
        51 or 53 or 55 or 56 or 57 or 61 or 80 => (WeatherKind.Rain, 0),
        63 or 81 or 66 => (WeatherKind.Rain, 1),
        65 or 82 or 67 or 95 or 96 or 99 => (WeatherKind.Rain, 2),
        71 or 77 or 85 => (WeatherKind.Snow, 0),
        73 => (WeatherKind.Snow, 1),
        75 or 86 => (WeatherKind.Snow, 2),
        _ => (WeatherKind.Cloudy, 0),
    };

    static async Task<WeatherNow?> MetNorway(double lat, double lon)
    {
        var doc = await Json($"https://api.met.no/weatherapi/locationforecast/2.0/compact?lat={lat.ToString("0.000", CultureInfo.InvariantCulture)}&lon={lon.ToString("0.000", CultureInfo.InvariantCulture)}");
        if (doc == null) return null;
        try
        {
            var ts = doc.RootElement.GetProperty("properties").GetProperty("timeseries")[0].GetProperty("data");
            double t = ts.GetProperty("instant").GetProperty("details").GetProperty("air_temperature").GetDouble();
            string sym = "cloudy";
            if (ts.TryGetProperty("next_1_hours", out var n1)) sym = n1.GetProperty("summary").GetProperty("symbol_code").GetString() ?? sym;
            var (kind, inten) = FromMet(sym);
            return new WeatherNow(kind, inten, t, sym.EndsWith("_night"), "MET Norway");
        }
        catch { return null; }
    }

    /// «lightsnowshowers_night», «heavyrain», «clearsky_day» → вид и сила.
    public static (WeatherKind, int) FromMet(string s)
    {
        int inten = s.StartsWith("light") ? 0 : s.StartsWith("heavy") ? 2 : 1;
        if (s.Contains("sleet")) return (WeatherKind.Sleet, inten);
        if (s.Contains("snow")) return (WeatherKind.Snow, inten);
        if (s.Contains("rain")) return (WeatherKind.Rain, inten);
        if (s.StartsWith("clearsky") || s.StartsWith("fair")) return (WeatherKind.Clear, 0);
        if (s.StartsWith("fog")) return (WeatherKind.Fog, 0);
        return (WeatherKind.Cloudy, 0);
    }
}
