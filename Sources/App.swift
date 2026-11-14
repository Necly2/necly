import Cocoa
import IOKit.ps
import ServiceManagement

@main
struct NeSpatMain {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)   // только иконка в строке меню, без Dock
        withExtendedLifetime(delegate) { app.run() }
    }
}

/// Управление сном через `pmset -a disablesleep`. Только этот режим не даёт Mac
/// уснуть при закрытой крышке без внешнего монитора, а ему нужны права администратора.
/// Поэтому при первом включении приложение один раз просит пароль и добавляет правило
/// в /etc/sudoers.d/nespat, разрешающее ровно две команды:
///   pmset -a disablesleep 1  и  pmset -a disablesleep 0
enum Sleep {
    static let sudoersPath = "/etc/sudoers.d/nespat"

    /// Текущее состояние системы (SleepDisabled в `pmset -g`).
    static var isDisabled: Bool {
        let out = run("/usr/bin/pmset", ["-g"]).output
        for line in out.components(separatedBy: "\n") where line.contains("SleepDisabled") {
            return line.trimmingCharacters(in: .whitespaces).hasSuffix("1")
        }
        return false
    }

    /// Включить/выключить. Возвращает false, если пользователь отменил ввод пароля.
    @discardableResult
    static func set(_ on: Bool) -> Bool {
        let v = on ? "1" : "0"
        // Обычный путь — без пароля через правило sudoers
        if run("/usr/bin/sudo", ["-n", "/usr/bin/pmset", "-a", "disablesleep", v]).status == 0 {
            return true
        }
        // Правила ещё нет (первый запуск) — ставим его и сразу применяем, один запрос пароля
        let user = NSUserName()
        let rule = "\(user) ALL=(root) NOPASSWD: /usr/bin/pmset -a disablesleep 0, /usr/bin/pmset -a disablesleep 1"
        let shell = """
        T=$(mktemp) && echo '\(rule)' > "$T" && /usr/sbin/visudo -cf "$T" >/dev/null && \
        /usr/bin/install -m 0440 -o root -g wheel "$T" \(sudoersPath); rm -f "$T"; \
        /usr/bin/pmset -a disablesleep \(v)
        """
        let escaped = shell.replacingOccurrences(of: "\\", with: "\\\\")
                           .replacingOccurrences(of: "\"", with: "\\\"")
        let source = "do shell script \"\(escaped)\" with prompt \"«Не спать» нужно один раз разрешить управлять сном Mac.\" with administrator privileges"
        var error: NSDictionary?
        NSAppleScript(source: source)?.executeAndReturnError(&error)
        return error == nil
    }

    @discardableResult
    static func run(_ tool: String, _ args: [String]) -> (status: Int32, output: String) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: tool)
        p.arguments = args
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = Pipe()
        do { try p.run() } catch { return (-1, "") }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return (p.terminationStatus, String(data: data, encoding: .utf8) ?? "")
    }
}

/// Заряд батареи: (процент, работает ли от батареи). nil — батареи нет.
func batteryState() -> (percent: Int, onBattery: Bool)? {
    guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
          let list = IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef] else { return nil }
    for ps in list {
        guard let d = IOPSGetPowerSourceDescription(info, ps)?.takeUnretainedValue() as? [String: Any],
              let cur = d[kIOPSCurrentCapacityKey] as? Int,
              let max = d[kIOPSMaxCapacityKey] as? Int, max > 0 else { continue }
        let state = d[kIOPSPowerSourceStateKey] as? String
        return (cur * 100 / max, state == kIOPSBatteryPowerValue)
    }
    return nil
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    var statusItem: NSStatusItem!
    let menu = NSMenu()
    let defaults = UserDefaults.standard
    let updater = Updater(appName: "NeSpat", title: "Не спать", tag: "nespat-latest", zipName: "NeSpat.zip")
    var batteryTimer: Timer?
    var on = false

    func applicationDidFinishLaunching(_ n: Notification) {
        defaults.register(defaults: ["restoreOnLaunch": true, "lowBatteryOff": true, "lastOn": false])
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        menu.delegate = self
        statusItem.menu = menu

        on = Sleep.isDisabled
        if !on && defaults.bool(forKey: "restoreOnLaunch") && defaults.bool(forKey: "lastOn") {
            apply(true)
        }
        refreshIcon()

        // Раз в минуту — защита от разряда батареи в рюкзаке
        let t = Timer(timeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.checkBattery() }
        }
        RunLoop.main.add(t, forMode: .common)
        batteryTimer = t

        updater.start()
    }

    func applicationWillTerminate(_ n: Notification) {
        // При выходе возвращаем обычный сон, чтобы Mac не остался «бессонным» навсегда
        if on { Sleep.set(false) }
    }

    // MARK: Состояние

    func apply(_ want: Bool) {
        if Sleep.set(want) {
            on = Sleep.isDisabled
            defaults.set(on, forKey: "lastOn")
        }
        refreshIcon()
    }

    func refreshIcon() {
        let name = on ? "cup.and.saucer.fill" : "moon.zzz"
        let img = NSImage(systemSymbolName: name, accessibilityDescription: on ? "Не спать: вкл" : "Не спать: выкл")
        img?.isTemplate = true
        statusItem.button?.image = img
        statusItem.button?.toolTip = on ? "Mac не засыпает, даже с закрытой крышкой" : "Обычный режим сна"
    }

    func checkBattery() {
        guard on, defaults.bool(forKey: "lowBatteryOff"),
              let b = batteryState(), b.onBattery, b.percent <= 10 else { return }
        apply(false)
        let a = NSAlert()
        a.messageText = "«Не спать» выключено"
        a.informativeText = "Заряд батареи \(b.percent)% — Mac снова будет засыпать при закрытии крышки."
        NSApp.activate(ignoringOtherApps: true)
        a.runModal()
    }

    // MARK: Меню

    func menuNeedsUpdate(_ m: NSMenu) {
        on = Sleep.isDisabled   // вдруг состояние поменяли из Терминала
        refreshIcon()
        m.removeAllItems()

        let toggle = NSMenuItem(title: "Не засыпать при закрытой крышке", action: #selector(toggle), keyEquivalent: "")
        toggle.state = on ? .on : .off
        toggle.target = self
        m.addItem(toggle)

        let status = NSMenuItem(title: on ? "Сейчас: Mac не спит ☕️" : "Сейчас: обычный сон", action: nil, keyEquivalent: "")
        status.isEnabled = false
        m.addItem(status)

        m.addItem(.separator())
        m.addItem(check("Выключать при заряде ниже 10%", key: "lowBatteryOff"))
        m.addItem(check("Восстанавливать режим при запуске", key: "restoreOnLaunch"))

        let login = NSMenuItem(title: "Открывать при входе в систему", action: #selector(toggleLogin), keyEquivalent: "")
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        login.target = self
        m.addItem(login)

        m.addItem(.separator())
        if let b = updater.available {
            let u = NSMenuItem(title: "Установить обновление (сборка \(b))…", action: #selector(installUpdate), keyEquivalent: "")
            u.target = self
            m.addItem(u)
        }
        let upd = NSMenuItem(title: "Проверить обновления…", action: #selector(checkUpdates), keyEquivalent: "")
        upd.target = self
        m.addItem(upd)
        let ver = NSMenuItem(title: "Сборка \(updater.currentBuild)", action: nil, keyEquivalent: "")
        ver.isEnabled = false
        m.addItem(ver)

        m.addItem(.separator())
        let quit = NSMenuItem(title: "Выйти", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        m.addItem(quit)
    }

    func check(_ title: String, key: String) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: #selector(toggleDefault(_:)), keyEquivalent: "")
        i.representedObject = key
        i.state = defaults.bool(forKey: key) ? .on : .off
        i.target = self
        return i
    }

    @objc func toggle() { apply(!on) }

    @objc func toggleDefault(_ sender: NSMenuItem) {
        guard let key = sender.representedObject as? String else { return }
        defaults.set(!defaults.bool(forKey: key), forKey: key)
    }

    @objc func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
            else { try SMAppService.mainApp.register() }
        } catch {
            let a = NSAlert()
            a.messageText = "Не удалось изменить автозапуск"
            a.informativeText = "Перенесите «Не спать» в «Программы» и попробуйте ещё раз. (\(error.localizedDescription))"
            NSApp.activate(ignoringOtherApps: true)
            a.runModal()
        }
    }

    @objc func checkUpdates() { Task { await updater.check(interactive: true) } }
    @objc func installUpdate() { if let b = updater.available { updater.offer(b) } }
    @objc func quit() { NSApp.terminate(nil) }
}
