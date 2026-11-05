import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

struct Quote {
    enum Kind { case stock, index, currency }
    let symbol: String
    let value: Double
    let changePct: Double?
    let kind: Kind
    var link: URL? {
        switch kind {
        case .stock: return URL(string: "https://www.moex.com/ru/issue.aspx?code=\(symbol)")
        case .index: return URL(string: "https://www.moex.com/ru/index/\(symbol)")
        case .currency: return URL(string: "https://www.cbr.ru/currency_base/daily/")
        }
    }
}

/// Котировки без ключей и регистрации: акции и индекс — Мосбиржа (ISS), валюты — курсы ЦБ.
enum QuoteLoader {
    static func load(stocks: [String], index: Bool, currencies: [String]) async -> [Quote] {
        var out: [Quote] = []
        if index, let q = await loadIndex() { out.append(q) }
        out += await loadCurrencies(currencies)
        out += await loadStocks(stocks)
        return out
    }

    static func json(_ url: String) async -> [String: Any]? {
        guard let u = URL(string: url) else { return nil }
        var req = URLRequest(url: u, timeoutInterval: 15)
        req.setValue("Lenta/0.2 (macOS)", forHTTPHeaderField: "User-Agent")
        guard let (data, _) = try? await lightSession.data(for: req) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /// Таблица ISS {"marketdata": {"columns": [...], "data": [[...]]}} → массив словарей.
    static func rows(_ obj: [String: Any]?, _ block: String) -> [[String: Any]] {
        guard let b = obj?[block] as? [String: Any],
              let cols = b["columns"] as? [String],
              let data = b["data"] as? [[Any]] else { return [] }
        return data.map { row in
            var d: [String: Any] = [:]
            for (i, c) in cols.enumerated() where i < row.count { d[c] = row[i] }
            return d
        }
    }

    static func num(_ v: Any?) -> Double? {
        if let n = v as? NSNumber { return n.doubleValue }
        if let d = v as? Double { return d }
        return nil
    }

    static func loadStocks(_ tickers: [String]) async -> [Quote] {
        let list = tickers.map { $0.uppercased() }.filter { !$0.isEmpty }
        guard !list.isEmpty else { return [] }
        let url = "https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json"
            + "?iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,LAST,LCURRENTPRICE,LASTTOPREVPRICE,MARKETPRICE"
            + "&securities=" + list.joined(separator: ",")
        var bySymbol: [String: Quote] = [:]
        for r in rows(await json(url), "marketdata") {
            guard let id = r["SECID"] as? String,
                  let price = num(r["LAST"]) ?? num(r["LCURRENTPRICE"]) ?? num(r["MARKETPRICE"]) else { continue }
            bySymbol[id] = Quote(symbol: id, value: price, changePct: num(r["LASTTOPREVPRICE"]), kind: .stock)
        }
        return list.compactMap { bySymbol[$0] }   // в том порядке, как указал пользователь
    }

    static func loadIndex() async -> Quote? {
        let url = "https://iss.moex.com/iss/engines/stock/markets/index/securities/IMOEX.json"
            + "?iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,CURRENTVALUE,LASTVALUE,LASTCHANGEPRC"
        guard let r = rows(await json(url), "marketdata").first,
              let v = num(r["CURRENTVALUE"]) ?? num(r["LASTVALUE"]) else { return nil }
        return Quote(symbol: "IMOEX", value: v, changePct: num(r["LASTCHANGEPRC"]), kind: .index)
    }

    static func loadCurrencies(_ codes: [String]) async -> [Quote] {
        guard !codes.isEmpty,
              let obj = await json("https://www.cbr-xml-daily.ru/daily_json.js"),
              let valute = obj["Valute"] as? [String: Any] else { return [] }
        return codes.compactMap { code in
            guard let v = valute[code] as? [String: Any],
                  let value = num(v["Value"]), let nominal = num(v["Nominal"]), nominal > 0 else { return nil }
            var change: Double? = nil
            if let prev = num(v["Previous"]), prev > 0 { change = (value - prev) / prev * 100 }
            return Quote(symbol: code, value: value / nominal, changePct: change, kind: .currency)
        }
    }

    /// «291,57» / «2 429,90» — по-русски.
    static func format(_ v: Double) -> String {
        let digits = v < 10 ? 4 : 2
        let raw = String(format: "%.\(digits)f", v)
        let parts = raw.split(separator: ".")
        var intPart = String(parts[0])
        var neg = false
        if intPart.hasPrefix("-") { neg = true; intPart.removeFirst() }
        var grouped = ""
        for (i, ch) in intPart.reversed().enumerated() {
            if i > 0 && i % 3 == 0 { grouped.append("\u{2009}") }   // тонкий пробел между разрядами
            grouped.append(ch)
        }
        let res = String(grouped.reversed()) + (parts.count > 1 ? "," + parts[1] : "")
        return neg ? "−" + res : res
    }
}
