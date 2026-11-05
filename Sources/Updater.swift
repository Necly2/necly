import Cocoa

/// Автообновление с GitHub: проверяет номер последней сборки, скачивает новую версию,
/// заменяет приложение и перезапускает его.
@MainActor
final class Updater {
    let appName: String      // «Sugrob»
    let title: String        // «Сугроб»
    let tag: String          // «sugrob-latest»
    let zipName: String      // «Sugrob.zip»
    static let base = "https://github.com/Necly2/necly/releases/download/"

    private(set) var available: Int?
    private(set) var busy = false
    private var timer: Timer?
    private let defaults = UserDefaults.standard

    init(appName: String, title: String, tag: String, zipName: String) {
        self.appName = appName
        self.title = title
        self.tag = tag
        self.zipName = zipName
        defaults.register(defaults: ["autoUpdate": true])
    }

    /// Номер сборки этой копии приложения.
    var currentBuild: Int { Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0") ?? 0 }

    var autoUpdate: Bool {
        get { defaults.bool(forKey: "autoUpdate") }
        set { defaults.set(newValue, forKey: "autoUpdate") }
    }

    /// Проверка при запуске (через 15 секунд) и раз в сутки.
    func start() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            guard let self, self.autoUpdate else { return }
            Task { await self.check(interactive: false) }
        }
        let t = Timer(timeInterval: 24 * 3600, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.autoUpdate else { return }
                await self.check(interactive: false)
            }
        }
        t.tolerance = 3600
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func latestBuild() async -> Int? {
        guard let url = URL(string: Updater.base + tag + "/version.txt") else { return nil }
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        req.setValue("\(appName)-updater", forHTTPHeaderField: "User-Agent")
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let s = String(data: data, encoding: .utf8) else { return nil }
        return Int(s.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    /// interactive — пользователь сам нажал «Проверить обновления».
    func check(interactive: Bool) async {
        guard !busy else { return }
        guard let latest = await latestBuild() else {
            if interactive { message("Не удалось проверить обновления", "Нет связи с GitHub. Попробуйте позже.") }
            return
        }
        if latest > currentBuild {
            available = latest
            // Если пользователь уже отказался от этой сборки — сам не напоминаем
            if interactive || defaults.integer(forKey: "skippedBuild") != latest { offer(latest) }
        } else {
            available = nil
            if interactive { message("Установлена последняя версия", "«\(title)», сборка \(currentBuild).") }
        }
    }

    func offer(_ build: Int) {
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.messageText = "Доступна новая версия «\(title)»"
        a.informativeText = "Сборка \(build) (у вас — \(currentBuild)). Приложение скачает её, заменит себя и перезапустится — переустанавливать вручную не нужно."
        a.addButton(withTitle: "Обновить")
        a.addButton(withTitle: "Позже")
        if a.runModal() == .alertFirstButtonReturn {
            Task { await install() }
        } else {
            defaults.set(build, forKey: "skippedBuild")
        }
    }

    func install() async {
        guard !busy else { return }
        let bundle = Bundle.main.bundleURL
        // Приложение, запущенное прямо из «Загрузок» без переноса, macOS запускает из временной копии
        if bundle.path.contains("/AppTranslocation/") ||
            !FileManager.default.isWritableFile(atPath: bundle.deletingLastPathComponent().path) {
            message("Не получается обновить на месте",
                    "Перетащите «\(title)» в папку «Программы», запустите оттуда и повторите обновление.")
            return
        }
        busy = true
        defer { busy = false }
        do {
            guard let url = URL(string: Updater.base + tag + "/" + zipName) else { return }
            let (tmp, resp) = try await URLSession.shared.download(from: url)
            guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            let fm = FileManager.default
            let work = fm.temporaryDirectory.appendingPathComponent("\(appName)-update-\(UUID().uuidString)")
            try fm.createDirectory(at: work, withIntermediateDirectories: true)
            let zip = work.appendingPathComponent(zipName)
            try fm.moveItem(at: tmp, to: zip)
            try run("/usr/bin/ditto", ["-x", "-k", zip.path, work.path])
            let newApp = work.appendingPathComponent("\(appName).app")
            guard fm.fileExists(atPath: newApp.path) else { throw URLError(.cannotDecodeContentData) }
            try? run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", newApp.path])

            // Скрипт дождётся выхода приложения, заменит его новой версией и запустит.
            let pid = ProcessInfo.processInfo.processIdentifier
            let script = """
            while kill -0 \(pid) 2>/dev/null; do sleep 0.2; done
            rm -rf "\(bundle.path)"
            mv "\(newApp.path)" "\(bundle.path)"
            open "\(bundle.path)"
            rm -rf "\(work.path)"
            """
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/bin/sh")
            p.arguments = ["-c", script]
            try p.run()
            NSApp.terminate(nil)
        } catch {
            message("Не удалось обновить", "Ошибка: \(error.localizedDescription). Можно скачать новую версию вручную со страницы GitHub.")
        }
    }

    private func run(_ tool: String, _ args: [String]) throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: tool)
        p.arguments = args
        try p.run()
        p.waitUntilExit()
        if p.terminationStatus != 0 { throw URLError(.cannotDecodeContentData) }
    }

    private func message(_ title: String, _ text: String) {
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.messageText = title
        a.informativeText = text
        a.runModal()
    }
}
