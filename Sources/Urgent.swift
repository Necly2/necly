import Foundation

/// Правила «срочных» новостей.
/// Формат: правила через запятую; внутри правила части через «+» — должны встретиться все.
/// Части — начала слов (основы), регистр и ё/е не важны: «ключев+ставк» найдёт «ключевую ставку».
enum UrgentRules {
    static let defaultText = [
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
    ].joined(separator: ", ")

    static func parse(_ text: String) -> [[String]] {
        text.lowercased().replacingOccurrences(of: "ё", with: "е")
            .components(separatedBy: CharacterSet(charactersIn: ",;\n"))
            .map { rule in
                rule.components(separatedBy: "+")
                    .map { $0.trimmingCharacters(in: .whitespaces) }
                    .filter { !$0.isEmpty }
            }
            .filter { !$0.isEmpty }
    }

    static func matches(_ title: String, _ rules: [[String]]) -> Bool {
        let t = title.lowercased().replacingOccurrences(of: "ё", with: "е")
        return rules.contains { parts in parts.allSatisfy { startsWord($0, in: t) } }
    }

    /// Часть должна стоять в начале слова: «ставк» найдёт «ставку», но не «отставку».
    static func startsWord(_ part: String, in text: String) -> Bool {
        var range = text.startIndex..<text.endIndex
        while let r = text.range(of: part, range: range) {
            if r.lowerBound == text.startIndex { return true }
            let prev = text[text.index(before: r.lowerBound)]
            if !prev.isLetter && !prev.isNumber { return true }
            range = text.index(after: r.lowerBound)..<text.endIndex
        }
        return false
    }
}
