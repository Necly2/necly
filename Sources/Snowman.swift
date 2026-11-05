import Cocoa

/// Снеговик на Dock. Положение — смещение от центра Dock (Dock растёт в обе стороны одинаково).
struct Snowman {
    var xFromCenter: CGFloat
    var created: Date
    var build: CGFloat = 0     // 0…1 — анимация лепки
    var melt: CGFloat = 0      // 0…1 — таяние
}

extension SnowEngine {
    static let snowmanLifetimes = ["До весны (до 1 марта)", "Тает в оттепель (по погоде)", "1 час", "До выхода из приложения"]
    static let snowmanStyles = ["Цилиндр и шарф", "Ведро и шарф", "Шапка с помпоном", "Без шапки"]
    static let snowmanCounts = [1, 3, 5]

    /// Курсор сдвигает снег с Dock вперёд по ходу движения — в конце получается куча.
    func sweepIntoHeap(_ s: Surface, _ i0: Int, _ i1: Int) {
        guard i0 <= i1 else { return }
        let dir = mouseV.dx >= 0 ? 1 : -1
        let ahead = Int((16 + 8) / colW)
        let n = s.heights.count
        let target = max(0, min(n - 1, (dir > 0 ? i1 : i0) + dir * ahead))
        var moved: CGFloat = 0
        for i in i0...i1 where s.visible[i] {
            if s.heights[i] > 0.4 && mouse.y >= s.top - s.heights[i] - 12 { moved += s.heights[i]; s.heights[i] = 0 }
            if s.heap[i] > 0.2 && i != target { moved += s.heap[i]; s.heap[i] = 0 }
        }
        guard moved > 0 else { return }
        let limit = s.maxHeight * 3.2
        s.heap[target] = min(limit, s.heap[target] + moved * 0.85)
        // немного снега летит из-под курсора — для живости
        emit(x: s.colX(target), top: s.top - s.total(target), amount: min(moved * 0.15, 6),
             velocity: CGVector(dx: mouseV.dx * 0.3, dy: -CGFloat.random(in: 60...140)), spread: 40, ignoreID: s.id)
    }

    func updateSnowmen(_ dt: CGFloat) {
        // Куча на Dock оплывает в стороны, но остаётся горкой
        if let d = dockSurface {
            let n = d.heap.count
            if n > 1 {
                for i in 0..<(n - 1) {
                    let diff = d.heap[i] - d.heap[i + 1]
                    if abs(diff) > 4 {
                        let m = (abs(diff) - 4) * 0.12
                        if diff > 0 { d.heap[i] -= m; d.heap[i + 1] += m } else { d.heap[i] += m; d.heap[i + 1] -= m }
                    }
                }
            }
            // Куча выросла — лепим снеговика
            // Нужна и высокая горка, и много сгребённого снега рядом с ней
            if snowmanEnabled, let idx = d.heap.indices.max(by: { d.heap[$0] < d.heap[$1] }),
               d.heap[idx] >= d.maxHeight * 1.25,
               d.heap.indices.filter({ abs($0 - idx) * Int(colW) <= 60 }).reduce(CGFloat(0), { $0 + d.heap[$1] }) >= 250 {
                let x = d.colX(idx)
                let fromCenter = x - d.frame.midX
                let free = !snowmen.contains { abs($0.xFromCenter - fromCenter) < 45 }
                if snowmen.count < maxSnowmen && free {
                    snowmen.append(Snowman(xFromCenter: fromCenter, created: Date()))
                    for i in 0..<n where abs(d.colX(i) - x) < 32 { d.heap[i] = 0 }
                    onSnowmenChanged?()
                }
            }
        }

        // Жизнь снеговиков
        let now = Date()
        let month = Calendar.current.component(.month, from: now)
        let spring = (3...10).contains(month)
        for k in snowmen.indices {
            snowmen[k].build = min(1, snowmen[k].build + dt / 1.2)
            var melting = false
            switch snowmanLifetime {
            case 0: melting = spring
            case 1: melting = (weather?.tempC ?? -10) > 2 || weatherMode == 2
            case 2: melting = now.timeIntervalSince(snowmen[k].created) > 3600
            default: melting = false
            }
            if melting {
                let speed: CGFloat = snowmanLifetime == 1 ? 1.0 / 600 : 1.0 / 4   // оттепель — 10 минут
                snowmen[k].melt = min(1, snowmen[k].melt + dt * speed)
            }
        }
        let before = snowmen.count
        snowmen.removeAll { $0.melt >= 1 }
        if snowmen.count != before { onSnowmenChanged?() }
    }

    func buildSnowmanNow() {
        guard let d = dockSurface else { return }
        let half = d.frame.width / 2 - 30
        guard half > 0 else { return }
        for _ in 0..<20 {
            let x = CGFloat.random(in: -half...half)
            if !snowmen.contains(where: { abs($0.xFromCenter - x) < 45 }) {
                if snowmen.count >= maxSnowmen { snowmen.removeFirst() }
                snowmen.append(Snowman(xFromCenter: x, created: Date()))
                onSnowmenChanged?()
                return
            }
        }
    }

    func removeAllSnowmen() {
        snowmen.removeAll()
        onSnowmenChanged?()
    }

    // MARK: Отрисовка

    func drawSnowmen(in ctx: CGContext, region: CGRect) {
        guard let d = dockSurface, !snowmen.isEmpty, d.frame.insetBy(dx: -10, dy: -80).intersects(region) else { return }
        for sm in snowmen {
            let x = d.frame.midX + sm.xFromCenter
            guard x > d.frame.minX + 10, x < d.frame.maxX - 10 else { continue }
            let grow = 1 - pow(1 - sm.build, 3)                     // плавная «лепка»
            drawSnowman(ctx, x: x, base: d.top + 1, scale: grow, squash: 1 - sm.melt * 0.75, fade: 1 - sm.melt * 0.4)
        }
    }

    private func drawSnowman(_ ctx: CGContext, x: CGFloat, base: CGFloat, scale: CGFloat, squash: CGFloat, fade: CGFloat) {
        guard scale > 0.02 else { return }
        ctx.saveGState()
        ctx.translateBy(x: x, y: base)
        ctx.scaleBy(x: scale * (1 + (1 - squash) * 0.4), y: scale * squash)
        ctx.setAlpha(fade)

        let r1: CGFloat = 12, r2: CGFloat = 8.5, r3: CGFloat = 6.5
        let c1 = CGPoint(x: 0, y: -r1 * 0.92)
        let c2 = CGPoint(x: 0, y: c1.y - r1 * 0.78 - r2 * 0.72)
        let c3 = CGPoint(x: 0, y: c2.y - r2 * 0.7 - r3 * 0.78)
        func ball(_ c: CGPoint, _ r: CGFloat) -> CGRect { CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2) }

        // Руки-веточки
        ctx.setStrokeColor(CGColor(red: 0.42, green: 0.27, blue: 0.13, alpha: 1))
        ctx.setLineWidth(1.4)
        ctx.setLineCap(.round)
        ctx.move(to: CGPoint(x: -r2 * 0.8, y: c2.y)); ctx.addLine(to: CGPoint(x: -r2 - 9, y: c2.y - 7))
        ctx.move(to: CGPoint(x: -r2 - 5, y: c2.y - 4)); ctx.addLine(to: CGPoint(x: -r2 - 7, y: c2.y - 9))
        ctx.move(to: CGPoint(x: r2 * 0.8, y: c2.y)); ctx.addLine(to: CGPoint(x: r2 + 9, y: c2.y - 6))
        ctx.move(to: CGPoint(x: r2 + 5, y: c2.y - 3)); ctx.addLine(to: CGPoint(x: r2 + 8, y: c2.y - 1))
        ctx.strokePath()

        // Три кома с лёгкой тенью
        ctx.saveGState()
        ctx.setShadow(offset: .zero, blur: 2, color: CGColor(gray: 0, alpha: 0.35))
        ctx.setFillColor(CGColor(red: 0.98, green: 0.99, blue: 1, alpha: 1))
        ctx.fillEllipse(in: ball(c1, r1))
        ctx.fillEllipse(in: ball(c2, r2))
        ctx.fillEllipse(in: ball(c3, r3))
        ctx.restoreGState()
        ctx.setStrokeColor(CGColor(red: 0.6, green: 0.7, blue: 0.8, alpha: 0.5))
        ctx.setLineWidth(0.6)
        ctx.strokeEllipse(in: ball(c1, r1)); ctx.strokeEllipse(in: ball(c2, r2)); ctx.strokeEllipse(in: ball(c3, r3))

        // Пуговицы, глаза, нос-морковка
        ctx.setFillColor(CGColor(gray: 0.12, alpha: 1))
        for dy in [-2.5, 2.5] as [CGFloat] { ctx.fillEllipse(in: CGRect(x: -0.9, y: c2.y + dy - 0.9, width: 1.8, height: 1.8)) }
        ctx.fillEllipse(in: CGRect(x: -0.9, y: c1.y - 4 - 0.9, width: 1.8, height: 1.8))
        ctx.fillEllipse(in: CGRect(x: -2.6, y: c3.y - 2, width: 1.5, height: 1.5))
        ctx.fillEllipse(in: CGRect(x: 1.1, y: c3.y - 2, width: 1.5, height: 1.5))
        ctx.setFillColor(CGColor(red: 1, green: 0.5, blue: 0.1, alpha: 1))
        ctx.move(to: CGPoint(x: 0, y: c3.y - 0.2))
        ctx.addLine(to: CGPoint(x: 7, y: c3.y + 1))
        ctx.addLine(to: CGPoint(x: 0, y: c3.y + 1.6))
        ctx.closePath()
        ctx.fillPath()

        // Шарф
        let neck = c2.y - r2 * 0.72
        ctx.setFillColor(CGColor(red: 0.85, green: 0.12, blue: 0.15, alpha: 1))
        ctx.fill(CGRect(x: -r2 * 0.75, y: neck - 1.6, width: r2 * 1.5, height: 3.2))
        ctx.fill(CGRect(x: r2 * 0.25, y: neck, width: 2.6, height: 7))

        // Головной убор
        let top = c3.y - r3 * 0.8
        switch snowmanStyle {
        case 0:   // цилиндр
            ctx.setFillColor(CGColor(gray: 0.1, alpha: 1))
            ctx.fill(CGRect(x: -6.5, y: top - 1, width: 13, height: 1.8))
            ctx.fill(CGRect(x: -4.2, y: top - 9, width: 8.4, height: 8.5))
            ctx.setFillColor(CGColor(red: 0.85, green: 0.12, blue: 0.15, alpha: 1))
            ctx.fill(CGRect(x: -4.2, y: top - 2.6, width: 8.4, height: 1.4))
        case 1:   // ведро
            ctx.setFillColor(CGColor(red: 0.55, green: 0.6, blue: 0.65, alpha: 1))
            ctx.move(to: CGPoint(x: -5.5, y: top + 0.5)); ctx.addLine(to: CGPoint(x: 5.5, y: top + 0.5))
            ctx.addLine(to: CGPoint(x: 4, y: top - 7)); ctx.addLine(to: CGPoint(x: -4, y: top - 7))
            ctx.closePath(); ctx.fillPath()
            ctx.setStrokeColor(CGColor(gray: 0.35, alpha: 1)); ctx.setLineWidth(0.6)
            ctx.move(to: CGPoint(x: -5, y: top - 1.5)); ctx.addLine(to: CGPoint(x: 5, y: top - 1.5)); ctx.strokePath()
        case 2:   // вязаная шапка с помпоном
            ctx.setFillColor(CGColor(red: 0.85, green: 0.12, blue: 0.15, alpha: 1))
            ctx.addArc(center: CGPoint(x: 0, y: top + 1), radius: 6, startAngle: .pi, endAngle: 0, clockwise: false)
            ctx.closePath(); ctx.fillPath()
            ctx.setFillColor(CGColor(gray: 1, alpha: 1))
            ctx.fill(CGRect(x: -6.3, y: top - 0.5, width: 12.6, height: 2))
            ctx.fillEllipse(in: CGRect(x: -2.2, y: top - 8.5, width: 4.4, height: 4.4))
        default: break
        }
        ctx.restoreGState()
    }
}
