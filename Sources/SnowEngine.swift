import Cocoa

/// Ширина одной «колонки» сугроба в точках.
let colW: CGFloat = 3

/// На macOS 26 (Tahoe) у окон и Dock заметно сильнее скруглены углы.
let isTahoe = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26
let windowCornerRadius: CGFloat = isTahoe ? 24 : 10
let dockCornerRadius: CGFloat = isTahoe ? 20 : 12

/// Поверхность, на которой копится снег: верхняя кромка окна или Dock.
final class Surface {
    let id: Int
    var frame: CGRect          // глобальные координаты (верх-лево)
    var heights: [CGFloat]     // высота снега в каждой колонке
    var visible: [Bool]        // колонка не закрыта окном спереди
    var profile: [CGFloat] = []   // 0…1: форма холмиков — сколько снега может лечь в колонку
    var lumps: [CGFloat] = []     // 0…1: размер комка на верхушке колонки
    var cornerR: CGFloat = 0       // радиус скругления верхних углов
    var velocity = CGVector.zero   // сглаженная скорость окна
    var lastChange: Double = 0     // когда позиция менялась в последний раз
    let isDock: Bool

    init(id: Int, frame: CGRect, isDock: Bool = false) {
        self.id = id
        self.frame = frame
        self.isDock = isDock
        self.cornerR = isDock ? dockCornerRadius : windowCornerRadius
        let n = Surface.columns(for: frame.width)
        heights = [CGFloat](repeating: 0, count: n)
        visible = [Bool](repeating: true, count: n)
        makeShape(n)
    }

    /// Случайный, но плавный рельеф: крупные холмы + мелкая рябь + шум.
    func makeShape(_ n: Int) {
        let a1 = 2 * CGFloat.pi / CGFloat.random(in: 22...40)   // холмы ~70–120 точек
        let a2 = 2 * CGFloat.pi / CGFloat.random(in: 7...12)    // бугорки ~20–35 точек
        let p1 = CGFloat.random(in: 0...(2 * .pi)), p2 = CGFloat.random(in: 0...(2 * .pi))
        profile = (0..<n).map { i in
            let x = CGFloat(i)
            let v = 0.55 + 0.3 * sin(x * a1 + p1) + 0.15 * sin(x * a2 + p2) + CGFloat.random(in: -0.06...0.06)
            return max(0.15, min(1, v))
        }
        lumps = (0..<n).map { _ in CGFloat.random(in: 0...1) }
    }

    static func columns(for width: CGFloat) -> Int { max(1, Int(width / colW)) }

    var top: CGFloat { frame.minY }
    var maxHeight: CGFloat { isDock ? 20 : 26 }

    func colX(_ i: Int) -> CGFloat { frame.minX + (CGFloat(i) + 0.5) * colW }

    /// На сколько опущена кромка в колонке из-за скругления угла.
    func base(_ i: Int) -> CGFloat {
        let r = min(cornerR, frame.width / 2)
        let x = colX(i)
        let dx = min(x - frame.minX, frame.maxX - x)
        if dx >= r || r <= 0 { return 0 }
        let k = r - max(0, dx)
        return r - (max(0, r * r - k * k)).squareRoot()
    }

    func column(at x: CGFloat) -> Int? {
        let v = (x - frame.minX) / colW
        guard v >= 0 else { return nil }
        let i = Int(v)
        return i < heights.count ? i : nil
    }

    /// Предельная высота колонки: к краям сугроб скругляется.
    func cap(_ i: Int) -> CGFloat {
        // Расстояние от ближайшего края окна; в зоне скругления угла снега нет.
        let x = colX(i)
        let dx = min(x - frame.minX, frame.maxX - x)
        let start = cornerR * 0.7 + 2
        if dx <= start { return 0 }
        let edge = 1 + (dx - start) * 0.9
        let shape = i < profile.count ? profile[i] : 1
        return min(edge, maxHeight * (0.35 + 0.65 * shape))
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
    var snowBehindWindows = false     // false — снег падает поверх окон

    private(set) var flakes: [Flake] = []

    // Состояние режима «Сюрприз» (Surprise.swift)
    var word: [WordFlake] = []
    var wordPoints: [CGPoint] = []
    var puffs: [Puff] = []
    var surpriseStart: Double = -1
    var impactTime: Double = -1
    var rocketFrom = CGPoint.zero
    var rocketTo = CGPoint.zero
    var dockSurface: Surface? { dock }
    private var surfaces: [Int: Surface] = [:]
    private var windowOrder: [Surface] = []
    private(set) var order: [Surface] = []     // спереди назад, Dock первым
    private var dock: Surface?
    private var stash: [Int: (Surface, Double)] = [:]   // спрятанные окна (Mission Control, другой стол)
    private var transitionUntil: Double = -1
    private var dockBaseline = Set<Int>()
    private var screenRects: [CGRect] = []
    /// Идёт системная анимация (Mission Control, смена стола, «Показать рабочий стол»).
    var frozen: Bool { t < transitionUntil }

    private(set) var t: Double = 0
    private var dockAcc: Double = 10
    private var frameDt: CGFloat = 1.0 / 60
    /// Насколько вперёд «предсказывать» положение движущегося окна (компенсация задержки).
    private let leadTime: CGFloat = 1.0 / 120
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
        screenRects = NSScreen.screens.map(Geo.globalRect)
        bounds = screenRects.reduce(CGRect.null) { $0.union($1) }
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
        frameDt = dt
        // Окна опрашиваем каждый кадр, чтобы сугроб не отставал от окна.
        pollWindows()

        updateMouse(dt)
        spawn(dt)
        moveFlakes(dt)
        relax()
        brush()
        updateSurprise(dt)
    }

    // MARK: - Окна

    private func pollWindows() {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements],
                                                    kCGNullWindowID) as? [[String: Any]] else { return }
        var found: [(Int, CGRect)] = []
        var seen = Set<Int>()
        var dockBig = Set<Int>()

        for info in list {
            guard let layer = (info[kCGWindowLayer as String] as? NSNumber)?.intValue,
                  let pid = (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value,
                  let id = (info[kCGWindowNumber as String] as? NSNumber)?.intValue,
                  let bd = info[kCGWindowBounds as String] as? NSDictionary,
                  let rect = CGRect(dictionaryRepresentation: bd as CFDictionary)
            else { continue }
            // Полноэкранное окно Dock над остальными — признак Mission Control.
            if layer > 0, (info[kCGWindowOwnerName as String] as? String) == "Dock", isScreenSized(rect) {
                dockBig.insert(id)
            }
            guard layer == 0, pid != ownPID else { continue }
            let alpha = (info[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1
            if alpha < 0.1 || rect.width < 120 || rect.height < 60 || seen.contains(id) { continue }
            seen.insert(id)
            found.append((id, rect))
        }

        // Первые 2 секунды запоминаем «обычные» окна Dock, чтобы не путать их с Mission Control.
        var missionControl = false
        if t < 2 { dockBaseline.formUnion(dockBig) } else { missionControl = !dockBig.subtracting(dockBaseline).isEmpty }

        // Если разом сдвинулись или пропали несколько окон — это системная анимация, а не пользователь.
        var changed = 0
        for (id, rect) in found {
            guard let e = surfaces[id] else { continue }
            let dPos: CGFloat = abs(e.frame.minX - rect.minX) + abs(e.frame.minY - rect.minY)
            let dSize: CGFloat = abs(e.frame.width - rect.width) + abs(e.frame.height - rect.height)
            if dPos + dSize > 2 { changed += 1 }
        }
        let vanished = surfaces.keys.filter { !seen.contains($0) }.count
        let total = max(1, max(surfaces.count, found.count))
        if missionControl || (changed + vanished >= 2 && (changed + vanished) * 2 >= total) {
            transitionUntil = t + 0.4
        }
        let freeze = frozen

        var newOrder: [Surface] = []
        for (id, rect) in found {
            let s: Surface
            if let existing = surfaces[id] {
                s = existing
                if freeze { quietMove(s, to: rect) } else { update(s, to: rect) }
            } else if let entry = stash.removeValue(forKey: id) {
                // Окно вернулось (после Mission Control / с другого стола) — со своим снегом.
                s = entry.0
                quietMove(s, to: rect)
                surfaces[id] = s
            } else {
                s = Surface(id: id, frame: rect)
                s.lastChange = t
                surfaces[id] = s
            }
            newOrder.append(s)
        }

        for (id, s) in surfaces where !seen.contains(id) {
            if freeze {
                stash[id] = (s, t)          // спрятать до возвращения окна
            } else {
                // Окно закрыли или свернули — снег с него падает вниз.
                shed(s, fraction: 1, frame: s.frame, velocity: .zero, spread: 40, ignore: false)
            }
            surfaces[id] = nil
        }
        stash = stash.filter { t - $0.value.1 < 900 }

        windowOrder = newOrder
        rebuildOrder()
    }

    private func isScreenSized(_ r: CGRect) -> Bool {
        screenRects.contains { r.width >= $0.width * 0.9 && r.height >= $0.height * 0.9 }
    }

    /// Переместить сугроб вместе с окном без всякой физики (во время системных анимаций).
    private func quietMove(_ s: Surface, to rect: CGRect) {
        if abs(rect.width - s.frame.width) > 0.5 {
            remap(s, to: rect, edgeVelocity: .zero, dropOutside: true)
        } else {
            s.frame = rect
        }
        s.velocity = .zero
        s.lastChange = t
    }

    private func update(_ s: Surface, to rect: CGRect) {
        let old = s.frame
        let sizeChanged = abs(rect.width - old.width) > 0.5 || abs(rect.height - old.height) > 0.5

        if sizeChanged {
            // Изменение размера: всё, что вышло за новые края, осыпается, остальное трясётся.
            let topMoved = abs(rect.minY - old.minY) > 0.5
            let widthChanged = abs(rect.width - old.width) > 0.5
            remap(s, to: rect, edgeVelocity: .zero)
            if widthChanged || topMoved {
                shed(s, fraction: 0.2, frame: s.frame, velocity: CGVector(dx: 0, dy: -40), spread: 70, ignore: true)
            }
            s.velocity = .zero
            s.lastChange = t
            return
        }

        if rect.origin != old.origin {
            // Окно сдвинулось: сугроб просто едет вместе с ним (heights хранятся относительно окна).
            let dtc = CGFloat(max(t - s.lastChange, 1.0 / 240))
            let v = CGVector(dx: (rect.minX - old.minX) / dtc, dy: (rect.minY - old.minY) / dtc)
            s.velocity = CGVector(dx: s.velocity.dx * 0.5 + v.dx * 0.5, dy: s.velocity.dy * 0.5 + v.dy * 0.5)
            s.frame = rect
            s.lastChange = t
            // Очень быстрое движение — снег понемногу сдувает встречным ветром.
            if hypot(s.velocity.dx, s.velocity.dy) > 2600 {
                shed(s, fraction: min(0.5, 1.2 * frameDt), frame: rect,
                     velocity: CGVector(dx: s.velocity.dx * 0.8, dy: s.velocity.dy * 0.8), spread: 90, ignore: true)
            }
        } else if t - s.lastChange > 0.07, s.velocity != .zero {
            // Окно остановилось. Если до этого оно летело быстро — это «бросок»:
            // снег по инерции срывается и летит дальше.
            let speed = hypot(s.velocity.dx, s.velocity.dy)
            if speed > 1400 {
                let frac = min(1, 0.4 + (speed - 1400) / 2500)
                shed(s, fraction: frac, frame: rect,
                     velocity: CGVector(dx: s.velocity.dx * 0.55, dy: s.velocity.dy * 0.55 - 120), spread: 120, ignore: true)
            }
            s.velocity = .zero
        }
    }

    private func remap(_ s: Surface, to rect: CGRect, edgeVelocity v: CGVector, dropOutside: Bool = false) {
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
            } else if !dropOutside {
                emit(x: x, top: old.minY, amount: oldH[j],
                     velocity: CGVector(dx: v.dx * 0.6, dy: 0), spread: 50, ignoreID: s.id)
            }
        }
        s.frame = rect
        s.heights = nh
        s.visible = [Bool](repeating: true, count: n)
        if s.profile.count != n { s.makeShape(n) }
    }

    // MARK: - Dock

    private func pollDock() {
        var rect: CGRect? = nil
        if dockEnabled, let r = DockInfo.bestFrame(), r.minY < bounds.maxY - 2, r.intersects(bounds) {
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
            let moved = abs(d.frame.minX - r.minX) + abs(d.frame.minY - r.minY) + abs(d.frame.width - r.width)
            if moved > 1.5 { remap(d, to: r, edgeVelocity: .zero) }
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
                    if frozen && !s.isDock { continue }
                    guard let c = s.column(at: f.x) else { continue }
                    let sy = s.top + s.base(c) - s.heights[c]
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
        s.heights[c] = min(s.cap(c), s.heights[c] + amt * 0.7)
        if c > 0 { s.heights[c - 1] = min(s.cap(c - 1), s.heights[c - 1] + amt * 0.15) }
        if c < n - 1 { s.heights[c + 1] = min(s.cap(c + 1), s.heights[c + 1] + amt * 0.15) }
    }

    /// Осыпание: слишком крутые склоны сугроба сглаживаются.
    private func relax() {
        for s in order {
            let n = s.heights.count
            if n < 2 { continue }
            for i in 0..<(n - 1) {
                let d = s.heights[i] - s.heights[i + 1]
                if abs(d) > 2.6 {
                    let m = (abs(d) - 2.6) * 0.2
                    if d > 0 { s.heights[i] -= m; s.heights[i + 1] += m }
                    else { s.heights[i] += m; s.heights[i + 1] -= m }
                }
            }
            for i in 0..<n where s.heights[i] > s.cap(i) { s.heights[i] = s.cap(i) }
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
        guard hasMouse, !frozen, hypot(mouseV.dx, mouseV.dy) > 60 else { return }
        let R: CGFloat = 16
        for s in order {
            let below: CGFloat = s.isDock ? 14 : 8
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

    func shakeSurface(_ s: Surface, velocity: CGVector, spread: CGFloat) {
        shed(s, fraction: 0.9, frame: s.frame, velocity: velocity, spread: spread, ignore: true)
    }

    func addLoose(x: CGFloat, y: CGFloat, vx: CGFloat, vy: CGFloat, r: CGFloat) {
        flakes.append(Flake(x: x, y: y, vx: vx, vy: vy, r: r, phase: 0, loose: true, alpha: 1))
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
        ctx.setShadow(offset: .zero, blur: 2, color: CGColor(gray: 0, alpha: 0.28))
        ctx.setFillColor(CGColor(red: 0.97, green: 0.98, blue: 1, alpha: 1))
        // Прозрачный слой: тень ложится на сугроб целиком, а не под каждый комок отдельно.
        ctx.beginTransparencyLayer(auxiliaryInfo: nil)
        let path = CGMutablePath()
        let lumps = CGMutablePath()
        for s in order where s.frame.insetBy(dx: -4, dy: -40).intersects(region) {
            if frozen && !s.isDock { continue }
            addPile(s, to: path, lumps: lumps)
        }
        ctx.addPath(path)
        ctx.fillPath()
        ctx.addPath(lumps)
        ctx.fillPath()
        ctx.endTransparencyLayer()
        ctx.restoreGState()

        // Снежинки: тонкая тёмная подложка, чтобы их было видно на белых окнах.
        let area = region.insetBy(dx: -4, dy: -4)
        // Снег идёт «за» окнами программ: над окнами снежинки не рисуем.
        let windowRects = snowBehindWindows ? windowOrder.map(\.frame).filter { $0.intersects(area) } : []
        for f in flakes where area.contains(CGPoint(x: f.x, y: f.y)) {
            if windowRects.contains(where: { $0.contains(CGPoint(x: f.x, y: f.y)) }) { continue }
            let rr = f.r + 0.6
            ctx.setFillColor(CGColor(gray: 0, alpha: 0.12 * f.alpha))
            ctx.fillEllipse(in: CGRect(x: f.x - rr, y: f.y - rr, width: rr * 2, height: rr * 2))
            ctx.setFillColor(CGColor(gray: 1, alpha: f.alpha))
            ctx.fillEllipse(in: CGRect(x: f.x - f.r, y: f.y - f.r, width: f.r * 2, height: f.r * 2))
        }

        drawSurprise(in: ctx, region: region)
    }

    private func addPile(_ s: Surface, to path: CGMutablePath, lumps: CGMutablePath) {
        let n = s.heights.count
        // Пока окно движется, рисуем сугроб чуть «на опережение», чтобы скрыть задержку.
        var ox: CGFloat = 0, oy: CGFloat = 0
        if t - s.lastChange < 0.03 {
            ox = max(-12, min(12, s.velocity.dx * leadTime))
            oy = max(-12, min(12, s.velocity.dy * leadTime))
        }
        let top = s.top + oy
        var i = 0
        while i < n {
            if !s.visible[i] || s.heights[i] < 0.3 { i += 1; continue }
            // Собираем непрерывный участок и рисуем его плавной кривой.
            // Все точки держим строго внутри окна (и не залезаем на окна спереди).
            let minX = s.frame.minX + 1.5 + ox, maxX = s.frame.maxX - 1.5 + ox
            var pts: [CGPoint] = []
            var bases: [CGPoint] = []
            let segStart = i
            while i < n && s.visible[i] && s.heights[i] >= 0.3 { i += 1 }
            let segEnd = i - 1
            for k in segStart...segEnd {
                let h = s.heights[k]
                let b = top + s.base(k)
                let x = min(maxX, max(minX, s.colX(k) + ox))
                pts.append(CGPoint(x: x, y: b - h))
                bases.append(CGPoint(x: x, y: b + 0.5))
                // Комки: только если рядом нет края участка, чтобы не вылезали за границы.
                if k % 2 == 0, h > 3, s.lumps[k] > 0.3, k - segStart >= 2, segEnd - k >= 2 {
                    let r = min(h * 0.35, 1.3 + s.lumps[k] * 2.8)
                    let cx = s.colX(k) + ox + (s.lumps[k] - 0.5) * 2
                    let cy = b - h + r * 0.55
                    if cx - r >= minX && cx + r <= maxX {
                        lumps.addEllipse(in: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2))
                    }
                }
            }
            path.move(to: bases[0])
            path.addLine(to: pts[0])
            if pts.count > 1 {
                for j in 1..<pts.count {
                    let mid = CGPoint(x: (pts[j - 1].x + pts[j].x) / 2, y: (pts[j - 1].y + pts[j].y) / 2)
                    path.addQuadCurve(to: mid, control: pts[j - 1])
                }
            }
            path.addLine(to: pts[pts.count - 1])
            // Низ сугроба повторяет кромку окна, включая скруглённые углы.
            for b in bases.reversed() { path.addLine(to: b) }
            path.closeSubpath()
        }
    }
}
