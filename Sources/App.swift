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
        defaults.register(defaults: ["level": 1, "fastPiles": false, "dock": true])
        let level = min(max(defaults.integer(forKey: "level"), 0), levels.count - 1)
        engine.intensity = levels[level].1
        engine.fastPiles = defaults.bool(forKey: "fastPiles")
        engine.dockEnabled = defaults.bool(forKey: "dock")

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
                link.add(to: .main, forMode: .common)
                displayLink = link
                return
            }
        }
        let t = Timer(timeInterval: 1.0 / 120, target: self, selector: #selector(tick), userInfo: nil, repeats: true)
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

        let snow = item("Снег идёт", #selector(toggleSnowing))
        snow.state = engine.snowing ? .on : .off
        menu.addItem(snow)

        let current = defaults.integer(forKey: "level")
        for (i, l) in levels.enumerated() {
            let it = item("   " + l.0, #selector(setLevel(_:)))
            it.tag = i
            it.state = i == current ? .on : .off
            menu.addItem(it)
        }

        menu.addItem(.separator())
        let fast = item("Быстрые сугробы", #selector(toggleFast))
        fast.state = engine.fastPiles ? .on : .off
        menu.addItem(fast)

        if AXIsProcessTrusted() {
            let d = item("Снег на Dock", #selector(toggleDock))
            d.state = engine.dockEnabled ? .on : .off
            menu.addItem(d)
        } else {
            menu.addItem(item("Снег на Dock: дать доступ…", #selector(askAccessibility)))
        }

        menu.addItem(item("Стряхнуть весь снег", #selector(shake)))
        menu.addItem(.separator())
        menu.addItem(item(paused ? "Продолжить" : "Пауза", #selector(togglePause)))
        menu.addItem(item("Выйти", #selector(quit)))
    }

    private func item(_ title: String, _ action: Selector) -> NSMenuItem {
        let it = NSMenuItem(title: title, action: action, keyEquivalent: "")
        it.target = self
        return it
    }

    @objc func toggleSnowing() { engine.snowing.toggle() }

    @objc func setLevel(_ sender: NSMenuItem) {
        defaults.set(sender.tag, forKey: "level")
        engine.intensity = levels[sender.tag].1
        engine.snowing = true
    }

    @objc func toggleFast() {
        engine.fastPiles.toggle()
        defaults.set(engine.fastPiles, forKey: "fastPiles")
    }

    @objc func toggleDock() {
        engine.dockEnabled.toggle()
        defaults.set(engine.dockEnabled, forKey: "dock")
    }

    @objc func askAccessibility() {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        _ = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
    }

    @objc func shake() { engine.shakeAll() }

    @objc func togglePause() {
        paused.toggle()
        if paused { overlays.forEach { $0.orderOut(nil) } }
        else { last = CACurrentMediaTime(); overlays.forEach { $0.orderFrontRegardless() } }
    }

    @objc func quit() { NSApp.terminate(nil) }
}
