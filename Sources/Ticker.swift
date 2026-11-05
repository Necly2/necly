import Cocoa

// MARK: - Настройки внешнего вида

struct TickerTheme {
    let name: String
    let background: NSColor
    let text: NSColor

    static func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat) -> NSColor {
        NSColor(srgbRed: r / 255, green: g / 255, blue: b / 255, alpha: 1)
    }

    static let all: [TickerTheme] = [
        TickerTheme(name: "ТАСС (белый на синем)", background: rgb(22, 32, 138), text: .white),
        TickerTheme(name: "Белый на чёрном", background: rgb(12, 12, 12), text: .white),
        TickerTheme(name: "Чёрный на белом", background: rgb(250, 250, 250), text: rgb(15, 15, 15)),
        TickerTheme(name: "Белый на тёмно-зелёном", background: rgb(21, 87, 54), text: .white),
    ]
}

struct TickerSize {
    let name: String
    let fontSize: CGFloat
    let height: CGFloat

    static let all: [TickerSize] = [
        TickerSize(name: "Компактный", fontSize: 12, height: 22),
        TickerSize(name: "Обычный", fontSize: 14, height: 27),
        TickerSize(name: "Крупный", fontSize: 17, height: 32),
    ]
}

enum TickerPosition: Int, CaseIterable {
    case underMenuBar, aboveDock, leftOfDock, rightOfDock, bottomFull

    var title: String {
        switch self {
        case .underMenuBar: return "Под строкой меню"
        case .aboveDock: return "Над Dock (по ширине Dock)"
        case .leftOfDock: return "Слева от Dock"
        case .rightOfDock: return "Справа от Dock"
        case .bottomFull: return "Внизу на всю ширину (поверх Dock)"
        }
    }

    /// Полоса во всю ширину экрана — без скруглений.
    var isFullWidth: Bool { self == .underMenuBar || self == .bottomFull }
    var followsDock: Bool { self == .aboveDock || self == .leftOfDock || self == .rightOfDock }
}

// MARK: - Бегущая строка

final class TickerView: NSView {
    struct Segment {
        let text: NSAttributedString
        let width: CGFloat
        let link: URL?
    }

    var segments: [Segment] = []
    var totalWidth: CGFloat = 0
    var offset: CGFloat = 0
    var speed: CGFloat = 51                // точек в секунду
    var hovering = false
    var paused = false
    var onOpen: ((URL) -> Void)?

    var theme = TickerTheme.all[0] { didSet { rebuild() } }
    var fontSize: CGFloat = 14 { didSet { rebuild() } }
    var cornerRadius: CGFloat = 0 { didSet { needsDisplay = true } }

    private var tracking: NSTrackingArea?
    private var lastItems: [Headline] = []
    private var lastSource = ""
    private var lastMessage: String? = "Загрузка заголовков…"

    private var font: NSFont { NSFont.systemFont(ofSize: fontSize, weight: .medium) }
    private var timeFont: NSFont { NSFont.monospacedDigitSystemFont(ofSize: fontSize - 1, weight: .regular) }
    private var sourceFont: NSFont { NSFont.systemFont(ofSize: fontSize, weight: .heavy) }

    override var isFlipped: Bool { true }

    // MARK: Содержимое

    func setHeadlines(_ items: [Headline], source: String) {
        lastItems = items
        lastSource = source
        lastMessage = nil
        rebuild()
    }

    func setMessage(_ text: String) {
        lastMessage = text
        rebuild()
    }

    private func rebuild() {
        let fg = theme.text
        if let msg = lastMessage {
            let s = NSAttributedString(string: "   " + msg, attributes: [
                .font: font, .foregroundColor: fg.withAlphaComponent(0.85),
            ])
            segments = [Segment(text: s, width: max(bounds.width, 1) + 1, link: nil)]
            totalWidth = 0          // сообщение не прокручиваем
            offset = 0
            needsDisplay = true
            return
        }

        let df = DateFormatter()
        df.dateFormat = "HH:mm"
        var segs: [Segment] = []
        let src = NSAttributedString(string: "  \(lastSource)  ", attributes: [
            .font: sourceFont, .foregroundColor: fg,
        ])
        segs.append(Segment(text: src, width: ceil(src.size().width), link: nil))

        for (i, h) in lastItems.enumerated() {
            let s = NSMutableAttributedString()
            if let d = h.date {
                s.append(NSAttributedString(string: df.string(from: d) + "  ", attributes: [
                    .font: timeFont, .foregroundColor: fg.withAlphaComponent(0.72),
                ]))
            }
            s.append(NSAttributedString(string: h.title, attributes: [
                .font: font, .foregroundColor: fg,
            ]))
            let sep = i == lastItems.count - 1 ? "      " : "    •    "
            s.append(NSAttributedString(string: sep, attributes: [
                .font: font, .foregroundColor: fg.withAlphaComponent(0.55),
            ]))
            segs.append(Segment(text: s, width: ceil(s.size().width), link: h.link))
        }
        segments = segs
        totalWidth = segs.reduce(0) { $0 + $1.width }
        if offset > totalWidth { offset = 0 }
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
        theme.background.setFill()
        let bg = NSBezierPath(roundedRect: bounds, xRadius: cornerRadius, yRadius: cornerRadius)
        bg.fill()
        guard !segments.isEmpty else { return }

        NSGraphicsContext.saveGraphicsState()
        bg.addClip()
        let f = font
        let y = (bounds.height - (f.ascender - f.descender)) / 2 - 0.5
        let pad = cornerRadius * 0.6
        if totalWidth <= 0 {
            segments[0].text.draw(at: NSPoint(x: pad, y: y))
        } else {
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
        NSGraphicsContext.restoreGraphicsState()
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

// MARK: - Окно-полоса

@MainActor
final class TickerPanel {
    let window: NSPanel
    let ticker: TickerView
    var position: TickerPosition = .underMenuBar
    var size: TickerSize = TickerSize.all[1]

    init() {
        window = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel],
                         backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.level = .statusBar            // выше Dock
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        window.isReleasedWhenClosed = false
        window.hidesOnDeactivate = false
        window.becomesKeyOnlyIfNeeded = true

        ticker = TickerView()
        ticker.autoresizingMask = [.width, .height]
        window.contentView = ticker
        place()
    }

    /// Ставит полосу в выбранное место главного экрана.
    func place() {
        guard let screen = NSScreen.screens.first else { return }
        let f = screen.frame
        let vf = screen.visibleFrame
        let h = size.height
        let margin: CGFloat = 6
        var rect: NSRect

        // Dock в координатах Cocoa (низ-лево).
        let dock = DockInfo.frameInCocoa()

        switch position {
        case .underMenuBar:
            rect = NSRect(x: f.minX, y: vf.maxY - h, width: f.width, height: h)
        case .bottomFull:
            rect = NSRect(x: f.minX, y: f.minY, width: f.width, height: h)
        case .aboveDock:
            if let d = dock {
                rect = NSRect(x: d.minX, y: d.maxY + margin, width: d.width, height: h)
            } else {
                let w = f.width * 0.6
                rect = NSRect(x: f.midX - w / 2, y: vf.minY + margin, width: w, height: h)
            }
        case .leftOfDock:
            if let d = dock {
                let x = f.minX + margin
                rect = NSRect(x: x, y: d.midY - h / 2, width: max(160, d.minX - margin - x), height: h)
            } else {
                rect = NSRect(x: f.minX + margin, y: vf.minY + margin, width: f.width * 0.3, height: h)
            }
        case .rightOfDock:
            if let d = dock {
                let x = d.maxX + margin
                rect = NSRect(x: x, y: d.midY - h / 2, width: max(160, f.maxX - margin - x), height: h)
            } else {
                let w = f.width * 0.3
                rect = NSRect(x: f.maxX - margin - w, y: vf.minY + margin, width: w, height: h)
            }
        }
        rect = rect.integral
        if window.frame != rect { window.setFrame(rect, display: true) }
        ticker.frame = NSRect(origin: .zero, size: rect.size)
        ticker.cornerRadius = position.isFullWidth ? 0 : min(10, h * 0.35)
        if ticker.fontSize != size.fontSize { ticker.fontSize = size.fontSize }
    }

    /// Клики проходят насквозь, пока не зажат ⌥ — так полоса не мешает окнам под ней.
    func updateClickThrough() {
        let option = NSEvent.modifierFlags.contains(.option)
        if window.ignoresMouseEvents == option { window.ignoresMouseEvents = !option }
        if !option && ticker.hovering { ticker.hovering = false; NSCursor.arrow.set() }
    }
}
