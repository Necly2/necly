using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Xml.Linq;

namespace Lenta;

/// Source — короткое название источника («РБК»), когда их несколько.
public record Headline(string Title, Uri? Link, DateTimeOffset? Date, string? Source = null);

public record FeedResult(string SiteName, List<Headline> Items, Uri FeedUrl, bool IsRss);

public static class Http
{
    public static readonly HttpClient Client = Create();

    static HttpClient Create()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);   // windows-1251
        var h = new HttpClientHandler { AutomaticDecompression = DecompressionMethods.All, AllowAutoRedirect = true };
        var c = new HttpClient(h) { Timeout = TimeSpan.FromSeconds(20) };
        c.DefaultRequestHeaders.UserAgent.ParseAdd(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36");
        c.DefaultRequestHeaders.Accept.ParseAdd("text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.8");
        return c;
    }

    public static async Task<byte[]> GetBytes(Uri url)
    {
        using var resp = await Client.GetAsync(url);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadAsByteArrayAsync();
    }
}

public static class FeedLoader
{
    /// Известные RSS-ленты сайтов, которые не указывают их на главной странице.
    static readonly (string Domain, string Feed)[] KnownFeeds =
    {
        ("rbc.ru", "https://rssexport.rbc.ru/rbcnews/news/30/full.rss"),
        ("kommersant.ru", "https://www.kommersant.ru/RSS/news.xml"),
        ("habr.com", "https://habr.com/ru/rss/articles/"),
        ("ria.ru", "https://ria.ru/export/rss2/archive/index.xml"),
        ("tass.ru", "https://tass.ru/rss/v2.xml"),
        ("vedomosti.ru", "https://www.vedomosti.ru/rss/news"),
        ("interfax.ru", "https://www.interfax.ru/rss"),
        ("lenta.ru", "https://lenta.ru/rss"),
    };
    static readonly string[] CommonPaths = { "/rss", "/rss/", "/feed", "/feed/", "/rss.xml", "/feed.xml", "/index.xml", "/atom.xml" };

    public static async Task<FeedResult> Load(Uri input)
    {
        string host = input.Host;

        // 1. Ссылка сама является RSS/Atom?
        var page = await Http.GetBytes(input);
        var feed = FeedParser.Parse(page);
        if (feed != null && feed.Value.Items.Count >= 1)
            return new FeedResult(feed.Value.Title ?? host, feed.Value.Items, input, true);

        // 2. Кандидаты: <link rel="alternate">, известные ленты, стандартные адреса.
        string html = Decode(page);
        var candidates = DiscoverLinks(html, input);
        foreach (var (domain, f) in KnownFeeds)
            if (host == domain || host.EndsWith("." + domain)) candidates.Add(new Uri(f));
        foreach (var p in CommonPaths)
            candidates.Add(new UriBuilder(input.Scheme, input.Host, input.Port, p).Uri);

        var tried = new HashSet<string>();
        foreach (var c in candidates)
        {
            if (!tried.Add(c.AbsoluteUri)) continue;
            try
            {
                var data = await Http.GetBytes(c);
                var fd = FeedParser.Parse(data);
                if (fd != null && fd.Value.Items.Count >= 3)
                    return new FeedResult(fd.Value.Title ?? host, fd.Value.Items, c, true);
            }
            catch { /* пробуем следующий */ }
        }

        // 3. Нет RSS — собираем заголовки прямо со страницы.
        var scraped = Scrape(html, input);
        if (scraped.Count >= 3) return new FeedResult(host, scraped, input, false);
        throw new Exception("Не удалось найти заголовки на этом сайте");
    }

    public static string Decode(byte[] data)
    {
        try
        {
            return new UTF8Encoding(false, true).GetString(data);
        }
        catch
        {
            return Encoding.GetEncoding(1251).GetString(data);
        }
    }

    static readonly Regex LinkTag = new(@"<link\b[^>]*>", RegexOptions.IgnoreCase);
    static readonly Regex Href = new(@"href\s*=\s*[""']([^""']+)[""']", RegexOptions.IgnoreCase);

    public static List<Uri> DiscoverLinks(string html, Uri baseUri)
    {
        var res = new List<Uri>();
        foreach (Match m in LinkTag.Matches(html))
        {
            var tag = m.Value.ToLowerInvariant();
            if (!tag.Contains("rss+xml") && !tag.Contains("atom+xml")) continue;
            var h = Href.Match(m.Value);
            if (h.Success && Uri.TryCreate(baseUri, WebUtility.HtmlDecode(h.Groups[1].Value), out var u)) res.Add(u);
        }
        return res;
    }

    static readonly Regex Anchor = new(@"<a\b[^>]*?href\s*=\s*[""']([^""'#]+)[""'][^>]*>(.*?)</a>",
        RegexOptions.IgnoreCase | RegexOptions.Singleline);
    static readonly Regex Tags = new(@"<[^>]+>");
    static readonly Regex Spaces = new(@"\s+");

    /// Запасной вариант: ссылки на странице, похожие на заголовки новостей.
    public static List<Headline> Scrape(string html, Uri baseUri)
    {
        var seen = new HashSet<string>();
        var items = new List<Headline>();
        foreach (Match m in Anchor.Matches(html))
        {
            var text = Spaces.Replace(WebUtility.HtmlDecode(Tags.Replace(m.Groups[2].Value, " ")), " ").Trim();
            int words = text.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length;
            if (text.Length < 25 || text.Length > 220 || words < 4 || seen.Contains(text)) continue;
            if (!Uri.TryCreate(baseUri, WebUtility.HtmlDecode(m.Groups[1].Value), out var url)) continue;
            string h = url.Host, bh = baseUri.Host;
            if (!(h == bh || h.EndsWith("." + bh) || bh.EndsWith("." + h))) continue;
            seen.Add(text);
            items.Add(new Headline(text, url, null));
            if (items.Count >= 40) break;
        }
        return items;
    }
}

/// Разбор RSS 2.0, RDF и Atom.
public static class FeedParser
{
    public static (string? Title, List<Headline> Items)? Parse(byte[] data)
    {
        var head = Encoding.UTF8.GetString(data, 0, Math.Min(data.Length, 2048)).ToLowerInvariant();
        if (!head.Contains("<rss") && !head.Contains("<feed") && !head.Contains("<rdf")) return null;
        XDocument doc;
        try
        {
            using var ms = new System.IO.MemoryStream(data);
            doc = XDocument.Load(ms);
        }
        catch { return null; }
        var root = doc.Root;
        if (root == null) return null;

        string? title = null;
        var items = new List<Headline>();
        foreach (var el in root.Descendants())
        {
            string name = el.Name.LocalName;
            if (title == null && name == "title" && el.Parent?.Name.LocalName is "channel" or "feed")
                title = Clean(el.Value);
            if (name != "item" && name != "entry") continue;

            string t = Clean(el.Elements().FirstOrDefault(e => e.Name.LocalName == "title")?.Value ?? "");
            if (t.Length == 0) continue;
            Uri? link = null;
            foreach (var l in el.Elements().Where(e => e.Name.LocalName == "link"))
            {
                var href = (string?)l.Attribute("href");
                var rel = (string?)l.Attribute("rel") ?? "alternate";
                var val = href ?? l.Value.Trim();
                if (val.Length > 0 && (rel == "alternate" || link == null) && Uri.TryCreate(val, UriKind.Absolute, out var u)) link = u;
            }
            DateTimeOffset? date = null;
            foreach (var dn in new[] { "pubDate", "published", "updated", "date" })
            {
                var de = el.Elements().FirstOrDefault(e => e.Name.LocalName == dn);
                if (de != null && (date = ParseDate(de.Value.Trim())) != null) break;
            }
            items.Add(new Headline(t, link, date));
        }
        if (items.Any(i => i.Date != null))
            items = items.OrderByDescending(i => i.Date ?? DateTimeOffset.MinValue).ToList();
        return (title, items.Take(40).ToList());
    }

    static string Clean(string s) => Regex.Replace(WebUtility.HtmlDecode(s), @"\s+", " ").Trim();

    static readonly string[] Rfc822 =
    {
        "ddd, dd MMM yyyy HH:mm:ss zzz", "ddd, d MMM yyyy HH:mm:ss zzz", "dd MMM yyyy HH:mm:ss zzz",
        "ddd, dd MMM yyyy HH:mm zzz",
    };

    public static DateTimeOffset? ParseDate(string s)
    {
        if (s.Length == 0) return null;
        // «+0300» → «+03:00», «GMT» → «+00:00» для форматов RFC 822
        var fixedS = Regex.Replace(s, @"([+-]\d{2})(\d{2})$", "$1:$2");
        fixedS = Regex.Replace(fixedS, @"\b(GMT|UT|UTC|Z)$", "+00:00");
        if (DateTimeOffset.TryParseExact(fixedS, Rfc822, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var d))
            return d;
        if (DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out d)) return d;
        return null;
    }
}
