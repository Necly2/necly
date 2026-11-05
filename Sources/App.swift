import Cocoa

@main
struct LentaMain {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)   // только иконка в строке меню
        withExtendedLifetime(delegate) { app.run() }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    var statusItem: NSStatusItem!
    var panel: TickerPanel!
    var timer: Timer?
    var refreshTimer: Timer?
    var displayLink: AnyObject?
    var last = CACurrentMediaTime()
    let defaults = UserDefaults.standard
    let updater = Updater(appName: "Lenta", title: "Лента", tag: "lenta-latest", zipName: "Lenta.zip")

    var loading = false
    var lastError: String?
    /// Найденные ленты по каждому источнику (чтобы не искать RSS заново) и ошибки.
    var feeds: [String: FeedResult] = [:]
    var feedErrors: [String: String] = [:]
    /// Все заголовки из всех включённых источников — в том порядке, как они бегут.
    var combined: [Headline] = []

    let presets: [(String, String)] = [
        ("РБК", "https://www.rbc.ru"),
        ("Коммерсантъ", "https://www.kommersant.ru"),
        ("Интерфакс", "https://www.interfax.ru"),
        ("Lenta.ru", "https://lenta.ru"),
        ("ТАСС", "https://tass.ru"),
        ("Хабр", "https://habr.com/ru/"),
    ]
    /// Короткие названия для известных сайтов.
    let friendlyNames: [String: String] = [
        "rbc.ru": "РБК", "kommersant.ru": "Коммерсантъ", "interfax.ru": "Интерфакс",
        "lenta.ru": "Lenta.ru", "habr.com": "Хабр", "tass.ru": "ТАСС",
    ]
    let speeds: [(String, CGFloat)] = [("Медленно", 30), ("Обычно", 51), ("Быстро", 81)]   // на 15% медленнее прежних 35/60/95

    /// Включённые источники (адреса сайтов или RSS). Раньше был один — переносим его.
    var sources: [String] {
        get {
            if let a = defaults.stringArray(forKey: "sources") { return a }
            return [defaults.string(forKey: "source") ?? "https://www.rbc.ru"]
        }
        set { defaults.set(newValue, forKey: "sources") }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        defaults.register(defaults: ["speed": 1, "visible": true, "position": 0, "size": 1, "theme": 0,
                                     "content": 2, "stocks": "SBER, GAZP, LKOH, YDEX, ROSN, VTBR",
                                     "index": true, "currencies": "USD,EUR,CNY",
                                     "urgentOn": true, "urgentSound": true, "urgentRules": UrgentRules.defaultText,
                                     "newsInterval": 1, "quotesInterval": 1, "frameRate": 0])

        panel = TickerPanel()
        applyAppearance()
        panel.ticker.speed = speeds[min(max(defaults.integer(forKey: "speed"), 0), speeds.count - 1)].1
        panel.ticker.onOpen = { url in NSWorkspace.shared.open(url) }
        panel.ticker.contentMode = defaults.integer(forKey: "content")
        applyUrgentSettings()
        panel.ticker.setMessage("Загрузка…")
        if defaults.bool(forKey: "visible") { panel.window.orderFrontRegardless() }

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "📰"
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu

        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged),
                                               name: NSApplication.didChangeScreenParametersNotification, object: nil)
        updater.start()
        startClock()
        refresh()
        refreshQuotes()
        restartTimers()
    }

    // MARK: Частота обновления

    let newsIntervals: [(String, TimeInterval)] = [("1 мин", 60), ("2 мин", 120), ("5 мин", 300), ("10 мин", 600),
                                                   ("15 мин", 900), ("30 мин", 1800)]
    let quoteIntervals: [(String, TimeInterval)] = [("30 сек", 30), ("1 мин", 60), ("2 мин", 120), ("5 мин", 300),
                                                    ("15 мин", 900)]

    func restartTimers() {
        refreshTimer?.invalidate()
        quotesTimer?.invalidate()
        let n = newsIntervals[min(max(defaults.integer(forKey: "newsInterval"), 0), newsIntervals.count - 1)].1
        let q = quoteIntervals[min(max(defaults.integer(forKey: "quotesInterval"), 0), quoteIntervals.count - 1)].1
        let r = Timer(timeInterval: n, target: self, selector: #selector(refresh), userInfo: nil, repeats: true)
        r.tolerance = n * 0.1          // macOS может объединять пробуждения — экономия энергии
        RunLoop.main.add(r, forMode: .common)
        refreshTimer = r
        let qt = Timer(timeInterval: q, target: self, selector: #selector(refreshQuotes), userInfo: nil, repeats: true)
        qt.tolerance = q * 0.1
        RunLoop.main.add(qt, forMode: .common)
        quotesTimer = qt
    }

    // MARK: Котировки

    var quotesTimer: Timer?
    var quotes: [Quote] = []
    var loadingQuotes = false

    var stockList: [String] {
        (defaults.string(forKey: "stocks") ?? "").uppercased()
            .components(separatedBy: CharacterSet(charactersIn: ", ;\n")).filter { !$0.isEmpty }
    }
    var currencyList: [String] {
        (defaults.string(forKey: "currencies") ?? "").components(separatedBy: ",").filter { !$0.isEmpty }
    }

    @objc func refreshQuotes() {
        guard defaults.integer(forKey: "content") != 0, !loadingQuotes else { return }
        loadingQuotes = true
        let stocks = stockList, cur = currencyList, idx = defaults.bool(forKey: "index")
        Task { @MainActor in
            let q = await QuoteLoader.load(stocks: stocks, index: idx, currencies: cur)
            self.loadingQuotes = false
            if !q.isEmpty || (stocks.isEmpty && cur.isEmpty && !idx) {
                self.quotes = q
                self.panel.ticker.setQuotes(q)
            }
        }
    }

    // MARK: Анимация

    func startClock() {
        timer?.invalidate()
        timer = nil
        if #available(macOS 14.0, *) {
            (displayLink as? CADisplayLink)?.invalidate()
            let link = panel.ticker.displayLink(target: self, selector: #selector(frameTick(_:)))
            // Частота кадров из настроек: «как у экрана» (120/144/165/240 Гц) или фиксированная
            let fps = FrameRates.fps(defaults.integer(forKey: "frameRate"))
            link.preferredFrameRateRange = CAFrameRateRange(minimum: min(30, fps), maximum: fps, preferred: fps)
            link.add(to: .main, forMode: .common)
            displayLink = link
            return
        }
        let t = Timer(timeInterval: 1.0 / Double(FrameRates.fps(defaults.integer(forKey: "frameRate"))),
                      target: self, selector: #selector(tick), userInfo: nil, repeats: true)
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    @objc func frameTick(_ sender: AnyObject) { tick() }

    var placeAcc: CGFloat = 0

    @objc func tick() {
        let now = CACurrentMediaTime()
        let dt = CGFloat(min(now - last, 0.05))
        last = now
        panel.updateClickThrough()
        panel.ticker.advance(dt)
        // Dock меняет ширину, когда запускаются приложения, — подстраиваемся раз в 2 секунды.
        placeAcc += dt
        if placeAcc > 5 {
            placeAcc = 0
            if panel.position.followsDock { panel.place() }
        }
    }

    @objc func screensChanged() {
        panel.place()
        startClock()      // другой экран — другая частота
    }

    // MARK: Загрузка

    @objc func refresh() {
        guard !loading else { return }
        let list = sources.compactMap { src -> (String, URL)? in URL(string: src).map { (src, $0) } }
        guard !list.isEmpty else {
            combined = []
            panel.ticker.setMessage("Выберите источник новостей в настройках")
            return
        }
        loading = true
        let known = feeds
        Task { @MainActor in
            defer { self.loading = false }
            // Все источники грузятся одновременно
            var results: [String: FeedResult] = [:]
            var errors: [String: String] = [:]
            await withTaskGroup(of: (String, FeedResult?, String?).self) { group in
                for (src, url) in list {
                    // Если лента уже найдена — грузим её напрямую, иначе ищем заново
                    let target = (known[src]?.isRSS == true) ? known[src]!.feedURL : url
                    group.addTask {
                        do { return (src, try await FeedLoader.load(target), nil) }
                        catch { return (src, nil, error.localizedDescription) }
                    }
                }
                for await (src, r, err) in group {
                    if let r { results[src] = r } else { errors[src] = err ?? "ошибка" }
                }
            }
            for (src, url) in list {
                if var r = results[src] {
                    r.siteName = self.displayName(for: url, fallback: r.siteName)
                    self.feeds[src] = r
                }
            }
            self.feedErrors = errors
            self.lastError = errors.isEmpty ? nil : "Не загрузились: " + errors.keys.compactMap { URL(string: $0)?.host }.joined(separator: ", ")
            self.applyFeeds()
        }
    }

    /// 0 — по времени вперемешку, 1 — блоками по источникам
    var mixOrder: Int { defaults.integer(forKey: "mixOrder") }

    /// Собрать строку из всех включённых источников.
    func applyFeeds() {
        let active = sources.compactMap { feeds[$0] }
        guard !active.isEmpty else {
            combined = []
            if let first = sources.first {
                panel.ticker.setMessage("Не удалось получить заголовки с \(URL(string: first)?.host ?? first)")
            }
            return
        }
        if active.count == 1 {
            combined = active[0].items
            panel.ticker.setHeadlines(combined, source: active[0].siteName)
        } else {
            // Не больше 25 заголовков с каждого источника — чтобы никто не забивал остальных
            let tagged = active.map { f in f.items.prefix(25).map { var h = $0; h.source = f.siteName; return h } }
            if mixOrder == 0 {
                combined = tagged.flatMap { $0 }.sorted { ($0.date ?? .distantPast) > ($1.date ?? .distantPast) }
                panel.ticker.setHeadlines(combined, source: "", tags: true)
            } else {
                combined = tagged.flatMap { $0 }
                panel.ticker.setHeadlines(combined, source: "", grouped: true)
            }
        }
        detectUrgent(combined)
    }

    func displayName(for url: URL, fallback: String) -> String {
        let host = (url.host ?? "").replacingOccurrences(of: "www.", with: "")
        for (k, v) in friendlyNames where host == k || host.hasSuffix("." + k) { return v }
        return fallback
    }

    static func normalize(_ s: String) -> String? {
        var str = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if str.isEmpty { return nil }
        if !str.lowercased().hasPrefix("http") { str = "https://" + str }
        return URL(string: str)?.host != nil ? str : nil
    }

    func setSources(_ list: [String]) {
        var seen = Set<String>()
        sources = list.filter { seen.insert($0).inserted }
        feeds = feeds.filter { sources.contains($0.key) }
        if combined.isEmpty { panel.ticker.setMessage("Загрузка заголовков…") }
        refresh()
    }

    var customSources: [String] { sources.filter { s in !presets.contains { $0.1 == s } } }

    // MARK: Меню

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()

        let names = sources.map { src in feeds[src]?.siteName ?? URL(string: src)?.host ?? src }
        var status = (names.count == 1 ? "Источник: " : "Источники: ") + names.joined(separator: ", ")
        if !combined.isEmpty { status += " · \(combined.count) загол." }
        if loading { status += " · загрузка…" }
        let st = NSMenuItem(title: status, action: nil, keyEquivalent: "")
        st.isEnabled = false
        menu.addItem(st)
        if let e = lastError {
            let ei = NSMenuItem(title: "⚠︎ " + e, action: nil, keyEquivalent: "")
            ei.isEnabled = false
            menu.addItem(ei)
        }

        if !combined.isEmpty {
            let latest = NSMenu()
            for (i, h) in combined.prefix(15).enumerated() {
                var title = h.title.count > 90 ? String(h.title.prefix(88)) + "…" : h.title
                if let src = h.source { title = src + ": " + title }
                if UrgentRules.matches(h.title, urgentRules) { title = "⚡ " + title }
                let it = item(title, #selector(openHeadline(_:)))
                it.tag = i
                it.isEnabled = h.link != nil
                latest.addItem(it)
            }
            let lm = NSMenuItem(title: "Последние заголовки", action: nil, keyEquivalent: "")
            lm.submenu = latest
            menu.addItem(lm)
        }
        menu.addItem(item("Обновить сейчас", #selector(refreshAll)))
        let pause = item("Пауза", #selector(togglePause))
        pause.state = panel.ticker.paused ? .on : .off
        menu.addItem(pause)

        menu.addItem(.separator())
        if let b = updater.available {
            menu.addItem(item("⬆ Обновить до сборки \(b)…", #selector(installUpdate)))
        }
        menu.addItem(item("Проверить обновления…", #selector(checkUpdates)))
        let settings = item("Настройки…", #selector(openSettings))
        settings.keyEquivalent = ","
        menu.addItem(settings)
        let hint = NSMenuItem(title: "⌥ + клик по строке — открыть статью или котировку", action: nil, keyEquivalent: "")
        hint.isEnabled = false
        menu.addItem(hint)
        menu.addItem(item("Выйти", #selector(quit)))
    }

    @objc func refreshAll() {
        refresh()
        refreshQuotes()
    }

    // MARK: Окно настроек

    var settingsWindow: SettingsWindow?

    @objc func openSettings() {
        settingsWindow?.window.close()
        let w = SettingsWindow(title: "Лента — настройки")

        w.section("Содержимое")
        w.popup("Показывать:", ["Новости", "Котировки", "Котировки и новости"],
                selected: defaults.integer(forKey: "content")) { [weak self] i in
            guard let self else { return }
            self.defaults.set(i, forKey: "content")
            self.panel.ticker.contentMode = i
            self.refreshQuotes()
        }

        w.section("Новости")
        // Можно включить несколько источников сразу
        let current = Set(sources)
        let togglePreset: (Int, Bool) -> Void = { [weak self] i, on in
            guard let self else { return }
            let url = self.presets[i].1
            var list = self.sources.filter { $0 != url }
            if on {
                // пресеты держим в своём порядке, свои сайты — после них
                list.append(url)
                let order = self.presets.map { $0.1 }
                list.sort { (order.firstIndex(of: $0) ?? 99) < (order.firstIndex(of: $1) ?? 99) }
            }
            self.setSources(list)
        }
        w.checkboxes("Источники:", presets[0..<3].map { ($0.0, current.contains($0.1)) }) { i, on in togglePreset(i, on) }
        w.checkboxes("", presets[3...].map { ($0.0, current.contains($0.1)) }) { i, on in togglePreset(i + 3, on) }
        w.textField("Свои сайты:", value: customSources.joined(separator: ", "), placeholder: "https://example.com, другой-сайт.ru",
                    button: "Применить", width: 300) { [weak self] v in
            guard let self else { return }
            let custom = v.components(separatedBy: CharacterSet(charactersIn: ",;\n ")).compactMap(AppDelegate.normalize)
            let presetOn = self.sources.filter { s in self.presets.contains { $0.1 == s } }
            self.setSources(presetOn + custom)
        }
        w.popup("Порядок:", ["По времени — вперемешку", "По источникам — блоками"], selected: mixOrder) { [weak self] i in
            self?.defaults.set(i, forKey: "mixOrder")
            self?.applyFeeds()
        }
        w.note("Можно включить сколько угодно источников: строка соберёт их вместе. «По времени» — свежие заголовки первыми, у каждого метка источника. Для своих сайтов подойдёт адрес сайта или прямая ссылка на RSS.")

        w.section("Срочные новости")
        w.checkbox("", "Выделять срочные и мигать строкой", on: defaults.bool(forKey: "urgentOn")) { [weak self] on in
            self?.defaults.set(on, forKey: "urgentOn")
            self?.applyUrgentSettings()
        }
        w.checkbox("", "Звуковой сигнал", on: defaults.bool(forKey: "urgentSound")) { [weak self] on in
            self?.defaults.set(on, forKey: "urgentSound")
        }
        w.textField("Слова:", value: defaults.string(forKey: "urgentRules") ?? "", placeholder: UrgentRules.defaultText,
                    button: "Применить", width: 380) { [weak self] v in
            self?.defaults.set(v, forKey: "urgentRules")
            self?.applyUrgentSettings()
        }
        w.note("Через запятую. Достаточно начала слова: «эвакуац» найдёт «эвакуация» и «эвакуацию». «+» — должны встретиться все части: «ключев+ставк».")
        w.button("", "Вернуть слова по умолчанию") { [weak self] in
            self?.defaults.set(UrgentRules.defaultText, forKey: "urgentRules")
            self?.applyUrgentSettings()
            DispatchQueue.main.async { self?.openSettings() }
        }
        w.button("", "Показать, как выглядит тревога") { [weak self] in
            guard let self, let h = self.combined.first else { return }
            self.triggerAlert(h.title)
        }

        w.column()      // вторая колонка — окно получается широким, а не высоким
        w.section("Котировки")
        w.textField("Акции (тикеры):", value: defaults.string(forKey: "stocks") ?? "",
                    placeholder: "SBER, GAZP, LKOH", button: "Применить") { [weak self] v in
            self?.defaults.set(v, forKey: "stocks")
            self?.refreshQuotes()
        }
        w.checkbox("Индекс:", "Индекс Мосбиржи (IMOEX)", on: defaults.bool(forKey: "index")) { [weak self] on in
            self?.defaults.set(on, forKey: "index")
            self?.refreshQuotes()
        }
        let allCur = ["USD", "EUR", "CNY"]
        let curSel = Set(currencyList)
        w.checkboxes("Курсы ЦБ:", allCur.map { ($0, curSel.contains($0)) }) { [weak self] i, on in
            guard let self else { return }
            var set = Set(self.currencyList)
            if on { set.insert(allCur[i]) } else { set.remove(allCur[i]) }
            self.defaults.set(allCur.filter { set.contains($0) }.joined(separator: ","), forKey: "currencies")
            self.refreshQuotes()
        }
        w.note("Акции и индекс — Московская биржа. Валюты — официальный курс ЦБ на сегодня.")

        w.section("Обновление")
        w.popup("Новости:", newsIntervals.map { "каждые " + $0.0 }, selected: defaults.integer(forKey: "newsInterval")) { [weak self] i in
            self?.defaults.set(i, forKey: "newsInterval")
            self?.restartTimers()
        }
        w.popup("Котировки:", quoteIntervals.map { "каждые " + $0.0 }, selected: defaults.integer(forKey: "quotesInterval")) { [weak self] i in
            self?.defaults.set(i, forKey: "quotesInterval")
            self?.restartTimers()
        }

        w.section("Вид")
        w.popup("Расположение:", TickerPosition.allCases.map { $0.title },
                selected: defaults.integer(forKey: "position")) { [weak self] i in
            self?.defaults.set(i, forKey: "position")
            self?.applyAppearance()
        }
        w.popup("Размер:", TickerSize.all.map { $0.name }, selected: defaults.integer(forKey: "size")) { [weak self] i in
            self?.defaults.set(i, forKey: "size")
            self?.applyAppearance()
        }
        w.popup("Цвета:", TickerTheme.all.map { $0.name }, selected: defaults.integer(forKey: "theme")) { [weak self] i in
            self?.defaults.set(i, forKey: "theme")
            self?.applyAppearance()
        }
        w.popup("Частота кадров:", FrameRates.titles, selected: defaults.integer(forKey: "frameRate")) { [weak self] i in
            self?.defaults.set(i, forKey: "frameRate")
            self?.startClock()
        }
        w.popup("Скорость:", speeds.map { $0.0 }, selected: defaults.integer(forKey: "speed")) { [weak self] i in
            guard let self else { return }
            self.defaults.set(i, forKey: "speed")
            self.panel.ticker.speed = self.speeds[i].1
        }
        w.checkbox("", "Показывать строку", on: defaults.bool(forKey: "visible")) { [weak self] on in
            guard let self else { return }
            self.defaults.set(on, forKey: "visible")
            if on { self.panel.window.orderFrontRegardless() } else { self.panel.window.orderOut(nil) }
        }
        if !AXIsProcessTrusted() {
            w.button("Dock:", "Точнее определять Dock…") { [weak self] in self?.askAccessibility() }
            w.note("Нужно для расположений возле Dock: без доступа ширина Dock оценивается приблизительно.")
        }

        w.section("Обновления")
        w.checkbox("", "Проверять обновления автоматически (раз в день)", on: updater.autoUpdate) { [weak self] on in
            self?.updater.autoUpdate = on
        }
        w.button("", "Проверить сейчас") { [weak self] in self?.checkUpdates() }
        w.note("Установлена сборка \(updater.currentBuild). Новая версия скачивается с GitHub и ставится сама — с перезапуском.")

        w.onClose = { [weak self] in self?.settingsWindow = nil }
        settingsWindow = w
        w.show()
    }

    // MARK: Срочные новости

    var seenTitles = Set<String>()
    var urgentRules: [[String]] { UrgentRules.parse(defaults.string(forKey: "urgentRules") ?? UrgentRules.defaultText) }

    func applyUrgentSettings() {
        panel.ticker.urgentRules = urgentRules
        panel.ticker.highlightUrgent = defaults.bool(forKey: "urgentOn")
    }

    /// Новые срочные заголовки (свежее часа; при первой загрузке — свежее 30 минут) поднимают тревогу.
    func detectUrgent(_ items: [Headline]) {
        defer { seenTitles.formUnion(items.map { $0.title }) }
        guard defaults.bool(forKey: "urgentOn"), defaults.integer(forKey: "content") != 1 else { return }
        let rules = urgentRules
        let now = Date()
        let first = seenTitles.isEmpty
        var newest: Headline?
        for h in items where !seenTitles.contains(h.title) && UrgentRules.matches(h.title, rules) {
            let age = h.date.map { now.timeIntervalSince($0) } ?? 0
            if age > (first ? 1800 : 3600) { continue }
            if newest == nil || (h.date ?? now) > (newest?.date ?? now) { newest = h }
        }
        if let h = newest { triggerAlert(h.title) }
    }

    func triggerAlert(_ title: String) {
        panel.ticker.alert(title)
        if defaults.bool(forKey: "urgentSound") { NSSound(named: "Glass")?.play() }
    }

    func applyAppearance() {
        let pos = TickerPosition(rawValue: defaults.integer(forKey: "position")) ?? .underMenuBar
        let size = TickerSize.all[min(max(defaults.integer(forKey: "size"), 0), TickerSize.all.count - 1)]
        let theme = TickerTheme.all[min(max(defaults.integer(forKey: "theme"), 0), TickerTheme.all.count - 1)]
        panel.position = pos
        panel.size = size
        panel.ticker.theme = theme
        panel.place()
    }

    private func item(_ title: String, _ action: Selector) -> NSMenuItem {
        let it = NSMenuItem(title: title, action: action, keyEquivalent: "")
        it.target = self
        return it
    }

    @objc func openHeadline(_ sender: NSMenuItem) {
        if sender.tag < combined.count, let url = combined[sender.tag].link {
            NSWorkspace.shared.open(url)
        }
    }

    @objc func togglePause() { panel.ticker.paused.toggle() }

    @objc func askAccessibility() {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        _ = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
    }

    @objc func checkUpdates() { Task { await updater.check(interactive: true) } }
    @objc func installUpdate() { if let b = updater.available { updater.offer(b) } }

    @objc func quit() { NSApp.terminate(nil) }
}
