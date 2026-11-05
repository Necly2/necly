import Cocoa

/// Ширина одной «колонки» сугроба в точках.
let colW: CGFloat = 3

/// Поверхность, на которой копится снег: верхняя кромка окна или Dock.
final class Surface {
    let id: Int
    var frame: CGRect          // глобальные координаты (верх-лево)
    var heights: [CGFloat]     // высота снега в каждой колонке
    var visible: [Bool]        // колонка не закрыта окном спереди
    var velocity = CGVector.zero
    let isDock: Bool

    init(id: Int, frame: CGRect, isDock: Bool = false) {
        self.id = id
        self.frame = frame
        self.isDock = isDock
        let n = Surface.columns(for: frame.width)
        heights = [CGFloat](repeating: 0, count: n)
        visible = [Bool](repeating: true, count: n)
    }

    static func columns(for width: CGFloat) -> Int { max(1, Int(width / colW)) }

    var top: CGFloat { frame.minY }
    var maxHeight: CGFloat { isDock ? 14 : 18 }

    func colX(_ i: Int) -> CGFloat { frame.minX + (CGFloat(i) + 0.5) * colW }

    func column(at x: CGFloat) -> Int? {
        let v = (x - frame.minX) / colW
        guard v >= 0 else { return nil }
        let i = Int(v)
        return i < heights.count ? i : nil
    }

    /// Предельная высота колонки: к краям сугроб скругляется.
    func cap(_ i: Int) -> CGFloat {
        let n = heights.count
        return min(maxHeight, 2 + CGFloat(min(i, n - 1 - i)) * 1.2)
    }
}

struct Flake {
    var x, y, vx, vy, r: CGFloat
    var phase: CGFloat
    var loose: Bool            // false — падающая снежинка, true — комок сбитого снега
    var alpha: CGFloat
    var ignoreID: Int = Int.min
    var ignoreUntil: Double = 0
}

@MainActor
final class SnowEngine {
    // Настройки
    var snowing = true
    var intensity: CGFloat = 4.5      // снежинок в секунду на 100 точек ширины экранов
    var fastPiles = false
    var dockEnabled = true

    private(set) var flakes: [Flake] = []
    private var surfaces: [Int: Surface] = [:]
    private var windowOrder: [Surface] = []
    private(set) var order: [Surface] = []     // спереди назад, Dock первым
    private var dock: Surface?

    private var t: Double = 0
    private var pollAcc: Double = 1
    private var dockAcc: Double = 10
    private var lastPoll: Double = 0
    private var spawnAcc: CGFloat = 0
    private var mouse = CGPoint.zero
    private var mouseV = CGVector.zero
    private var hasMouse = false
    private var wind: CGFloat = 0

    private var bounds = CGRect.null
    private let ownPID = ProcessInfo.processInfo.processIdentifier
    private let maxFlakes = 6000

    init() { screensChanged() }

    func screensChanged() {
        bounds = NSScreen.screens.map(Geo.globalRect).reduce(CGRect.null) { $0.union($1) }
        dockAcc = 10
    }

    // MARK: - Шаг симуляции

    func step(_ dtIn: Double) {
        let dt = CGFloat(min(max(dtIn, 0.001), 1.0 / 20))
        t += dtIn
        wind = sin(CGFloat(t) * 0.13) * 12 + sin(CGFloat(t) * 0.37) * 6

        dockAcc += dtIn
        if dockAcc >= 1.0 {
            dockAcc = 0
            pollDock()
            rebuildOrder()
        }
        pollAcc += dtIn
        if pollAcc >= 1.0 / 30 {
            pollWindows(dt: max(t - lastPoll, 1.0 / 120))
            lastPoll = t
            pollAcc = 0
        }

        updateMouse(dt)
        spawn(dt)
        moveFlakes(dt)
        relax()
        brush()
    }

    // MARK: - Окна

    private func pollWindows(dt: Double) {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements],
                                                    kCGNullWindowID) as? [[String: Any]] else { return }
        var newOrder: [Surface] = []
        var seen = Set<Int>()

        for info in list {
            guard let layer = (info[kCGWindowLayer as String] as? NSNumber)?.intValue, layer == 0,
                  let pid = (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value, pid != ownPID,
                  let id = (info[kCGWindowNumber as String] as? NSNumber)?.intValue,
                  let bd = info[kCGWindowBounds as String] as? NSDictionary,
                  let rect = CGRect(dictionaryRepresentation: bd as CFDictionary)
            else { continue }
            let alpha = (info[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1
            if alpha < 0.1 || rect.width < 120 || rect.height < 60 || seen.contains(id) { continue }
            seen.insert(id)

            let s: Surface
            if let existing = surfaces[id] {
                s = existing
                update(s, to: rect, dt: CGFloat(dt))
            } else {
                s = Surface(id: id, frame: rect)
                surfaces[id] = s
            }
            newOrder.append(s)
        }

        // Окно закрыли или свернули — снег с него падает вниз.
        for (id, s) in surfaces where !seen.contains(id) {
            shed(s, fraction: 1, frame: s.frame, velocity: .zero, spread: 40, ignore: false)
            surfaces[id] = nil
        }

        windowOrder = newOrder
        rebuildOrder()
    }

    private func update(_ s: Surface, to rect: CGRect, dt: CGFloat) {
        let old = s.frame
        let v = CGVector(dx: (rect.minX - old.minX) / dt, dy: (rect.minY - old.minY) / dt)
        let widthChanged = abs(rect.width - old.width) > 0.5
        let heightChanged = abs(rect.height - old.height) > 0.5

        if widthChanged || heightChanged {
            // Изменение размера: всё, что вышло за новые края, осыпается, остальное трясётся.
            remap(s, to: rect, edgeVelocity: v)
            let topMoved = abs(rect.minY - old.minY) > 0.5
            if widthChanged || topMoved {
                shed(s, fraction: 0.2, frame: s.frame, velocity: CGVector(dx: 0, dy: -40), spread: 70, ignore: true)
            }
            s.velocity = .zero
            return
        }

        // Резкий рывок или резкая остановка: снег продолжает лететь с прежней скоростью.
        let dv = hypot(v.dx - s.velocity.dx, v.dy - s.velocity.dy)
        if dv > 2200 {
            let frac = min(1, 0.35 + (dv - 2200) / 3000)
            shed(s, fraction: frac, frame: old, velocity: s.velocity, spread: 120, ignore: true)
        } else if hypot(v.dx, v.dy) > 2600 {
            // Очень быстрое движение — снег сдувает встречным ветром.
            shed(s, fraction: 0.12, frame: rect,
                 velocity: CGVector(dx: v.dx * 0.8, dy: v.dy * 0.8), spread: 100, ignore: true)
        }
        s.frame = rect
        s.velocity = v
    }

    private func remap(_ s: Surface, to rect: CGRect, edgeVelocity v: CGVector) {
        let old = s.frame
        let oldH = s.heights
        let n = Surface.columns(for: rect.width)
        var nh = [CGFloat](repeating: 0, count: n)
        for j in 0..<oldH.count where oldH[j] > 0.3 {
            let x = old.minX + (CGFloat(j) + 0.5) * colW
            let pos = (x - rect.minX) / colW
            if pos >= 0, Int(pos) < n {
                let i = Int(pos)
                nh[i] = max(nh[i], oldH[j])
            } else {
                emit(x: x, top: old.minY, amount: oldH[j],
                     velocity: CGVector(dx: v.dx * 0.6, dy: 0), spread: 50, ignoreID: s.id)
            }
        }
        s.frame = rect
        s.heights = nh
        s.visible = [Bool](repeating: true, count: n)
    }

    // MARK: - Dock

    private func pollDock() {
        var rect: CGRect? = nil
        if dockEnabled, let r = DockInfo.frame(), r.minY < bounds.maxY - 2, r.intersects(bounds) {
            rect = r
        }
        guard let r = rect else {
            if let d = dock {
                shed(d, fraction: 1, frame: d.frame, velocity: .zero, spread: 30, ignore: false)
                dock = nil
            }
            return
        }
        if let d = dock {
            if d.frame != r { remap(d, to: r, edgeVelocity: .zero) }
        } else {
            dock = Surface(id: -1, frame: r, isDock: true)
        }
    }

    private func rebuildOrder() {
        order = (dock.map { [$0] } ?? []) + windowOrder
        computeVisibility()
    }

    /// Прячем сугробы, которые закрыты окнами, лежащими спереди.
    private func computeVisibility() {
        for (k, s) in order.enumerated() {
            let n = s.heights.count
            if s.visible.count != n { s.visible = [Bool](repeating: true, count: n) }
            let band = s.top - s.maxHeight - 2
            var occluders: [CGRect] = []
            for o in order[..<k] {
                let r = o.frame
                if r.minY <= s.top + 1, r.maxY >= band, r.maxX > s.frame.minX, r.minX < s.frame.maxX {
                    occluders.append(r)
                }
            }
            for i in 0..<n {
                let x = s.colX(i)
                var vis = true
                for r in occluders where x >= r.minX && x < r.maxX {
                    vis = false
                    break
                }
                s.visible[i] = vis
            }
        }
    }

    // MARK: - Снежинки

    private func spawn(_ dt: CGFloat) {
        guard snowing, !bounds.isNull else { return }
        spawnAcc += intensity * bounds.width / 100 * dt
        while spawnAcc >= 1 {
            spawnAcc -= 1
            if flakes.count >= maxFlakes { spawnAcc = 0; break }
            let r = CGFloat.random(in: 1.2...3.4)
            flakes.append(Flake(
                x: CGFloat.random(in: bounds.minX...bounds.maxX),
                y: bounds.minY - 5,
                vx: CGFloat.random(in: -8...8),
                vy: 35 + r * 14 + CGFloat.random(in: 0...15),
                r: r,
                phase: CGFloat.random(in: 0...(2 * .pi)),
                loose: false,
                alpha: CGFloat.random(in: 0.65...0.95)))
        }
    }

    private func moveFlakes(_ dt: CGFloat) {
        let time = CGFloat(t)
        let depositScale: CGFloat = fastPiles ? 5 : 1
        var i = 0
        while i < flakes.count {
            var f = flakes[i]
            let prevY = f.y

            if f.loose {
                f.vy += 1100 * dt
                f.vx *= (1 - 0.8 * dt)
                f.x += f.vx * dt
                f.y += f.vy * dt
            } else {
                let sway = sin(time * 1.3 + f.phase) * 14
                f.x += (f.vx + sway + wind) * dt
                f.y += f.vy * dt
            }

            // Снежинки расступаются вокруг курсора.
            if hasMouse {
                let dx = f.x - mouse.x, dy = f.y - mouse.y
                let d2 = dx * dx + dy * dy
                if d2 < 900, d2 > 0.01 {
                    let d = d2.squareRoot()
                    let push = (30 - d) * 0.25
                    f.x += dx / d * push
                    f.y += dy / d * push
                }
            }

            // Приземление на окно или Dock.
            var landed = false
            if !f.loose || f.vy > 0 {
                for s in order {
                    if f.loose && f.ignoreID == s.id && t < f.ignoreUntil { continue }
                    guard let c = s.column(at: f.x) else { continue }
                    let sy = s.top - s.heights[c]
                    if prevY <= sy + 0.5, f.y >= sy, s.visible[c] {
                        deposit(s, c, f.loose ? f.r * 0.9 : f.r * 0.55 * depositScale)
                        landed = true
                        break
                    }
                }
            }

            let dead = landed || f.y > bounds.maxY + 10 || f.x < bounds.minX - 60 || f.x > bounds.maxX + 60
            if dead {
                flakes.swapAt(i, flakes.count - 1)
                flakes.removeLast()
            } else {
                flakes[i] = f
                i += 1
            }
        }
    }

    private func deposit(_ s: Surface, _ c: Int, _ amt: CGFloat) {
        let n = s.heights.count
        s.heights[c] = min(s.cap(c), s.heights[c] + amt * 0.5)
        if c > 0 { s.heights[c - 1] = min(s.cap(c - 1), s.heights[c - 1] + amt * 0.25) }
        if c < n - 1 { s.heights[c + 1] = min(s.cap(c + 1), s.heights[c + 1] + amt * 0.25) }
    }

    /// Осыпание: слишком крутые склоны сугроба сглаживаются.
    private func relax() {
        for s in order {
            let n = s.heights.count
            if n < 2 { continue }
            for i in 0..<(n - 1) {
                let d = s.heights[i] - s.heights[i + 1]
                if abs(d) > 1.6 {
                    let m = (abs(d) - 1.6) * 0.3
                    if d > 0 { s.heights[i] -= m; s.heights[i + 1] += m }
                    else { s.heights[i] += m; s.heights[i + 1] -= m }
                }
            }
        }
    }

    // MARK: - Курсор

    private func updateMouse(_ dt: CGFloat) {
        let p = Geo.toGlobal(NSEvent.mouseLocation)
        if hasMouse {
            let v = CGVector(dx: (p.x - mouse.x) / dt, dy: (p.y - mouse.y) / dt)
            mouseV = CGVector(dx: mouseV.dx * 0.5 + v.dx * 0.5, dy: mouseV.dy * 0.5 + v.dy * 0.5)
        }
        mouse = p
        hasMouse = true
    }

    /// Курсор сметает снег с кромки окна или с Dock.
    private func brush() {
        guard hasMouse, hypot(mouseV.dx, mouseV.dy) > 60 else { return }
        let R: CGFloat = 16
        for s in order {
            let below: CGFloat = s.isDock ? s.frame.height : 8
            guard mouse.y <= s.top + below,
                  mouse.y >= s.top - s.maxHeight - 12,
                  mouse.x >= s.frame.minX - R,
                  mouse.x <= s.frame.maxX + R
            else { continue }
            let i0 = max(0, Int(((mouse.x - R - s.frame.minX) / colW).rounded(.down)))
            let i1 = min(s.heights.count - 1, Int(((mouse.x + R - s.frame.minX) / colW).rounded(.down)))
            if i0 > i1 { continue }
            for i in i0...i1 where s.visible[i] && s.heights[i] > 0.4 {
                let amt = s.heights[i]
                if mouse.y < s.top - amt - 12 { continue }
                s.heights[i] = 0
                let kick = -abs(mouseV.dx) * 0.15 - CGFloat.random(in: 60...180)
                emit(x: s.colX(i), top: s.top, amount: amt,
                     velocity: CGVector(dx: mouseV.dx * 0.5, dy: kick), spread: 50, ignoreID: s.id)
            }
        }
    }

    // MARK: - Комки снега

    private func shed(_ s: Surface, fraction: CGFloat, frame f: CGRect, velocity: CGVector,
                      spread: CGFloat, ignore: Bool) {
        for i in 0..<s.heights.count {
            let amt = s.heights[i] * fraction
            if amt < 0.4 { continue }
            s.heights[i] -= amt
            emit(x: f.minX + (CGFloat(i) + 0.5) * colW, top: f.minY - s.heights[i], amount: amt,
                 velocity: velocity, spread: spread, ignoreID: ignore ? s.id : Int.min)
        }
    }

    private func emit(x: CGFloat, top: CGFloat, amount: CGFloat, velocity: CGVector,
                      spread: CGFloat, ignoreID: Int) {
        let count = max(1, Int(amount / 1.8 + CGFloat.random(in: 0..<1)))
        for _ in 0..<count {
            if flakes.count >= maxFlakes { return }
            var f = Flake(
                x: x + CGFloat.random(in: -1.5...1.5),
                y: top - CGFloat.random(in: 0...max(amount, 0.1)),
                vx: velocity.dx + CGFloat.random(in: -spread...spread),
                vy: velocity.dy + CGFloat.random(in: -spread...(spread * 0.4)),
                r: CGFloat.random(in: 1.1...2.2),
                phase: 0,
                loose: true,
                alpha: 1)
            f.ignoreID = ignoreID
            f.ignoreUntil = t + 0.5
            flakes.append(f)
        }
    }

    /// Стряхнуть весь снег со всех окон и Dock.
    func shakeAll() {
        for s in order {
            shed(s, fraction: 1, frame: s.frame, velocity: CGVector(dx: 0, dy: -120), spread: 140, ignore: true)
        }
    }

    // MARK: - Отрисовка

    func draw(in ctx: CGContext, region: CGRect) {
        // Сугробы
        ctx.saveGState()
        ctx.setShadow(offset: .zero, blur: 3, color: CGColor(gray: 0, alpha: 0.35))
        ctx.setFillColor(CGColor(red: 0.97, green: 0.98, blue: 1, alpha: 1))
        let path = CGMutablePath()
        for s in order where s.frame.insetBy(dx: -4, dy: -30).intersects(region) {
            addPile(s, to: path)
        }
        ctx.addPath(path)
        ctx.fillPath()
        ctx.restoreGState()

        // Снежинки: тонкая тёмная подложка, чтобы их было видно на белых окнах.
        let area = region.insetBy(dx: -4, dy: -4)
        for f in flakes where area.contains(CGPoint(x: f.x, y: f.y)) {
            let rr = f.r + 0.6
            ctx.setFillColor(CGColor(gray: 0, alpha: 0.12 * f.alpha))
            ctx.fillEllipse(in: CGRect(x: f.x - rr, y: f.y - rr, width: rr * 2, height: rr * 2))
            ctx.setFillColor(CGColor(gray: 1, alpha: f.alpha))
            ctx.fillEllipse(in: CGRect(x: f.x - f.r, y: f.y - f.r, width: f.r * 2, height: f.r * 2))
        }
    }

    private func addPile(_ s: Surface, to path: CGMutablePath) {
        let n = s.heights.count
        let top = s.top
        var i = 0
        while i < n {
            if !s.visible[i] || s.heights[i] < 0.3 { i += 1; continue }
            let start = i
            path.move(to: CGPoint(x: s.colX(start) - colW / 2, y: top + 1))
            while i < n && s.visible[i] && s.heights[i] >= 0.3 {
                path.addLine(to: CGPoint(x: s.colX(i), y: top - s.heights[i]))
                i += 1
            }
            path.addLine(to: CGPoint(x: s.colX(i - 1) + colW / 2, y: top + 1))
            path.closeSubpath()
        }
    }
}
