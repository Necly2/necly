import Cocoa

/// Полоса с бегущими заголовками под строкой меню.
final class TickerView: NSView {
    struct Segment {
        let text: NSAttributedString
        let width: CGFloat
        let link: URL?
    }

    var segments: [Segment] = []
    var totalWidth: CGFloat = 0
    var offset: CGFloat = 0
    var speed: CGFloat = 60                // точек в секунду
    var hovering = false
    var paused = false
    var onOpen: ((URL) -> Void)?

    private var tracking: NSTrackingArea?
    private let font = NSFont.systemFont(ofSize: 13, weight: .medium)
    private let timeFont = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular)
    private let sourceFont = NSFont.systemFont(ofSize: 13, weight: .bold)

    override var isFlipped: Bool { true }

    // MARK: Содержимое

    func setHeadlines(_ items: [Headline], source: String) {
        let df = DateFormatter()
        df.dateFormat = "HH:mm"
        var segs: [Segment] = []

        let src = NSAttributedString(string: "  \(source)  ", attributes: [
            .font: sourceFont, .foregroundColor: NSColor.systemOrange,
        ])
        segs.append(Segment(text: src, width: ceil(src.size().width), link: nil))

        for (i, h) in items.enumerated() {
            let s = NSMutableAttributedString()
            if let d = h.date {
                s.append(NSAttributedString(string: df.string(from: d) + "  ", attributes: [
                    .font: timeFont, .foregroundColor: NSColor.white.withAlphaComponent(0.55),
                ]))
            }
            s.append(NSAttributedString(string: h.title, attributes: [
                .font: font, .foregroundColor: NSColor.white,
            ]))
            let sep = i == items.count - 1 ? "      " : "    •    "
            s.append(NSAttributedString(string: sep, attributes: [
                .font: font, .foregroundColor: NSColor.white.withAlphaComponent(0.4),
            ]))
            segs.append(Segment(text: s, width: ceil(s.size().width), link: h.link))
        }
        segments = segs
        totalWidth = segs.reduce(0) { $0 + $1.width }
        if offset > totalWidth { offset = 0 }
        needsDisplay = true
    }

    func setMessage(_ text: String) {
        let s = NSAttributedString(string: "   " + text, attributes: [
            .font: font, .foregroundColor: NSColor.white.withAlphaComponent(0.8),
        ])
        segments = [Segment(text: s, width: bounds.width + 1, link: nil)]
        totalWidth = 0          // не прокручиваем
        offset = 0
        needsDisplay = true
    }

    // MARK: Анимация

    func advance(_ dt: CGFloat) {
        guard totalWidth > 0, !paused, !hovering else { return }
        offset += speed * dt
        if offset >= totalWidth { offset -= totalWidth }
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        guard !segments.isEmpty else { return }
        let y = (bounds.height - font.ascender + font.descender) / 2 - 0.5
        if totalWidth <= 0 {
            segments[0].text.draw(at: NSPoint(x: 0, y: y))
            return
        }
        var x = -offset
        var i = 0
        while x < bounds.width {
            let seg = segments[i % segments.count]
            if x + seg.width > 0 { seg.text.draw(at: NSPoint(x: x, y: y)) }
            x += seg.width
            i += 1
            if i > 10_000 { break }
        }
    }

    // MARK: Мышь

    func link(at p: NSPoint) -> URL? {
        guard totalWidth > 0 else { return nil }
        var x = -offset
        var i = 0
        while x < bounds.width {
            let seg = segments[i % segments.count]
            if p.x >= x && p.x < x + seg.width { return seg.link }
            x += seg.width
            i += 1
            if i > 10_000 { break }
        }
        return nil
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let t = tracking { removeTrackingArea(t) }
        let t = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .mouseMoved, .activeAlways],
                               owner: self, userInfo: nil)
        addTrackingArea(t)
        tracking = t
    }

    override func mouseEntered(with event: NSEvent) { hovering = true }
    override func mouseExited(with event: NSEvent) { hovering = false; NSCursor.arrow.set() }
    override func mouseMoved(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        if link(at: p) != nil { NSCursor.pointingHand.set() } else { NSCursor.arrow.set() }
    }

    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        if let url = link(at: p) { onOpen?(url) }
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

/// Окно-полоса: полупрозрачный тёмный фон с размытием.
@MainActor
final class TickerPanel {
    let window: NSPanel
    let ticker: TickerView
    static let height: CGFloat = 24

    init() {
        window = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel],
                         backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.level = .statusBar
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        window.isReleasedWhenClosed = false
        window.hidesOnDeactivate = false
        window.becomesKeyOnlyIfNeeded = true

        let blur = NSVisualEffectView()
        blur.material = .hudWindow
        blur.blendingMode = .behindWindow
        blur.state = .active
        blur.appearance = NSAppearance(named: .darkAqua)

        ticker = TickerView()
        ticker.autoresizingMask = [.width, .height]
        blur.addSubview(ticker)
        window.contentView = blur
        place()
    }

    /// Ставим полосу сразу под строкой меню главного экрана.
    func place() {
        guard let screen = NSScreen.screens.first else { return }
        let f = screen.frame
        let top = screen.visibleFrame.maxY
        let rect = NSRect(x: f.minX, y: top - TickerPanel.height, width: f.width, height: TickerPanel.height)
        window.setFrame(rect, display: true)
        ticker.frame = NSRect(origin: .zero, size: rect.size)
    }

    /// Клики проходят насквозь, пока не зажат ⌥ — так полоса не мешает окнам под ней.
    func updateClickThrough() {
        let option = NSEvent.modifierFlags.contains(.option)
        if window.ignoresMouseEvents == option { window.ignoresMouseEvents = !option }
        if !option && ticker.hovering { ticker.hovering = false; NSCursor.arrow.set() }
    }
}
