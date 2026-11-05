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

    var result: FeedResult?
    var loading = false
    var lastError: String?

    let presets: [(String, String)] = [
        ("РБК", "https://www.rbc.ru"),
        ("Коммерсантъ", "https://www.kommersant.ru"),
        ("Интерфакс", "https://www.interfax.ru"),
        ("Lenta.ru", "https://lenta.ru"),
        ("Хабр", "https://habr.com/ru/"),
    ]
    /// Короткие названия для известных сайтов.
    let friendlyNames: [String: String] = [
        "rbc.ru": "РБК", "kommersant.ru": "Коммерсантъ", "interfax.ru": "Интерфакс",
        "lenta.ru": "Lenta.ru", "habr.com": "Хабр",
    ]
    let speeds: [(String, CGFloat)] = [("Медленно", 30), ("Обычно", 51), ("Быстро", 81)]   // на 15% медленнее прежних 35/60/95

    var sourceURL: String {
        get { defaults.string(forKey: "source") ?? "https://www.rbc.ru" }
        set { defaults.set(newValue, forKey: "source") }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        defaults.register(defaults: ["speed": 1, "visible": true, "position": 0, "size": 1, "theme": 0,
                                     "content": 2, "stocks": "SBER, GAZP, LKOH, YDEX, ROSN, VTBR",
                                     "index": true, "currencies": "USD,EUR,CNY"])

        panel = TickerPanel()
        applyAppearance()
        panel.ticker.speed = speeds[min(max(defaults.integer(forKey: "speed"), 0), speeds.count - 1)].1
        panel.ticker.onOpen = { url in NSWorkspace.shared.open(url) }
        panel.ticker.contentMode = defaults.integer(forKey: "content")
        panel.ticker.setMessage("Загрузка…")
        if defaults.bool(forKey: "visible") { panel.window.orderFrontRegardless() }

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "📰"
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu

        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged),
                                               name: NSApplication.didChangeScreenParametersNotification, object: nil)
        startClock()
        refresh()
        let r = Timer(timeInterval: 300, target: self, selector: #selector(refresh), userInfo: nil, repeats: true)
        RunLoop.main.add(r, forMode: .common)
        refreshTimer = r

        refreshQuotes()
        let q = Timer(timeInterval: 60, target: self, selector: #selector(refreshQuotes), userInfo: nil, repeats: true)
        RunLoop.main.add(q, forMode: .common)
        quotesTimer = q
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
            link.add(to: .main, forMode: .common)
            displayLink = link
            return
        }
        let t = Timer(timeInterval: 1.0 / 60, target: self, selector: #selector(tick), userInfo: nil, repeats: true)
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
        if placeAcc > 2 {
            placeAcc = 0
            if panel.position.followsDock { panel.place() }
        }
    }

    @objc func screensChanged() { panel.place() }

    // MARK: Загрузка

    @objc func refresh() {
        guard !loading, let url = URL(string: sourceURL) else { return }
        loading = true
        Task { @MainActor in
            defer { self.loading = false }
            do {
                // Если лента уже найдена — грузим её напрямую, иначе ищем заново.
                let target = (result?.feedURL.absoluteString.isEmpty == false && result?.isRSS == true
                              && resultSource == sourceURL) ? result!.feedURL : url
                var r = try await FeedLoader.load(target)
                r.siteName = displayName(for: url, fallback: r.siteName)
                self.result = r
                self.resultSource = sourceURL
                self.lastError = nil
                self.panel.ticker.setHeadlines(r.items, source: r.siteName)
            } catch {
                self.lastError = error.localizedDescription
                if self.result == nil || self.resultSource != self.sourceURL {
                    self.panel.ticker.setMessage("Не удалось получить заголовки с \(url.host ?? self.sourceURL)")
                }
            }
        }
    }
    var resultSource: String?

    func displayName(for url: URL, fallback: String) -> String {
        let host = (url.host ?? "").replacingOccurrences(of: "www.", with: "")
        for (k, v) in friendlyNames where host == k || host.hasSuffix("." + k) { return v }
        return fallback
    }

    func setSource(_ s: String) {
        var str = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if !str.lowercased().hasPrefix("http") { str = "https://" + str }
        guard URL(string: str)?.host != nil else { return }
        sourceURL = str
        result = nil
        resultSource = nil
        panel.ticker.setMessage("Загрузка заголовков…")
        refresh()
    }

    // MARK: Меню

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()

        let host = URL(string: sourceURL)?.host ?? sourceURL
        var status = "Источник: \(host)"
        if let r = result { status += r.isRSS ? " · RSS, \(r.items.count) загол." : " · со страницы" }
        if loading { status += " · загрузка…" }
        let st = NSMenuItem(title: status, action: nil, keyEquivalent: "")
        st.isEnabled = false
        menu.addItem(st)
        if let e = lastError {
            let ei = NSMenuItem(title: "⚠︎ " + e, action: nil, keyEquivalent: "")
            ei.isEnabled = false
            menu.addItem(ei)
        }

        if let r = result, !r.items.isEmpty {
            let latest = NSMenu()
            for (i, h) in r.items.prefix(15).enumerated() {
                let title = h.title.count > 90 ? String(h.title.prefix(88)) + "…" : h.title
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
        w.textField("Сайт или RSS:", value: sourceURL, placeholder: "https://www.rbc.ru", button: "Применить") { [weak self] v in
            self?.setSource(v)
        }
        let presetIndex = presets.firstIndex { $0.1 == sourceURL }.map { $0 + 1 } ?? 0
        w.popup("Популярные:", ["—"] + presets.map { $0.0 }, selected: presetIndex) { [weak self] i in
            guard let self, i > 0 else { return }
            self.setSource(self.presets[i - 1].1)
            DispatchQueue.main.async { self.openSettings() }   // обновить поле со ссылкой
        }

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
        w.note("Акции и индекс — Московская биржа, обновление раз в минуту. Валюты — официальный курс ЦБ на сегодня.")

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

        w.onClose = { [weak self] in self?.settingsWindow = nil }
        settingsWindow = w
        w.show()
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
        if let r = result, sender.tag < r.items.count, let url = r.items[sender.tag].link {
            NSWorkspace.shared.open(url)
        }
    }

    @objc func togglePause() { panel.ticker.paused.toggle() }

    @objc func askAccessibility() {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        _ = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
    }

    @objc func quit() { NSApp.terminate(nil) }
}
