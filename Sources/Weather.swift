import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Текущая погода, приведённая к тому, что умеет рисовать «Сугроб».
struct WeatherNow {
    enum Kind { case clear, cloudy, fog, rain, snow, sleet }
    var kind: Kind
    var intensity: Int        // 0 слабый, 1 умеренный, 2 сильный
    var tempC: Double
    var isNight: Bool
    var source: String

    var description: String {
        let level = ["небольшой ", "", "сильный "][max(0, min(2, intensity))]
        switch kind {
        case .clear: return isNight ? "ясно, ночь" : "ясно"
        case .cloudy: return "облачно"
        case .fog: return "туман"
        case .rain: return level + "дождь"
        case .snow: return level + "снег"
        case .sleet: return "мокрый снег"
        }
    }

    var tempText: String {
        let t = Int(tempC.rounded())
        return (t > 0 ? "+" : t < 0 ? "−" : "") + "\(abs(t))°"
    }
}

/// Открытые сервисы погоды без ключей: Open-Meteo, запасной — MET Norway.
enum WeatherService {
    static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.urlCache = nil
        c.timeoutIntervalForRequest = 15
        return URLSession(configuration: c)
    }()

    static func json(_ url: String) async -> Any? {
        guard let u = URL(string: url) else { return nil }
        var req = URLRequest(url: u)
        req.setValue("Sugrob/0.3 (github.com/Necly2/necly)", forHTTPHeaderField: "User-Agent")
        guard let (data, resp) = try? await session.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode ?? 200 < 400 else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    /// Город → координаты (Open-Meteo Geocoding).
    static func geocode(_ name: String) async -> (name: String, lat: Double, lon: Double)? {
        let q = name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? name
        guard let obj = await json("https://geocoding-api.open-meteo.com/v1/search?name=\(q)&count=1&language=ru&format=json") as? [String: Any],
              let r = (obj["results"] as? [[String: Any]])?.first,
              let lat = (r["latitude"] as? NSNumber)?.doubleValue,
              let lon = (r["longitude"] as? NSNumber)?.doubleValue else { return nil }
        return ((r["name"] as? String) ?? name, lat, lon)
    }

    static func current(lat: Double, lon: Double) async -> WeatherNow? {
        if let w = await openMeteo(lat: lat, lon: lon) { return w }
        return await metNorway(lat: lat, lon: lon)
    }

    static func openMeteo(lat: Double, lon: Double) async -> WeatherNow? {
        let url = "https://api.open-meteo.com/v1/forecast?latitude=\(lat)&longitude=\(lon)"
            + "&current=temperature_2m,weather_code,is_day&timezone=auto"
        guard let obj = await json(url) as? [String: Any],
              let cur = obj["current"] as? [String: Any],
              let code = (cur["weather_code"] as? NSNumber)?.intValue,
              let t = (cur["temperature_2m"] as? NSNumber)?.doubleValue else { return nil }
        let night = ((cur["is_day"] as? NSNumber)?.intValue ?? 1) == 0
        let (kind, intensity) = fromWMO(code)
        return WeatherNow(kind: kind, intensity: intensity, tempC: t, isNight: night, source: "Open-Meteo")
    }

    /// Коды погоды WMO → вид и сила осадков.
    static func fromWMO(_ c: Int) -> (WeatherNow.Kind, Int) {
        switch c {
        case 0, 1: return (.clear, 0)
        case 2, 3: return (.cloudy, 0)
        case 45, 48: return (.fog, 0)
        case 51, 53, 55, 56, 57: return (.rain, 0)
        case 61, 80: return (.rain, 0)
        case 63, 81, 66: return (.rain, 1)
        case 65, 82, 67, 95, 96, 99: return (.rain, 2)
        case 71, 77, 85: return (.snow, 0)
        case 73: return (.snow, 1)
        case 75, 86: return (.snow, 2)
        default: return (.cloudy, 0)
        }
    }

    static func metNorway(lat: Double, lon: Double) async -> WeatherNow? {
        let url = String(format: "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=%.3f&lon=%.3f", lat, lon)
        guard let obj = await json(url) as? [String: Any],
              let props = obj["properties"] as? [String: Any],
              let ts = (props["timeseries"] as? [[String: Any]])?.first,
              let data = ts["data"] as? [String: Any],
              let inst = (data["instant"] as? [String: Any])?["details"] as? [String: Any],
              let t = (inst["air_temperature"] as? NSNumber)?.doubleValue else { return nil }
        let sym = ((data["next_1_hours"] as? [String: Any])?["summary"] as? [String: Any])?["symbol_code"] as? String ?? "cloudy"
        let (kind, intensity) = fromMET(sym)
        return WeatherNow(kind: kind, intensity: intensity, tempC: t, isNight: sym.hasSuffix("_night"), source: "MET Norway")
    }

    /// «lightsnowshowers_night», «heavyrain», «clearsky_day» → вид и сила.
    static func fromMET(_ s: String) -> (WeatherNow.Kind, Int) {
        let intensity = s.hasPrefix("light") ? 0 : s.hasPrefix("heavy") ? 2 : 1
        if s.contains("sleet") { return (.sleet, intensity) }
        if s.contains("snow") { return (.snow, intensity) }
        if s.contains("rain") { return (.rain, intensity) }
        if s.hasPrefix("clearsky") || s.hasPrefix("fair") { return (.clear, 0) }
        if s.hasPrefix("fog") { return (.fog, 0) }
        return (.cloudy, 0)
    }
}
