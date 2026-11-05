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
        defaults.register(defaults: ["speed": 1, "visible": true, "position": 0, "size": 1, "theme": 0])

        panel = TickerPanel()
        applyAppearance()
        panel.ticker.speed = speeds[min(max(defaults.integer(forKey: "speed"), 0), speeds.count - 1)].1
        panel.ticker.onOpen = { url in NSWorkspace.shared.open(url) }
        panel.ticker.setMessage("Загрузка заголовков…")
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

        menu.addItem(item("Вставить ссылку на сайт…", #selector(askURL)))
        let presetMenu = NSMenu()
        for (i, p) in presets.enumerated() {
            let it = item(p.0, #selector(choosePreset(_:)))
            it.tag = i
            it.state = sourceURL == p.1 ? .on : .off
            presetMenu.addItem(it)
        }
        let pm = NSMenuItem(title: "Популярные сайты", action: nil, keyEquivalent: "")
        pm.submenu = presetMenu
        menu.addItem(pm)

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
        menu.addItem(item("Обновить сейчас", #selector(refresh)))

        menu.addItem(.separator())
        let speedMenu = NSMenu()
        let cur = defaults.integer(forKey: "speed")
        for (i, s) in speeds.enumerated() {
            let it = item(s.0, #selector(setSpeed(_:)))
            it.tag = i
            it.state = i == cur ? .on : .off
            speedMenu.addItem(it)
        }
        let sm = NSMenuItem(title: "Скорость", action: nil, keyEquivalent: "")
        sm.submenu = speedMenu
        menu.addItem(sm)

        menu.addItem(submenu("Расположение", TickerPosition.allCases.map { $0.title },
                             selected: defaults.integer(forKey: "position"), action: #selector(setPosition(_:))))
        menu.addItem(submenu("Размер", TickerSize.all.map { $0.name },
                             selected: defaults.integer(forKey: "size"), action: #selector(setSize(_:))))
        menu.addItem(submenu("Цвета", TickerTheme.all.map { $0.name },
                             selected: defaults.integer(forKey: "theme"), action: #selector(setTheme(_:))))

        let pause = item("Пауза", #selector(togglePause))
        pause.state = panel.ticker.paused ? .on : .off
        menu.addItem(pause)
        let vis = item("Показывать строку", #selector(toggleVisible))
        vis.state = defaults.bool(forKey: "visible") ? .on : .off
        menu.addItem(vis)

        menu.addItem(.separator())
        let hint = NSMenuItem(title: "⌥ + клик по заголовку — открыть статью", action: nil, keyEquivalent: "")
        hint.isEnabled = false
        menu.addItem(hint)
        menu.addItem(item("Выйти", #selector(quit)))
    }

    private func submenu(_ title: String, _ names: [String], selected: Int, action: Selector) -> NSMenuItem {
        let sub = NSMenu()
        for (i, n) in names.enumerated() {
            let it = item(n, action)
            it.tag = i
            it.state = i == selected ? .on : .off
            sub.addItem(it)
        }
        let m = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        m.submenu = sub
        return m
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

    @objc func setPosition(_ sender: NSMenuItem) {
        defaults.set(sender.tag, forKey: "position")
        applyAppearance()
    }

    @objc func setSize(_ sender: NSMenuItem) {
        defaults.set(sender.tag, forKey: "size")
        applyAppearance()
    }

    @objc func setTheme(_ sender: NSMenuItem) {
        defaults.set(sender.tag, forKey: "theme")
        applyAppearance()
    }

    private func item(_ title: String, _ action: Selector) -> NSMenuItem {
        let it = NSMenuItem(title: title, action: action, keyEquivalent: "")
        it.target = self
        return it
    }

    @objc func askURL() {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Ссылка на сайт или RSS"
        alert.informativeText = "Например: https://www.rbc.ru. Приложение само найдёт ленту новостей."
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        if let clip = NSPasteboard.general.string(forType: .string), clip.lowercased().hasPrefix("http") {
            field.stringValue = clip
        } else {
            field.stringValue = sourceURL
        }
        alert.accessoryView = field
        alert.addButton(withTitle: "Показать")
        alert.addButton(withTitle: "Отмена")
        alert.window.initialFirstResponder = field
        if alert.runModal() == .alertFirstButtonReturn {
            setSource(field.stringValue)
        }
    }

    @objc func choosePreset(_ sender: NSMenuItem) { setSource(presets[sender.tag].1) }

    @objc func openHeadline(_ sender: NSMenuItem) {
        if let r = result, sender.tag < r.items.count, let url = r.items[sender.tag].link {
            NSWorkspace.shared.open(url)
        }
    }

    @objc func setSpeed(_ sender: NSMenuItem) {
        defaults.set(sender.tag, forKey: "speed")
        panel.ticker.speed = speeds[sender.tag].1
    }

    @objc func togglePause() { panel.ticker.paused.toggle() }

    @objc func toggleVisible() {
        let v = !defaults.bool(forKey: "visible")
        defaults.set(v, forKey: "visible")
        if v { panel.window.orderFrontRegardless() } else { panel.window.orderOut(nil) }
    }

    @objc func quit() { NSApp.terminate(nil) }
}
