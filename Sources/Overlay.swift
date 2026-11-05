import Cocoa

/// Прозрачное окно поверх всего экрана. Клики проходят насквозь.
@MainActor
func makeOverlayWindow(screen: NSScreen, engine: SnowEngine) -> NSWindow {
    let w = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
    w.setFrame(screen.frame, display: false)
    w.isOpaque = false
    w.backgroundColor = .clear
    w.hasShadow = false
    w.ignoresMouseEvents = true
    w.level = .statusBar            // выше Dock, но ниже меню и всплывающих окон
    w.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
    w.isReleasedWhenClosed = false
    w.contentView = SnowView(frame: NSRect(origin: .zero, size: screen.frame.size),
                             engine: engine,
                             screenRect: Geo.globalRect(of: screen))
    return w
}

final class SnowView: NSView {
    let engine: SnowEngine
    let screenRect: CGRect     // рамка этого экрана в глобальных координатах

    init(frame: NSRect, engine: SnowEngine, screenRect: CGRect) {
        self.engine = engine
        self.screenRect = screenRect
        super.init(frame: frame)
        wantsLayer = true
        layer?.drawsAsynchronously = true
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    // Перевёрнутая система координат: Y вниз, как в глобальных координатах.
    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        ctx.clear(bounds)
        ctx.translateBy(x: -screenRect.minX, y: -screenRect.minY)
        engine.draw(in: ctx, region: screenRect)
    }
}
