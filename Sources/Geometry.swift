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
