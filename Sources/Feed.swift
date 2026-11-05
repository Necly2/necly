import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(FoundationXML)
import FoundationXML
#endif

struct Headline {
    var title: String
    var link: URL?
    var date: Date?
}

struct FeedResult {
    var siteName: String
    var items: [Headline]
    var feedURL: URL
    var isRSS: Bool
}

enum FeedError: LocalizedError {
    case nothingFound
    var errorDescription: String? { "Не удалось найти заголовки на этом сайте" }
}

enum FeedLoader {
    /// Известные RSS-ленты сайтов, которые не указывают их на главной странице.
    static let knownFeeds: [(String, String)] = [
        ("rbc.ru", "https://rssexport.rbc.ru/rbcnews/news/30/full.rss"),
        ("kommersant.ru", "https://www.kommersant.ru/RSS/news.xml"),
        ("habr.com", "https://habr.com/ru/rss/articles/"),
        ("ria.ru", "https://ria.ru/export/rss2/archive/index.xml"),
        ("tass.ru", "https://tass.ru/rss/v2.xml"),
        ("vedomosti.ru", "https://www.vedomosti.ru/rss/news"),
        ("interfax.ru", "https://www.interfax.ru/rss"),
        ("lenta.ru", "https://lenta.ru/rss"),
    ]
    static let commonPaths = ["/rss", "/rss/", "/feed", "/feed/", "/rss.xml", "/feed.xml", "/index.xml", "/atom.xml"]

    /// По ссылке на сайт (или прямо на RSS) находит заголовки.
    static func load(_ input: URL) async throws -> FeedResult {
        let host = input.host ?? input.absoluteString

        // 1. Ссылка сама является RSS/Atom?
        let page = try await fetch(input)
        if let feed = FeedParser.parse(page), feed.items.count >= 1 {
            return FeedResult(siteName: feed.title ?? host, items: feed.items, feedURL: input, isRSS: true)
        }

        // 2. Кандидаты: <link rel="alternate">, известные ленты, стандартные адреса.
        let html = decode(page)
        var candidates: [URL] = discoverLinks(in: html, base: input)
        for (domain, feed) in knownFeeds where host == domain || host.hasSuffix("." + domain) {
            if let u = URL(string: feed) { candidates.append(u) }
        }
        if var comps = URLComponents(url: input, resolvingAgainstBaseURL: false) {
            for p in commonPaths {
                comps.path = p
                comps.query = nil
                if let u = comps.url { candidates.append(u) }
            }
        }
        var tried = Set<String>()
        for c in candidates where !tried.contains(c.absoluteString) {
            tried.insert(c.absoluteString)
            guard let data = try? await fetch(c), let feed = FeedParser.parse(data), feed.items.count >= 3 else { continue }
            return FeedResult(siteName: feed.title ?? host, items: feed.items, feedURL: c, isRSS: true)
        }

        // 3. Нет RSS — собираем заголовки прямо со страницы.
        let scraped = scrape(html, base: input)
        if scraped.count >= 3 {
            return FeedResult(siteName: host, items: scraped, feedURL: input, isRSS: false)
        }
        throw FeedError.nothingFound
    }

    static func fetch(_ url: URL) async throws -> Data {
        var req = URLRequest(url: url, timeoutInterval: 20)
        req.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
                     forHTTPHeaderField: "User-Agent")
        req.setValue("text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
                     forHTTPHeaderField: "Accept")
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw URLError(.badServerResponse)
        }
        return data
    }

    static func decode(_ data: Data) -> String {
        if let s = String(data: data, encoding: .utf8) { return s }
        if let s = String(data: data, encoding: .windowsCP1251) { return s }
        return String(decoding: data, as: UTF8.self)
    }

    static func discoverLinks(in html: String, base: URL) -> [URL] {
        var out: [URL] = []
        let tagRe = try! NSRegularExpression(pattern: "<link\\b[^>]*>", options: [.caseInsensitive])
        let hrefRe = try! NSRegularExpression(pattern: "href\\s*=\\s*[\"']([^\"']+)[\"']", options: [.caseInsensitive])
        let ns = html as NSString
        for m in tagRe.matches(in: html, range: NSRange(location: 0, length: ns.length)) {
            let tag = ns.substring(with: m.range)
            let lower = tag.lowercased()
            guard lower.contains("rss+xml") || lower.contains("atom+xml") else { continue }
            let tns = tag as NSString
            if let h = hrefRe.firstMatch(in: tag, range: NSRange(location: 0, length: tns.length)) {
                let href = Entities.decode(tns.substring(with: h.range(at: 1)))
                if let u = URL(string: href, relativeTo: base)?.absoluteURL { out.append(u) }
            }
        }
        return out
    }

    /// Запасной вариант: ссылки на странице, похожие на заголовки новостей.
    static func scrape(_ html: String, base: URL) -> [Headline] {
        let re = try! NSRegularExpression(pattern: "<a\\b[^>]*?href\\s*=\\s*[\"']([^\"'#]+)[\"'][^>]*>(.*?)</a>",
                                          options: [.caseInsensitive, .dotMatchesLineSeparators])
        let tagStrip = try! NSRegularExpression(pattern: "<[^>]+>", options: [])
        let ns = html as NSString
        var seen = Set<String>()
        var items: [Headline] = []
        for m in re.matches(in: html, range: NSRange(location: 0, length: ns.length)) {
            let href = Entities.decode(ns.substring(with: m.range(at: 1)))
            var text = ns.substring(with: m.range(at: 2))
            text = tagStrip.stringByReplacingMatches(in: text, range: NSRange(location: 0, length: (text as NSString).length), withTemplate: " ")
            text = Entities.decode(text).components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
            let words = text.split(separator: " ").count
            guard text.count >= 25, text.count <= 220, words >= 4, !seen.contains(text) else { continue }
            guard let url = URL(string: href, relativeTo: base)?.absoluteURL,
                  let h = url.host, let bh = base.host,
                  h == bh || h.hasSuffix("." + bh) || bh.hasSuffix("." + h) else { continue }
            seen.insert(text)
            items.append(Headline(title: text, link: url, date: nil))
            if items.count >= 40 { break }
        }
        return items
    }
}

enum Entities {
    static let map: [String: String] = [
        "&amp;": "&", "&quot;": "\"", "&#39;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">",
        "&nbsp;": " ", "&laquo;": "«", "&raquo;": "»", "&mdash;": "—", "&ndash;": "–",
        "&hellip;": "…", "&#171;": "«", "&#187;": "»", "&#8212;": "—", "&#8211;": "–", "&#160;": " ",
    ]
    static func decode(_ s: String) -> String {
        guard s.contains("&") else { return s }
        var r = s
        for (k, v) in map { r = r.replacingOccurrences(of: k, with: v) }
        return r
    }
}

/// Разбор RSS 2.0 и Atom.
final class FeedParser: NSObject, XMLParserDelegate {
    private(set) var title: String?
    private(set) var items: [Headline] = []
    private var isFeed = false
    private var inItem = false
    private var text = ""
    private var cur = Headline(title: "", link: nil, date: nil)

    static func parse(_ data: Data) -> (title: String?, items: [Headline])? {
        // Быстрая проверка, что это вообще XML-лента.
        let head = String(decoding: data.prefix(2048), as: UTF8.self).lowercased()
        guard head.contains("<rss") || head.contains("<feed") || head.contains("<rdf") else { return nil }
        let p = FeedParser()
        let xp = XMLParser(data: data)
        xp.delegate = p
        xp.parse()
        guard p.isFeed else { return nil }
        var items = p.items.filter { !$0.title.isEmpty }
        if items.contains(where: { $0.date != nil }) {
            items.sort { ($0.date ?? .distantPast) > ($1.date ?? .distantPast) }
        }
        return (p.title, Array(items.prefix(40)))
    }

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?,
                qualifiedName qName: String?, attributes: [String: String] = [:]) {
        let n = name.lowercased()
        if n == "rss" || n == "feed" || n == "rdf:rdf" || n == "rdf" { isFeed = true }
        if n == "item" || n == "entry" {
            inItem = true
            cur = Headline(title: "", link: nil, date: nil)
        }
        if inItem && n == "link", let href = attributes["href"] {
            let rel = attributes["rel"] ?? "alternate"
            if rel == "alternate" || cur.link == nil { cur.link = URL(string: href) }
        }
        text = ""
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) { text += string }

    func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
        text += String(decoding: CDATABlock, as: UTF8.self)
    }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName qName: String?) {
        let n = name.lowercased()
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if inItem {
            switch n {
            case "title":
                cur.title = Entities.decode(value).components(separatedBy: .whitespacesAndNewlines)
                    .filter { !$0.isEmpty }.joined(separator: " ")
            case "link":
                if cur.link == nil, !value.isEmpty { cur.link = URL(string: value) }
            case "pubdate", "published", "updated", "dc:date", "date":
                if cur.date == nil { cur.date = DateParser.parse(value) }
            case "item", "entry":
                items.append(cur)
                inItem = false
            default: break
            }
        } else if n == "title", title == nil, !value.isEmpty {
            title = Entities.decode(value)
        }
        text = ""
    }
}

enum DateParser {
    static let rfc822: [DateFormatter] = ["EEE, dd MMM yyyy HH:mm:ss Z", "EEE, d MMM yyyy HH:mm:ss Z",
                                          "dd MMM yyyy HH:mm:ss Z", "EEE, dd MMM yyyy HH:mm Z"].map {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = $0
        return f
    }
    static func parse(_ s: String) -> Date? {
        for f in rfc822 { if let d = f.date(from: s) { return d } }
        let iso = ISO8601DateFormatter()
        if let d = iso.date(from: s) { return d }
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return iso.date(from: s)
    }
}
