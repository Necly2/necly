import Cocoa

struct RainDrop { var x, y, vx, vy, len: CGFloat }
struct Splash { var x, y, vx, vy, life: CGFloat }
/// Кристаллик инея: смещение от левого края окна, длина, наклон.
struct FrostSpike { var off, len, angle: CGFloat; var branch: Bool }

extension SnowEngine {
    static let weatherModes = ["Снег всегда", "По погоде в городе", "Дождь (проверка)", "Иней (проверка)"]

    /// Снежинок в секунду на 100 точек ширины экранов.
    var snowRate: CGFloat {
        guard snowing else { return 0 }
        switch weatherMode {
        case 0: return intensity
        case 1:
            guard let w = weather else { return 0 }
            if w.kind == .snow { return [2, 4.5, 10][max(0, min(2, w.intensity))] }
            if w.kind == .sleet { return 2 }
            return 0
        default: return 0
        }
    }

    /// Капель в секунду на 100 точек ширины.
    var rainRate: CGFloat {
        guard snowing else { return 0 }
        switch weatherMode {
        case 1:
            guard let w = weather else { return 0 }
            if w.kind == .rain { return [5, 11, 24][max(0, min(2, w.intensity))] }
            if w.kind == .sleet { return 5 }
            return 0
        case 2: return 11
        default: return 0
        }
    }

    /// Иней: ясная морозная ночь (или режим проверки).
    var frostWanted: Bool {
        switch weatherMode {
        case 3: return true
        case 1:
            guard let w = weather else { return false }
            return w.kind == .clear && w.tempC <= -3 && w.isNight
        default: return false
        }
    }

    /// Скорость таяния сугробов, точек в секунду.
    var meltRate: CGFloat {
        switch weatherMode {
        case 1:
            guard let w = weather, w.tempC > 1 else { return 0 }
            return min(0.6, CGFloat(w.tempC - 1) * 0.03) + (w.kind == .rain ? 0.12 : 0)
        case 2: return 0.12
        default: return 0
        }
    }

    func updateWeatherEffects(_ dt: CGFloat) {
        // Иней нарастает за минуту, сходит за 20 секунд
        frostLevel = frostWanted ? min(1, frostLevel + dt / 60) : max(0, frostLevel - dt / 20)

        // Таяние
        let melt = meltRate * dt
        if melt > 0 {
            for s in order {
                for i in 0..<s.heights.count where s.heights[i] > 0 { s.heights[i] = max(0, s.heights[i] - melt) }
                for i in 0..<s.heap.count where s.heap[i] > 0 { s.heap[i] = max(0, s.heap[i] - melt * 0.5) }
            }
        }

        // Новые капли
        let rate = rainRate
        if rate > 0, !bounds.isNull {
            rainAcc += rate * bounds.width / 100 * dt
            while rainAcc >= 1 {
                rainAcc -= 1
                if drops.count >= 1500 { rainAcc = 0; break }
                let vy = CGFloat.random(in: 760...980)
                drops.append(RainDrop(x: CGFloat.random(in: (bounds.minX - 150)...(bounds.maxX + 50)),
                                      y: bounds.minY - 20, vx: wind * 4 + 70, vy: vy,
                                      len: CGFloat.random(in: 10...19)))
            }
        }

        // Полёт капель и брызги о кромки окон
        var i = 0
        while i < drops.count {
            var d = drops[i]
            let prevY = d.y
            d.x += d.vx * dt
            d.y += d.vy * dt
            var hit = false
            for s in order {
                if frozen && !s.isDock { continue }
                guard let c = s.column(at: d.x) else { continue }
                let sy = s.top + s.base(c) - s.total(c)
                if prevY <= sy, d.y >= sy, s.visible[c] {
                    hit = true
                    if splashes.count < 900 {
                        for _ in 0..<Int.random(in: 2...4) {
                            splashes.append(Splash(x: d.x, y: sy - 1, vx: CGFloat.random(in: -90...90),
                                                   vy: -CGFloat.random(in: 70...190), life: CGFloat.random(in: 0.22...0.38)))
                        }
                    }
                    if s.heights[c] > 0 { s.heights[c] = max(0, s.heights[c] - 0.15) }   // дождь подъедает снег
                    break
                }
            }
            if hit || d.y > bounds.maxY + 10 {
                drops.swapAt(i, drops.count - 1)
                drops.removeLast()
            } else {
                drops[i] = d
                i += 1
            }
        }
        var k = 0
        while k < splashes.count {
            splashes[k].vy += 900 * dt
            splashes[k].x += splashes[k].vx * dt
            splashes[k].y += splashes[k].vy * dt
            splashes[k].life -= dt
            if splashes[k].life <= 0 {
                splashes.swapAt(k, splashes.count - 1)
                splashes.removeLast()
            } else { k += 1 }
        }
    }

    // MARK: Отрисовка

    func drawRain(in ctx: CGContext, region: CGRect) {
        guard !drops.isEmpty || !splashes.isEmpty else { return }
        let area = region.insetBy(dx: -30, dy: -30)
        let windowRects = snowBehindWindows ? windowSurfaces.map(\.frame) : []
        let path = CGMutablePath()
        for d in drops where area.contains(CGPoint(x: d.x, y: d.y)) {
            if windowRects.contains(where: { $0.contains(CGPoint(x: d.x, y: d.y)) }) { continue }
            let k = d.len / d.vy
            path.move(to: CGPoint(x: d.x, y: d.y))
            path.addLine(to: CGPoint(x: d.x - d.vx * k, y: d.y - d.len))
        }
        ctx.saveGState()
        ctx.setLineCap(.round)
        // Тёмная подложка — чтобы капли было видно и на белых окнах
        ctx.addPath(path)
        ctx.setStrokeColor(CGColor(gray: 0, alpha: 0.12))
        ctx.setLineWidth(2.4)
        ctx.strokePath()
        ctx.addPath(path)
        ctx.setStrokeColor(CGColor(red: 0.78, green: 0.88, blue: 1, alpha: 0.6))
        ctx.setLineWidth(1.1)
        ctx.strokePath()
        ctx.setFillColor(CGColor(red: 0.8, green: 0.9, blue: 1, alpha: 0.75))
        for sp in splashes where area.contains(CGPoint(x: sp.x, y: sp.y)) {
            ctx.fillEllipse(in: CGRect(x: sp.x - 1, y: sp.y - 1, width: 2, height: 2))
        }
        ctx.restoreGState()
    }

    /// Кристаллики инея для окна (одни и те же для одного окна).
    func frostSpikes(for s: Surface) -> [FrostSpike] {
        if let c = frostCache[s.id] { return c }
        var seed = UInt64(truncatingIfNeeded: s.id &* 2654435761 &+ 12345)
        func rnd() -> CGFloat {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return CGFloat((seed >> 33) & 0xFFFFFF) / CGFloat(0xFFFFFF)
        }
        var spikes: [FrostSpike] = []
        var off: CGFloat = 0
        while off < 5000 {
            off += 3 + rnd() * 5
            spikes.append(FrostSpike(off: off, len: 2.5 + rnd() * rnd() * 9,
                                     angle: (rnd() - 0.5) * 1.3, branch: rnd() > 0.55))
        }
        frostCache[s.id] = spikes
        return spikes
    }

    func drawFrost(in ctx: CGContext, region: CGRect) {
        guard frostLevel > 0.01 else { return }
        let lv = frostLevel
        let path = CGMutablePath()
        let band = CGMutablePath()
        for s in order {
            if frozen && !s.isDock { continue }
            guard s.frame.insetBy(dx: -10, dy: -20).intersects(region) else { continue }
            let inset = s.cornerR + 2
            let x0 = s.frame.minX + inset, x1 = s.frame.maxX - inset
            guard x1 > x0 else { continue }
            band.move(to: CGPoint(x: x0, y: s.top + 0.8))
            band.addLine(to: CGPoint(x: x1, y: s.top + 0.8))
            for sp in frostSpikes(for: s) {
                let x = s.frame.minX + sp.off
                if x < x0 { continue }
                if x > x1 { break }
                guard let c = s.column(at: x), s.visible[c] else { continue }
                let y = s.top + s.base(c)
                let len = sp.len * lv
                // Кристаллы растут вверх от кромки окна
                let tip = CGPoint(x: x + sin(sp.angle) * len, y: y - cos(sp.angle) * len)
                path.move(to: CGPoint(x: x, y: y))
                path.addLine(to: tip)
                if sp.branch && len > 3 {
                    let mid = CGPoint(x: (x + tip.x) / 2, y: (y + tip.y) / 2)
                    path.move(to: mid)
                    path.addLine(to: CGPoint(x: mid.x + sin(sp.angle + 0.9) * len * 0.4, y: mid.y - cos(sp.angle + 0.9) * len * 0.4))
                    path.move(to: mid)
                    path.addLine(to: CGPoint(x: mid.x + sin(sp.angle - 0.9) * len * 0.4, y: mid.y - cos(sp.angle - 0.9) * len * 0.4))
                }
            }
        }
        ctx.saveGState()
        ctx.setLineCap(.round)
        ctx.addPath(band)
        ctx.setStrokeColor(CGColor(red: 0.86, green: 0.94, blue: 1, alpha: 0.55 * lv))
        ctx.setLineWidth(1.6)
        ctx.strokePath()
        ctx.addPath(path)
        ctx.setStrokeColor(CGColor(red: 0.2, green: 0.35, blue: 0.5, alpha: 0.18 * lv))
        ctx.setLineWidth(1.8)
        ctx.strokePath()
        ctx.addPath(path)
        ctx.setStrokeColor(CGColor(red: 0.88, green: 0.95, blue: 1, alpha: 0.85 * lv))
        ctx.setLineWidth(0.8)
        ctx.strokePath()
        ctx.restoreGState()
    }
}
