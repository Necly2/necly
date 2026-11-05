import Cocoa

/// Положение Dock (только Dock внизу экрана).
enum DockInfo {
    /// Рамка Dock в координатах Cocoa (начало — левый нижний угол главного экрана).
    @MainActor
    static func frameInCocoa() -> NSRect? {
        guard let g = accessibilityFrame() ?? estimatedFrame() else { return nil }
        let H = NSScreen.screens.first?.frame.height ?? 0
        return NSRect(x: g.minX, y: H - g.maxY, width: g.width, height: g.height)
    }

    /// Точное положение через Accessibility (если приложению выдан «Универсальный доступ»).
    static func accessibilityFrame() -> CGRect? {
        guard AXIsProcessTrusted(),
              let dockApp = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.dock").first
        else { return nil }
        let app = AXUIElementCreateApplication(dockApp.processIdentifier)
        var childrenRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXChildrenAttribute as CFString, &childrenRef) == .success,
              let children = childrenRef as? [AXUIElement] else { return nil }
        for child in children {
            var roleRef: CFTypeRef?
            _ = AXUIElementCopyAttributeValue(child, kAXRoleAttribute as CFString, &roleRef)
            guard (roleRef as? String) == (kAXListRole as String) else { continue }
            var posRef: CFTypeRef?
            var sizeRef: CFTypeRef?
            guard AXUIElementCopyAttributeValue(child, kAXPositionAttribute as CFString, &posRef) == .success,
                  AXUIElementCopyAttributeValue(child, kAXSizeAttribute as CFString, &sizeRef) == .success,
                  let pv = posRef, let sv = sizeRef else { return nil }
            var pos = CGPoint.zero
            var size = CGSize.zero
            _ = AXValueGetValue(pv as! AXValue, .cgPoint, &pos)
            _ = AXValueGetValue(sv as! AXValue, .cgSize, &size)
            let r = CGRect(origin: pos, size: size)
            return (r.width > r.height && r.width > 50) ? r : nil
        }
        return nil
    }

    /// Оценка без разрешений: высота — по рабочей области экрана, ширина — по числу иконок.
    /// Возвращает рамку в глобальных координатах (верх-лево).
    @MainActor
    static func estimatedFrame() -> CGRect? {
        let d = UserDefaults(suiteName: "com.apple.dock")
        if let o = d?.string(forKey: "orientation"), o != "bottom" { return nil }
        guard let screen = NSScreen.screens.first(where: { $0.visibleFrame.minY - $0.frame.minY > 20 })
        else { return nil }
        let H = NSScreen.screens.first?.frame.height ?? 0
        let f = screen.frame
        let sr = CGRect(x: f.minX, y: H - f.maxY, width: f.width, height: f.height)
        let gap = screen.visibleFrame.minY - f.minY

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
            $0.activationPolicy == .regular && $0.bundleIdentifier != "com.apple.finder" &&
            !pinned.contains($0.bundleIdentifier ?? "")
        }.count
        let recents = showRecents ? min(3, (d?.array(forKey: "recent-apps"))?.count ?? 0) : 0
        let slots = CGFloat(1 + persistent.count + running + recents + others + 1)
        let separators: CGFloat = (running + recents > 0 ? 1 : 0) + 1
        let width = min(sr.width - 8, slots * tile + separators * tile * 0.4 + 16)
        let top = H - screen.visibleFrame.minY + 2
        let height = max(10, sr.maxY - top - 4)
        return CGRect(x: sr.midX - width / 2, y: top, width: width, height: height)
    }
}
