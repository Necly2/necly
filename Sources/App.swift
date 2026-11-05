import Cocoa

@main
struct SugrobMain {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)   // без иконки в Dock, только в строке меню
        withExtendedLifetime(delegate) { app.run() }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let engine = SnowEngine()
    var overlays: [NSWindow] = []
    var statusItem: NSStatusItem!
    var timer: Timer?
    var displayLink: AnyObject?
    var last = CACurrentMediaTime()
    var paused = false
    let defaults = UserDefaults.standard

    let levels: [(String, CGFloat)] = [("Лёгкий снег", 2), ("Снегопад", 4.5), ("Метель", 10)]

    func applicationDidFinishLaunching(_ notification: Notification) {
        defaults.register(defaults: ["level": 1, "fastPiles": false, "dock": true, "snowing": true,
                                     "garland": true, "gDock": true, "gMenu": true, "gWin": false,
                                     "gMode": 0, "gPalette": 0, "gBright": 0.9, "fps": 1])
        engine.snowing = defaults.bool(forKey: "snowing")
        loadGarland()
        let level = min(max(defaults.integer(forKey: "level"), 0), levels.count - 1)
        engine.intensity = levels[level].1
        engine.fastPiles = defaults.bool(forKey: "fastPiles")
        engine.dockEnabled = defaults.bool(forKey: "dock")
        engine.snowBehindWindows = defaults.bool(forKey: "behind")

        buildOverlays()
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged),
                                               name: NSApplication.didChangeScreenParametersNotification,
                                               object: nil)
        setupMenu()
        startClock()
    }

    /// Кадры синхронизированы с обновлением экрана (60/120 Гц). На macOS 13 — обычный таймер.
    func startClock() {
        timer?.invalidate()
        timer = nil
        if #available(macOS 14.0, *) {
            (displayLink as? CADisplayLink)?.invalidate()
            displayLink = nil
            if let view = overlays.first?.contentView {
                let link = view.displayLink(target: self, selector: #selector(frameTick(_:)))
                // Ограничение кадров: 30 или 60 в секунду, даже на экранах 120 Гц — меньше нагрев
                let fps: Float = defaults.integer(forKey: "fps") == 0 ? 30 : 60
                link.preferredFrameRateRange = CAFrameRateRange(minimum: fps / 2, maximum: fps, preferred: fps)
                link.isPaused = paused
                link.add(to: .main, forMode: .common)
                displayLink = link
                return
            }
        }
        let t = Timer(timeInterval: defaults.integer(forKey: "fps") == 0 ? 1.0 / 30 : 1.0 / 60,
                      target: self, selector: #selector(tick), userInfo: nil, repeats: true)
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    @objc func frameTick(_ sender: AnyObject) { tick() }

    @objc func tick() {
        let now = CACurrentMediaTime()
        let dt = now - last
        last = now
        guard !paused else { return }
        engine.step(dt)
        for o in overlays { o.contentView?.needsDisplay = true }
    }

    // MARK: - Экраны

    func buildOverlays() {
        overlays.forEach { $0.orderOut(nil) }
        overlays = NSScreen.screens.map { makeOverlayWindow(screen: $0, engine: engine) }
        engine.screensChanged()
        if !paused { overlays.forEach { $0.orderFrontRegardless() } }
    }

    @objc func screensChanged() {
        buildOverlays()
        startClock()
    }

    // MARK: - Меню

    func setupMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "❄️"
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        menu.addItem(item("Сюрприз 🚀", #selector(surprise)))
        menu.addItem(item("Стряхнуть весь снег", #selector(shake)))
        menu.addItem(.separator())
        menu.addItem(item(paused ? "Продолжить" : "Пауза", #selector(togglePause)))
        let settings = item("Настройки…", #selector(openSettings))
        settings.keyEquivalent = ","
        menu.addItem(settings)
        menu.addItem(item("Выйти", #selector(quit)))
    }

    // MARK: Окно настроек

    var settingsWindow: SettingsWindow?

    func loadGarland() {
        var g = GarlandSettings()
        g.enabled = defaults.bool(forKey: "garland")
        g.onDock = defaults.bool(forKey: "gDock")
        g.onMenuBar = defaults.bool(forKey: "gMenu")
        g.onWindows = defaults.bool(forKey: "gWin")
        g.mode = defaults.integer(forKey: "gMode")
        g.palette = defaults.integer(forKey: "gPalette")
        g.brightness = CGFloat(defaults.double(forKey: "gBright"))
        engine.garland = g
    }

    private func setDefault(_ key: String, _ value: Any) {
        defaults.set(value, forKey: key)
        loadGarland()
    }

    @objc func openSettings() {
        settingsWindow?.window.close()
        let w = SettingsWindow(title: "Сугроб — настройки")

        w.section("Снег")
        w.checkbox("", "Снег идёт", on: engine.snowing) { [weak self] on in
            self?.engine.snowing = on
            self?.defaults.set(on, forKey: "snowing")
        }
        w.popup("Интенсивность:", levels.map { $0.0 }, selected: defaults.integer(forKey: "level")) { [weak self] i in
            guard let self else { return }
            self.defaults.set(i, forKey: "level")
            self.engine.intensity = self.levels[i].1
        }
        w.checkbox("", "Быстрые сугробы (копятся в 5 раз быстрее)", on: engine.fastPiles) { [weak self] on in
            self?.engine.fastPiles = on
            self?.defaults.set(on, forKey: "fastPiles")
        }
        w.checkbox("", "Снег на Dock", on: engine.dockEnabled) { [weak self] on in
            self?.engine.dockEnabled = on
            self?.defaults.set(on, forKey: "dock")
        }
        w.checkbox("", "Снег за окнами (падает только над рабочим столом)", on: engine.snowBehindWindows) { [weak self] on in
            self?.engine.snowBehindWindows = on
            self?.defaults.set(on, forKey: "behind")
        }

        w.column()      // вторая колонка — окно широкое, а не высокое
        w.section("Гирлянда")
        w.checkbox("", "Включить гирлянду", on: defaults.bool(forKey: "garland")) { [weak self] on in
            self?.setDefault("garland", on)
        }
        w.checkboxes("Где:", [("Dock", defaults.bool(forKey: "gDock")),
                              ("Строка меню", defaults.bool(forKey: "gMenu")),
                              ("Окна", defaults.bool(forKey: "gWin"))]) { [weak self] i, on in
            self?.setDefault(["gDock", "gMenu", "gWin"][i], on)
        }
        w.popup("Режим:", GarlandSettings.modes, selected: defaults.integer(forKey: "gMode")) { [weak self] i in
            self?.setDefault("gMode", i)
        }
        w.popup("Цвета:", GarlandSettings.palettes.map { $0.0 }, selected: defaults.integer(forKey: "gPalette")) { [weak self] i in
            self?.setDefault("gPalette", i)
        }
        w.slider("Яркость:", value: defaults.double(forKey: "gBright"), min: 0.3, max: 1) { [weak self] v in
            self?.setDefault("gBright", v)
        }

        w.section("Производительность")
        w.popup("Плавность:", ["30 кадров/с (меньше нагрев)", "60 кадров/с"], selected: defaults.integer(forKey: "fps")) { [weak self] i in
            self?.defaults.set(i, forKey: "fps")
            self?.startClock()
        }

        if !AXIsProcessTrusted() {
            w.section("Dock")
            w.button("", "Точнее определять Dock…") { [weak self] in self?.askAccessibility() }
            w.note("Без доступа «Универсальный доступ» положение Dock оценивается приблизительно.")
        }

        w.onClose = { [weak self] in self?.settingsWindow = nil }
        settingsWindow = w
        w.show()
    }

    private func item(_ title: String, _ action: Selector) -> NSMenuItem {
        let it = NSMenuItem(title: title, action: action, keyEquivalent: "")
        it.target = self
        return it
    }

    @objc func askAccessibility() {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        _ = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
    }

    @objc func shake() { engine.shakeAll() }

    @objc func surprise() {
        if paused { togglePause() }
        engine.launchSurprise()
    }

    @objc func togglePause() {
        paused.toggle()
        if #available(macOS 14.0, *) { (displayLink as? CADisplayLink)?.isPaused = paused }   // на паузе — ноль нагрузки
        if paused { overlays.forEach { $0.orderOut(nil) } }
        else { last = CACurrentMediaTime(); overlays.forEach { $0.orderFrontRegardless() } }
    }

    @objc func quit() { NSApp.terminate(nil) }
}
