using System;
using System.Collections.Generic;
using System.Linq;

namespace Lenta;

/// Правила «срочных» новостей.
/// Правила через запятую; внутри правила части через «+» — должны встретиться все.
/// Части — начала слов: «ключев+ставк» найдёт «ключевую ставку», но не «ключевых… отставках».
public static class UrgentRules
{
    public static readonly string DefaultText = string.Join(", ", new[]
    {
        // Пометки самих редакций
        "срочно", "молния", "breaking",
        // Экономика и деньги
        "ключев+ставк", "девальвац", "дефолт", "обвал+рубл", "обвал+рынк", "торги+приостанов",
        "курс+доллар+рекорд", "биржев+крах",
        // Чрезвычайные ситуации
        "землетрясен", "цунами", "теракт", "эвакуац", "режим+чрезвычайн", "режим чс",
        "крушени", "авиакатастроф", "мощный+взрыв",
        // Государство
        "мобилизац", "военное положение", "отставк+правительств", "указ+подписал+путин",
        // Связь и интернет
        "telegram+блокир", "телеграм+блокир", "youtube+блокир", "мобильного интернета+отключ",
        // Маркетплейсы
        "ozon", "озон", "маркетплейс+закон",
    });

    static string Norm(string s) => s.ToLowerInvariant().Replace('ё', 'е');

    public static List<string[]> Parse(string text) =>
        Norm(text).Split(new[] { ',', ';', '\n' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(r => r.Split('+').Select(p => p.Trim()).Where(p => p.Length > 0).ToArray())
            .Where(r => r.Length > 0).ToList();

    public static bool Matches(string title, List<string[]> rules)
    {
        var t = Norm(title);
        return rules.Any(parts => parts.All(p => StartsWord(p, t)));
    }

    static bool StartsWord(string part, string text)
    {
        int i = 0;
        while ((i = text.IndexOf(part, i, StringComparison.Ordinal)) >= 0)
        {
            if (i == 0 || !char.IsLetterOrDigit(text[i - 1])) return true;
            i++;
        }
        return false;
    }
}
