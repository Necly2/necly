using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;

namespace Lenta;

public enum QuoteKind { Stock, Index, Currency }

public record Quote(string Symbol, double Value, double? ChangePct, QuoteKind Kind)
{
    public Uri Link => Kind switch
    {
        QuoteKind.Stock => new Uri($"https://www.moex.com/ru/issue.aspx?code={Symbol}"),
        QuoteKind.Index => new Uri($"https://www.moex.com/ru/index/{Symbol}"),
        _ => new Uri("https://www.cbr.ru/currency_base/daily/"),
    };
}

/// Котировки без ключей: акции и индекс — Мосбиржа (ISS), валюты — курсы ЦБ.
public static class QuoteLoader
{
    public static async Task<List<Quote>> Load(IList<string> stocks, bool index, IList<string> currencies)
    {
        var res = new List<Quote>();
        if (index) { var q = await LoadIndex(); if (q != null) res.Add(q); }
        res.AddRange(await LoadCurrencies(currencies));
        res.AddRange(await LoadStocks(stocks));
        return res;
    }

    static async Task<JsonDocument?> Json(string url)
    {
        try { return JsonDocument.Parse(await Http.GetBytes(new Uri(url))); }
        catch { return null; }
    }

    /// Таблица ISS {"marketdata": {"columns": [...], "data": [[...]]}} → строки-словари.
    static List<Dictionary<string, JsonElement>> Rows(JsonDocument? doc, string block)
    {
        var res = new List<Dictionary<string, JsonElement>>();
        if (doc == null || !doc.RootElement.TryGetProperty(block, out var b)) return res;
        var cols = b.GetProperty("columns").EnumerateArray().Select(c => c.GetString() ?? "").ToList();
        foreach (var row in b.GetProperty("data").EnumerateArray())
        {
            var d = new Dictionary<string, JsonElement>();
            int i = 0;
            foreach (var v in row.EnumerateArray()) { if (i < cols.Count) d[cols[i]] = v; i++; }
            res.Add(d);
        }
        return res;
    }

    static double? Num(Dictionary<string, JsonElement> r, string key) =>
        r.TryGetValue(key, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;

    static async Task<List<Quote>> LoadStocks(IList<string> tickers)
    {
        var list = tickers.Select(t => t.Trim().ToUpperInvariant()).Where(t => t.Length > 0).ToList();
        if (list.Count == 0) return new();
        var url = "https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json"
                  + "?iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,LAST,LCURRENTPRICE,LASTTOPREVPRICE,MARKETPRICE"
                  + "&securities=" + string.Join(",", list);
        var by = new Dictionary<string, Quote>();
        foreach (var r in Rows(await Json(url), "marketdata"))
        {
            if (!r.TryGetValue("SECID", out var id) || id.GetString() is not string sec) continue;
            var price = Num(r, "LAST") ?? Num(r, "LCURRENTPRICE") ?? Num(r, "MARKETPRICE");
            if (price == null) continue;
            by[sec] = new Quote(sec, price.Value, Num(r, "LASTTOPREVPRICE"), QuoteKind.Stock);
        }
        return list.Where(by.ContainsKey).Select(t => by[t]).ToList();
    }

    static async Task<Quote?> LoadIndex()
    {
        var url = "https://iss.moex.com/iss/engines/stock/markets/index/securities/IMOEX.json"
                  + "?iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,CURRENTVALUE,LASTVALUE,LASTCHANGEPRC";
        var r = Rows(await Json(url), "marketdata").FirstOrDefault();
        if (r == null) return null;
        var v = Num(r, "CURRENTVALUE") ?? Num(r, "LASTVALUE");
        return v == null ? null : new Quote("IMOEX", v.Value, Num(r, "LASTCHANGEPRC"), QuoteKind.Index);
    }

    static async Task<List<Quote>> LoadCurrencies(IList<string> codes)
    {
        var res = new List<Quote>();
        if (codes.Count == 0) return res;
        var doc = await Json("https://www.cbr-xml-daily.ru/daily_json.js");
        if (doc == null || !doc.RootElement.TryGetProperty("Valute", out var val)) return res;
        foreach (var code in codes)
        {
            if (!val.TryGetProperty(code, out var v)) continue;
            double value = v.GetProperty("Value").GetDouble(), nominal = v.GetProperty("Nominal").GetDouble();
            double? change = null;
            if (v.TryGetProperty("Previous", out var p) && p.GetDouble() > 0) change = (value - p.GetDouble()) / p.GetDouble() * 100;
            if (nominal > 0) res.Add(new Quote(code, value / nominal, change, QuoteKind.Currency));
        }
        return res;
    }

    /// «291,57» / «2 430,07» — по-русски, с тонким пробелом между разрядами.
    public static string Format(double v)
    {
        var nf = (NumberFormatInfo)CultureInfo.GetCultureInfo("ru-RU").NumberFormat.Clone();
        nf.NumberGroupSeparator = " ";
        return v.ToString(v < 10 ? "N4" : "N2", nf);
    }
}
