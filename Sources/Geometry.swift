import Cocoa

/// Глобальная система координат: начало в левом верхнем углу главного экрана, ось Y вниз.
/// В ней же отдаёт рамки окон CGWindowList и Accessibility API.
@MainActor
enum Geo {
    static var primaryHeight: CGFloat { NSScreen.screens.first?.frame.height ?? 0 }

    /// Точка Cocoa (низ-лево) → глобальная (верх-лево).
    static func toGlobal(_ p: NSPoint) -> CGPoint {
        CGPoint(x: p.x, y: primaryHeight - p.y)
    }

    /// Рамка экрана в глобальных координатах.
    static func globalRect(of screen: NSScreen) -> CGRect {
        let f = screen.frame
        return CGRect(x: f.minX, y: primaryHeight - f.maxY, width: f.width, height: f.height)
    }
}

/// Положение Dock через Accessibility API (нужно разрешение «Универсальный доступ»).
enum DockInfo {
    /// Лучшее доступное положение Dock: точное через Accessibility, иначе — оценка.
    @MainActor
    static func bestFrame() -> CGRect? {
        if let r = frame() { return r }
        return estimatedFrame()
    }

    /// Оценка положения Dock без каких-либо разрешений:
    /// высота — из разницы между рамкой экрана и его рабочей областью,
    /// ширина — по числу иконок из настроек Dock и запущенным приложениям.
    @MainActor
    static func estimatedFrame() -> CGRect? {
        let d = UserDefaults(suiteName: "com.apple.dock")
        if let o = d?.string(forKey: "orientation"), o != "bottom" { return nil }

        // Экран, у которого снизу занято место под Dock.
        guard let screen = NSScreen.screens.first(where: { $0.visibleFrame.minY - $0.frame.minY > 20 })
        else { return nil }   // Dock скрыт или сбоку
        let gap = screen.visibleFrame.minY - screen.frame.minY
        let sr = Geo.globalRect(of: screen)

        var tile = CGFloat(d?.double(forKey: "tilesize") ?? 0)
        if tile < 16 { tile = max(16, gap - 16) }

        let persistent = (d?.array(forKey: "persistent-apps") as? [[String: Any]]) ?? []
        var pinned = Set<String>()
        for item in persistent {
            if let td = item["tile-data"] as? [String: Any], let id = td["bundle-identifier"] as? String {
                pinned.insert(id)
            }
        }
        let others = (d?.array(forKey: "persistent-others"))?.count ?? 0
        let showRecents = (d?.object(forKey: "show-recents") as? Bool) ?? true
        let running = NSWorkspace.shared.runningApplications.filter {
            $0.activationPolicy == .regular &&
            $0.bundleIdentifier != "com.apple.finder" &&
            !pinned.contains($0.bundleIdentifier ?? "")
        }.count
        let recents = showRecents ? min(3, (d?.array(forKey: "recent-apps"))?.count ?? 0) : 0

        let slots = CGFloat(1 + persistent.count + running + recents + others + 1)   // Finder … Корзина
        let separators: CGFloat = (running + recents > 0 ? 1 : 0) + 1
        let width = min(sr.width - 8, slots * tile + separators * tile * 0.4 + 16)
        let top = Geo.primaryHeight - screen.visibleFrame.minY + 2
        let height = max(10, sr.maxY - top - 4)
        return CGRect(x: sr.midX - width / 2, y: top, width: width, height: height)
    }

    static func frame() -> CGRect? {
        guard AXIsProcessTrusted(),
              let dockApp = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.dock").first
        else { return nil }

        let app = AXUIElementCreateApplication(dockApp.processIdentifier)
        var childrenRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXChildrenAttribute as CFString, &childrenRef) == .success,
              let children = childrenRef as? [AXUIElement]
        else { return nil }

        for child in children {
            var roleRef: CFTypeRef?
            _ = AXUIElementCopyAttributeValue(child, kAXRoleAttribute as CFString, &roleRef)
            guard (roleRef as? String) == (kAXListRole as String) else { continue }

            var posRef: CFTypeRef?
            var sizeRef: CFTypeRef?
            guard AXUIElementCopyAttributeValue(child, kAXPositionAttribute as CFString, &posRef) == .success,
                  AXUIElementCopyAttributeValue(child, kAXSizeAttribute as CFString, &sizeRef) == .success,
                  let pv = posRef, let sv = sizeRef
            else { return nil }

            var pos = CGPoint.zero
            var size = CGSize.zero
            _ = AXValueGetValue(pv as! AXValue, .cgPoint, &pos)
            _ = AXValueGetValue(sv as! AXValue, .cgSize, &size)
            let r = CGRect(origin: pos, size: size)
            // Поддерживаем только Dock внизу экрана (он шире, чем выше).
            guard r.width > r.height, r.width > 50 else { return nil }
            return r
        }
        return nil
    }
}
