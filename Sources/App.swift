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
    let updater = Updater(appName: "Sugrob", title: "Сугроб", tag: "sugrob-latest", zipName: "Sugrob.zip")

    let levels: [(String, CGFloat)] = [("Почти не идёт", 0.25), ("Редкие снежинки", 0.8), ("Лёгкий снег", 2),
                                       ("Снегопад", 4.5), ("Метель", 10)]

    func applicationDidFinishLaunching(_ notification: Notification) {
        defaults.register(defaults: ["level": 3, "fastPiles": false, "dock": true, "snowing": true,
                                     "garland": true, "gDock": true, "gMenu": true, "gWin": false,
                                     "gMode": 0, "gPalette": 0, "gBright": 0.9, "fps": 1, "frameRate": 2,
                                     "weatherMode": 0, "city": "Москва", "cityLat": 55.75, "cityLon": 37.62,
                                     "snowman": true, "snowmanLife": 0, "snowmanStyle": 0, "snowmanMax": 1])
        if defaults.object(forKey: "frameRateSet") == nil {      // перенос старой настройки «30/60»
            defaults.set(defaults.integer(forKey: "fps") == 0 ? 1 : 2, forKey: "frameRate")
            defaults.set(true, forKey: "frameRateSet")
        }
        if defaults.object(forKey: "levelV2") == nil {           // добавились два уровня слабее — сдвигаем старый выбор
            defaults.set(defaults.integer(forKey: "level") + 2, forKey: "level")
            defaults.set(true, forKey: "levelV2")
        }
        engine.snowing = defaults.bool(forKey: "snowing")
        loadGarland()
        let level = min(max(defaults.integer(forKey: "level"), 0), levels.count - 1)
        engine.intensity = levels[level].1
        engine.fastPiles = defaults.bool(forKey: "fastPiles")
        engine.dockEnabled = defaults.bool(forKey: "dock")
        engine.snowBehindWindows = defaults.bool(forKey: "behind")
        loadWeatherAndSnowmen()

        buildOverlays()
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged),
                                               name: NSApplication.didChangeScreenParametersNotification,
                                               object: nil)
        setupMenu()
        updater.start()
        startClock()
        refreshWeather()
        let wt = Timer(timeInterval: 900, target: self, selector: #selector(refreshWeather), userInfo: nil, repeats: true)
        wt.tolerance = 120
        RunLoop.main.add(wt, forMode: .common)
        weatherTimer = wt
    }

    // MARK: Погода и снеговики

    var weatherTimer: Timer?
    var weatherError: String?

    func loadWeatherAndSnowmen() {
        engine.weatherMode = defaults.integer(forKey: "weatherMode")
        engine.snowmanEnabled = defaults.bool(forKey: "snowman")
        engine.snowmanLifetime = defaults.integer(forKey: "snowmanLife")
        engine.snowmanStyle = defaults.integer(forKey: "snowmanStyle")
        engine.maxSnowmen = SnowEngine.snowmanCounts[min(max(defaults.integer(forKey: "snowmanMax"), 0), 2)]
        // Сохранённые снеговики (если они «живут» дольше одного запуска)
        if engine.snowmen.isEmpty, engine.snowmanLifetime != 3,
           let saved = defaults.array(forKey: "snowmen") as? [[Double]] {
            engine.snowmen = saved.compactMap { a in
                a.count == 2 ? Snowman(xFromCenter: CGFloat(a[0]), created: Date(timeIntervalSince1970: a[1]), build: 1) : nil
            }
        }
        engine.onSnowmenChanged = { [weak self] in self?.saveSnowmen() }
    }

    func saveSnowmen() {
        let arr = engine.snowmen.map { [Double($0.xFromCenter), $0.created.timeIntervalSince1970] }
        defaults.set(arr, forKey: "snowmen")
    }

    /// Погода нужна для режима «по погоде» и для снеговиков, которые тают в оттепель.
    var needsWeather: Bool { engine.weatherMode == 1 || engine.snowmanLifetime == 1 }

    @objc func refreshWeather() {
        guard needsWeather else { return }
        let lat = defaults.double(forKey: "cityLat"), lon = defaults.double(forKey: "cityLon")
        Task { @MainActor in
            if let w = await WeatherService.current(lat: lat, lon: lon) {
                self.engine.weather = w
                self.weatherError = nil
            } else {
                self.weatherError = "Не удалось получить погоду"
            }
        }
    }

    func setCity(_ name: String) {
        let q = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }
        Task { @MainActor in
            if let g = await WeatherService.geocode(q) {
                self.defaults.set(g.name, forKey: "city")
                self.defaults.set(g.lat, forKey: "cityLat")
                self.defaults.set(g.lon, forKey: "cityLon")
                self.engine.weather = nil
                self.refreshWeather()
            } else {
                self.weatherError = "Город «\(q)» не найден"
            }
            if self.settingsWindow != nil { self.openSettings() }
        }
    }

    var weatherLine: String {
        let city = defaults.string(forKey: "city") ?? "Москва"
        if let w = engine.weather { return "\(city): \(w.tempText), \(w.description)" }
        return weatherError ?? "\(city): погода загружается…"
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
                // Частота кадров из настроек (до частоты экрана: 120/144/165/240 Гц)
                let fps = FrameRates.fps(defaults.integer(forKey: "frameRate"))
                link.preferredFrameRateRange = CAFrameRateRange(minimum: min(30, fps), maximum: fps, preferred: fps)
                link.isPaused = paused
                link.add(to: .main, forMode: .common)
                displayLink = link
                return
            }
        }
        let t = Timer(timeInterval: 1.0 / Double(FrameRates.fps(defaults.integer(forKey: "frameRate"))),
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
        if needsWeather {
            let wl = NSMenuItem(title: weatherLine, action: nil, keyEquivalent: "")
            wl.isEnabled = false
            menu.addItem(wl)
            menu.addItem(.separator())
        }
        menu.addItem(item("Стряхнуть весь снег", #selector(shake)))
        menu.addItem(.separator())
        menu.addItem(item(paused ? "Продолжить" : "Пауза", #selector(togglePause)))
        if let b = updater.available {
            menu.addItem(item("⬆ Обновить до сборки \(b)…", #selector(installUpdate)))
        }
        menu.addItem(item("Проверить обновления…", #selector(checkUpdates)))
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

        w.section("Погода")
        w.popup("Что показывать:", SnowEngine.weatherModes, selected: defaults.integer(forKey: "weatherMode")) { [weak self] i in
            guard let self else { return }
            self.defaults.set(i, forKey: "weatherMode")
            self.engine.weatherMode = i
            self.refreshWeather()
        }
        w.textField("Город:", value: defaults.string(forKey: "city") ?? "Москва", placeholder: "Москва",
                    button: "Применить", width: 180) { [weak self] v in self?.setCity(v) }
        w.note(weatherLine + ". По погоде: снег — идёт снег, дождь — капли и сугробы тают, ясная морозная ночь — иней на краях окон. Обновление раз в 15 минут.")

        w.column()      // вторая колонка — окно широкое, а не высокое
        w.section("Снеговик")
        w.checkbox("", "Лепить снеговика из кучи снега на Dock", on: engine.snowmanEnabled) { [weak self] on in
            self?.defaults.set(on, forKey: "snowman")
            self?.engine.snowmanEnabled = on
        }
        w.popup("Сколько стоит:", SnowEngine.snowmanLifetimes, selected: defaults.integer(forKey: "snowmanLife")) { [weak self] i in
            guard let self else { return }
            self.defaults.set(i, forKey: "snowmanLife")
            self.engine.snowmanLifetime = i
            self.refreshWeather()
        }
        w.popup("Наряд:", SnowEngine.snowmanStyles, selected: defaults.integer(forKey: "snowmanStyle")) { [weak self] i in
            self?.defaults.set(i, forKey: "snowmanStyle")
            self?.engine.snowmanStyle = i
        }
        w.popup("Сколько может быть:", SnowEngine.snowmanCounts.map { "до \($0)" }, selected: defaults.integer(forKey: "snowmanMax")) { [weak self] i in
            guard let self else { return }
            self.defaults.set(i, forKey: "snowmanMax")
            self.engine.maxSnowmen = SnowEngine.snowmanCounts[i]
            while self.engine.snowmen.count > self.engine.maxSnowmen { self.engine.snowmen.removeFirst() }
            self.saveSnowmen()
        }
        w.button("", "Слепить снеговика сейчас") { [weak self] in self?.engine.buildSnowmanNow() }
        w.button("", "Убрать всех снеговиков") { [weak self] in self?.engine.removeAllSnowmen() }
        w.note("Ведите курсором по снегу на Dock в одну сторону: снег сгребается в кучу, и когда она станет большой — из неё вырастет снеговик.")

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
        w.popup("Частота кадров:", FrameRates.titles, selected: defaults.integer(forKey: "frameRate")) { [weak self] i in
            self?.defaults.set(i, forKey: "frameRate")
            self?.startClock()
        }
        w.note("Ваш экран: до \(FrameRates.screenMax) Гц. Больше кадров — плавнее снег, но выше нагрузка и нагрев; 30–60 — экономно.")

        if !AXIsProcessTrusted() {
            w.section("Dock")
            w.button("", "Точнее определять Dock…") { [weak self] in self?.askAccessibility() }
            w.note("Без доступа «Универсальный доступ» положение Dock оценивается приблизительно.")
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

    @objc func togglePause() {
        paused.toggle()
        if #available(macOS 14.0, *) { (displayLink as? CADisplayLink)?.isPaused = paused }   // на паузе — ноль нагрузки
        if paused { overlays.forEach { $0.orderOut(nil) } }
        else { last = CACurrentMediaTime(); overlays.forEach { $0.orderFrontRegardless() } }
    }

    @objc func checkUpdates() { Task { await updater.check(interactive: true) } }
    @objc func installUpdate() { if let b = updater.available { updater.offer(b) } }

    @objc func quit() { NSApp.terminate(nil) }
}
