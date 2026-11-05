import Cocoa

// MARK: - Настройки внешнего вида

struct TickerTheme {
    let name: String
    let background: NSColor
    let text: NSColor
    let up: NSColor      // рост котировки
    let down: NSColor    // падение

    static func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat) -> NSColor {
        NSColor(srgbRed: r / 255, green: g / 255, blue: b / 255, alpha: 1)
    }

    static let all: [TickerTheme] = [
        TickerTheme(name: "ТАСС (белый на синем)", background: rgb(22, 32, 138), text: .white,
                    up: rgb(120, 240, 150), down: rgb(255, 140, 140)),
        TickerTheme(name: "Белый на чёрном", background: rgb(12, 12, 12), text: .white,
                    up: rgb(80, 220, 110), down: rgb(255, 95, 95)),
        TickerTheme(name: "Чёрный на белом", background: rgb(250, 250, 250), text: rgb(15, 15, 15),
                    up: rgb(0, 130, 55), down: rgb(200, 25, 25)),
        TickerTheme(name: "Белый на тёмно-зелёном", background: rgb(21, 87, 54), text: .white,
                    up: rgb(170, 255, 170), down: rgb(255, 160, 150)),
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
    case underMenuBar, aboveDock, leftOfDock, rightOfDock, bottomFull, besideDock

    var title: String {
        switch self {
        case .underMenuBar: return "Под строкой меню"
        case .aboveDock: return "Над Dock (по ширине Dock)"
        case .leftOfDock: return "Слева от Dock"
        case .rightOfDock: return "Справа от Dock"
        case .bottomFull: return "Внизу на всю ширину (поверх Dock)"
        case .besideDock: return "По бокам от Dock (строка проходит за Dock)"
        }
    }

    /// Полоса во всю ширину экрана — без скруглений.
    var isFullWidth: Bool { self != .aboveDock }
    var followsDock: Bool { self == .aboveDock || self == .leftOfDock || self == .rightOfDock || self == .besideDock }
}

// MARK: - Бегущая строка

final class TickerView: NSView {
    struct Segment {
        let text: NSAttributedString
        let width: CGFloat
        let link: URL?
        var key: String? = nil      // заголовок — чтобы перемотать к нему
    }

    static let alertRed = NSColor(srgbRed: 215 / 255, green: 25 / 255, blue: 35 / 255, alpha: 1)

    /// Правила срочных новостей (см. UrgentRules).
    var urgentRules: [[String]] = [] { didSet { rebuild() } }
    var highlightUrgent = true { didSet { rebuild() } }
    private var flashStart: CFTimeInterval = -100
    private var isFlashing: Bool { CACurrentMediaTime() - flashStart < 3.2 }

    /// Тревога: мигаем красным и перематываем строку к срочному заголовку.
    func alert(_ title: String) {
        flashStart = CACurrentMediaTime()
        var x: CGFloat = 0
        for seg in segments {
            if seg.key == title {
                offset = max(0, x - 12)
                break
            }
            x += seg.width
        }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        track.frame.origin.x = -offset
        CATransaction.commit()
        updateFlash()
    }

    var segments: [Segment] = []
    var totalWidth: CGFloat = 0
    var offset: CGFloat = 0
    var speed: CGFloat = 51                // точек в секунду
    var hovering = false
    var paused = false
    var onOpen: ((URL) -> Void)?

    var theme = TickerTheme.all[0] { didSet { layer?.backgroundColor = theme.background.cgColor; rebuild() } }
    var fontSize: CGFloat = 14 { didSet { rebuild() } }
    var cornerRadius: CGFloat = 0 { didSet { layer?.cornerRadius = cornerRadius; rebuild() } }
    /// Вырез под Dock (в координатах полосы): там фона и текста нет.
    var cutout: NSRect? { didSet { updateMask() } }

    // Слои: строка рисуется в картинки один раз, а каждый кадр только сдвигается — это делает видеокарта.
    private let track = CALayer()
    private let flashLayer = CALayer()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layerContentsRedrawPolicy = .never
        let root = layer!
        root.masksToBounds = true
        root.backgroundColor = theme.background.cgColor
        flashLayer.backgroundColor = TickerView.alertRed.cgColor
        flashLayer.opacity = 0
        root.addSublayer(flashLayer)
        root.addSublayer(track)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func layout() {
        super.layout()
        flashLayer.frame = bounds
        updateMask()
        renderLayers()
    }

    private func updateMask() {
        guard let root = layer else { return }
        if let c = cutout {
            let m = CAShapeLayer()
            let path = CGMutablePath()
            path.addRect(bounds)
            path.addRoundedRect(in: c, cornerWidth: 12, cornerHeight: 12)
            m.path = path
            m.fillRule = .evenOdd
            root.mask = m
        } else {
            root.mask = nil
        }
    }

    /// Картинка одного куска строки (текст по центру по высоте).
    private func image(_ text: NSAttributedString, width: CGFloat, height: CGFloat, scale: CGFloat) -> CGImage? {
        let w = Int((width * scale).rounded(.up)), h = Int((height * scale).rounded(.up))
        guard w > 0, h > 0,
              let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.scaleBy(x: scale, y: scale)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
        let f = font
        text.draw(at: NSPoint(x: 0, y: (height - (f.ascender - f.descender)) / 2 + 0.5))
        NSGraphicsContext.restoreGraphicsState()
        return ctx.makeImage()
    }

    /// Пересобрать слои строки (только когда меняется содержимое или размер).
    private func renderLayers() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        track.sublayers?.forEach { $0.removeFromSuperlayer() }
        let h = max(bounds.height, 1)
        guard !segments.isEmpty, bounds.width > 0 else { return }
        let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2

        if totalWidth <= 0 {
            let seg = segments[0]
            let l = CALayer()
            l.frame = CGRect(x: cornerRadius * 0.6, y: 0, width: seg.width, height: h)
            l.contents = image(seg.text, width: seg.width, height: h, scale: scale)
            l.contentsScale = scale
            track.addSublayer(l)
            track.frame = bounds
            return
        }
        let images = segments.map { image($0.text, width: $0.width, height: h, scale: scale) }
        let copies = max(2, Int((bounds.width / totalWidth).rounded(.up)) + 1)
        for k in 0..<copies {
            let c = CALayer()
            c.frame = CGRect(x: CGFloat(k) * totalWidth, y: 0, width: totalWidth, height: h)
            var x: CGFloat = 0
            for (i, seg) in segments.enumerated() {
                let l = CALayer()
                l.frame = CGRect(x: x, y: 0, width: seg.width, height: h)
                l.contents = images[i]          // одна картинка на все копии
                l.contentsScale = scale
                c.addSublayer(l)
                x += seg.width
            }
            track.addSublayer(c)
        }
        track.frame = CGRect(x: -offset, y: 0, width: CGFloat(copies) * totalWidth, height: h)
    }

    private func updateFlash() {
        let e = CACurrentMediaTime() - flashStart
        let k: Float = e < 3.2 ? Float((0.5 + 0.5 * sin(e * 11)) * (max(0, 1 - e / 3.2) * 0.6 + 0.4)) * 0.9 : 0
        if flashLayer.opacity != k {
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            flashLayer.opacity = k
            CATransaction.commit()
        }
    }

    private var tracking: NSTrackingArea?
    private var lastItems: [Headline] = []
    private var lastSource = ""
    private var lastMessage: String? = "Загрузка…"
    private var lastQuotes: [Quote] = []
    /// 0 — новости, 1 — котировки, 2 — котировки и новости.
    var contentMode = 0 { didSet { rebuild() } }

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

    func setQuotes(_ q: [Quote]) {
        lastQuotes = q
        rebuild()
    }

    private var showNews: Bool { contentMode != 1 && lastMessage == nil && !lastItems.isEmpty }
    private var showQuotes: Bool { contentMode != 0 && !lastQuotes.isEmpty }

    private func quoteSegments() -> [Segment] {
        let fg = theme.text
        var segs: [Segment] = []
        for q in lastQuotes {
            let s = NSMutableAttributedString()
            let name: String
            switch q.kind {
            case .currency: name = q.symbol + " ₽"
            default: name = q.symbol
            }
            s.append(NSAttributedString(string: name + " ", attributes: [.font: sourceFont, .foregroundColor: fg]))
            s.append(NSAttributedString(string: QuoteLoader.format(q.value), attributes: [.font: font, .foregroundColor: fg]))
            if let c = q.changePct {
                let up = c >= 0
                let pct = String(format: "%.2f", abs(c)).replacingOccurrences(of: ".", with: ",")
                s.append(NSAttributedString(string: (up ? "  ▲ +" : "  ▼ −") + pct + "%", attributes: [
                    .font: timeFont, .foregroundColor: up ? theme.up : theme.down,
                ]))
            }
            s.append(NSAttributedString(string: "      ", attributes: [.font: font]))
            segs.append(Segment(text: s, width: ceil(s.size().width), link: q.link))
        }
        return segs
    }

    private func rebuild() {
        let fg = theme.text
        if !showNews && !showQuotes, let msg = lastMessage ?? (contentMode == 1 ? "Загрузка котировок…" : nil) {
            let s = NSAttributedString(string: "   " + msg, attributes: [
                .font: font, .foregroundColor: fg.withAlphaComponent(0.85),
            ])
            segments = [Segment(text: s, width: max(bounds.width, 1) + 1, link: nil)]
            totalWidth = 0          // сообщение не прокручиваем
            offset = 0
            renderLayers()
            return
        }

        let df = DateFormatter()
        df.dateFormat = "HH:mm"
        var segs: [Segment] = showQuotes ? quoteSegments() : []
        if !showNews {
            segments = segs
            totalWidth = segs.reduce(0) { $0 + $1.width }
            if offset > totalWidth { offset = 0 }
            renderLayers()
            return
        }
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
            let urgent = highlightUrgent && UrgentRules.matches(h.title, urgentRules)
            if urgent {
                s.append(NSAttributedString(string: " СРОЧНО ", attributes: [
                    .font: NSFont.systemFont(ofSize: fontSize - 2, weight: .black),
                    .foregroundColor: NSColor.white,
                    .backgroundColor: TickerView.alertRed,
                    .baselineOffset: 1,
                ]))
                s.append(NSAttributedString(string: "  ", attributes: [.font: font]))
            }
            s.append(NSAttributedString(string: h.title, attributes: [
                .font: urgent ? NSFont.systemFont(ofSize: fontSize, weight: .bold) : font, .foregroundColor: fg,
            ]))
            let sep = i == lastItems.count - 1 ? "      " : "    •    "
            s.append(NSAttributedString(string: sep, attributes: [
                .font: font, .foregroundColor: fg.withAlphaComponent(0.55),
            ]))
            segs.append(Segment(text: s, width: ceil(s.size().width), link: h.link, key: h.title))
        }
        segments = segs
        totalWidth = segs.reduce(0) { $0 + $1.width }
        if offset > totalWidth { offset = 0 }
        renderLayers()
    }

    // MARK: Анимация

    func advance(_ dt: CGFloat) {
        updateFlash()
        guard totalWidth > 0, !paused, !hovering else { return }
        offset += speed * dt
        if offset >= totalWidth { offset -= totalWidth }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        track.frame.origin.x = -offset
        CATransaction.commit()
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
    /// Вырез под Dock в экранных координатах — там клики всегда уходят в Dock.
    var cutoutInScreen: NSRect?

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
            // От левого края экрана до Dock, на всю высоту Dock.
            if let d = dock {
                let dh = max(h, d.maxY - f.minY)
                rect = NSRect(x: f.minX, y: f.minY, width: max(160, d.minX - margin - f.minX), height: dh)
            } else {
                rect = NSRect(x: f.minX, y: f.minY, width: f.width * 0.3, height: h)
            }
        case .rightOfDock:
            if let d = dock {
                let dh = max(h, d.maxY - f.minY)
                let x = d.maxX + margin
                rect = NSRect(x: x, y: f.minY, width: max(160, f.maxX - x), height: dh)
            } else {
                let w = f.width * 0.3
                rect = NSRect(x: f.maxX - w, y: f.minY, width: w, height: h)
            }
        case .besideDock:
            // Во всю ширину на уровне Dock; сам Dock — вырез, строка проходит «за» ним.
            if let d = dock {
                rect = NSRect(x: f.minX, y: f.minY, width: f.width, height: max(h, d.maxY - f.minY))
            } else {
                rect = NSRect(x: f.minX, y: f.minY, width: f.width, height: h)
            }
        }
        rect = rect.integral
        if window.frame != rect { window.setFrame(rect, display: true) }
        ticker.frame = NSRect(origin: .zero, size: rect.size)
        ticker.cornerRadius = position.isFullWidth ? 0 : min(10, h * 0.35)
        if position == .besideDock, let d = dock {
            ticker.cutout = NSRect(x: d.minX - margin - rect.minX, y: -20,
                                   width: d.width + margin * 2, height: rect.height + 40)
        } else {
            ticker.cutout = nil
        }
        cutoutInScreen = ticker.cutout.map { NSRect(x: $0.minX + rect.minX, y: rect.minY, width: $0.width, height: rect.height) }
        if ticker.fontSize != size.fontSize { ticker.fontSize = size.fontSize }
    }

    /// Клики проходят насквозь, пока не зажат ⌥ — так полоса не мешает окнам под ней.
    func updateClickThrough() {
        var option = NSEvent.modifierFlags.contains(.option)
        if let c = cutoutInScreen, c.contains(NSEvent.mouseLocation) { option = false }
        if window.ignoresMouseEvents == option { window.ignoresMouseEvents = !option }
        if !option && ticker.hovering { ticker.hovering = false; NSCursor.arrow.set() }
    }
}
