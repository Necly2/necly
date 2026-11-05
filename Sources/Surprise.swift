import Cocoa
import CoreText

/// Режим «Сюрприз»: ракета → взрыв у Dock → снег собирается в слово.
struct WordFlake {
    var x, y, vx, vy, tx, ty, r, delay: CGFloat
}

struct Puff {
    var x, y, r, life, maxLife: CGFloat
}

enum TextSampler {
    /// Точки внутри букв текста (относительно центра надписи), примерно `target` штук.
    static func points(_ text: String, fontSize: CGFloat, target: Int) -> [CGPoint] {
        let font = NSFont.systemFont(ofSize: fontSize, weight: .black)
        let attrs: [NSAttributedString.Key: Any] = [
            .font: font,
            NSAttributedString.Key(kCTForegroundColorFromContextAttributeName as String): true,
        ]
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attrs))
        var ascent: CGFloat = 0, descent: CGFloat = 0, leading: CGFloat = 0
        let w = CGFloat(CTLineGetTypographicBounds(line, &ascent, &descent, &leading))
        let pad: CGFloat = 10
        let W = Int((w + pad * 2).rounded(.up))
        let H = Int((ascent + descent + pad * 2).rounded(.up))
        guard W > 0, H > 0,
              let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceGray(),
                                  bitmapInfo: CGImageAlphaInfo.none.rawValue)
        else { return [] }
        ctx.setFillColor(gray: 1, alpha: 1)
        ctx.textPosition = CGPoint(x: pad, y: pad + descent)
        CTLineDraw(line, ctx)

        guard let data = ctx.data else { return [] }
        let bpr = ctx.bytesPerRow
        let buf = data.bindMemory(to: UInt8.self, capacity: bpr * H)
        var on = 0
        for r in 0..<H { for c in 0..<W where buf[r * bpr + c] > 128 { on += 1 } }
        if on == 0 { return [] }
        let step = max(3, Int((Double(on) / Double(target)).squareRoot().rounded()))

        var pts: [CGPoint] = []
        var r = 0
        while r < H {          // строка 0 в памяти — верх картинки
            var c = 0
            while c < W {
                if buf[r * bpr + c] > 128 {
                    pts.append(CGPoint(x: CGFloat(c) - CGFloat(W) / 2 + CGFloat.random(in: -0.8...0.8),
                                       y: CGFloat(r) - CGFloat(H) / 2 + CGFloat.random(in: -0.8...0.8)))
                }
                c += step
            }
            r += step
        }
        return pts
    }
}

extension SnowEngine {
    static let surpriseText = "СЕРГЕЙ"
    static let rocketDuration: Double = 1.3
    static let wordHold: CGFloat = 5.8     // сколько секунд после взрыва держится надпись

    func launchSurprise() {
        guard let main = NSScreen.screens.first else { return }
        let sr = Geo.globalRect(of: main)
        let impact: CGPoint
        if let d = dockSurface {
            impact = CGPoint(x: d.frame.midX, y: d.top)
        } else {
            impact = CGPoint(x: sr.midX, y: Geo.primaryHeight - main.visibleFrame.minY)
        }
        rocketFrom = CGPoint(x: sr.midX, y: sr.minY - 90)
        rocketTo = impact
        surpriseStart = t
        impactTime = -1
        word.removeAll()
        let fs = min(sr.width * 0.14, 230)
        wordPoints = TextSampler.points(SnowEngine.surpriseText, fontSize: fs, target: 2200).map {
            CGPoint(x: sr.midX + $0.x, y: sr.minY + sr.height * 0.38 + $0.y)
        }
    }

    func rocketPos() -> CGPoint {
        let p = CGFloat(min(1, (t - surpriseStart) / SnowEngine.rocketDuration))
        let e = p * p   // ускоряется при падении
        return CGPoint(x: rocketFrom.x + (rocketTo.x - rocketFrom.x) * e,
                       y: rocketFrom.y + (rocketTo.y - rocketFrom.y) * e)
    }

    func updateSurprise(_ dt: CGFloat) {
        for i in puffs.indices {
            puffs[i].life -= dt
            puffs[i].r += 16 * dt
            puffs[i].y -= 12 * dt
        }
        puffs.removeAll { $0.life <= 0 }

        guard surpriseStart >= 0 else { return }
        if impactTime < 0 {
            if t - surpriseStart < SnowEngine.rocketDuration {
                let p = rocketPos()
                puffs.append(Puff(x: p.x + CGFloat.random(in: -5...5), y: p.y - 80,
                                  r: CGFloat.random(in: 4...8), life: 0.9, maxLife: 0.9))
            } else {
                explode()
            }
            return
        }

        let it = CGFloat(t - impactTime)
        for i in word.indices {
            var w = word[i]
            let local = it - w.delay
            if local < 0.55 {
                // Разлёт от взрыва
                w.vy += 500 * dt
                w.vx *= (1 - 1.2 * dt)
                w.vy *= (1 - 1.2 * dt)
                w.x += w.vx * dt
                w.y += w.vy * dt
            } else {
                // Слетаемся в буквы
                let k = min(9, 2 + (local - 0.55) * 6)
                w.x += (w.tx - w.x) * min(1, k * dt)
                w.y += (w.ty - w.y) * min(1, k * dt)
            }
            word[i] = w
        }
        if it > SnowEngine.wordHold { releaseWord() }
    }

    private func explode() {
        impactTime = t
        let c = rocketTo
        if let d = dockSurface {
            shakeSurface(d, velocity: CGVector(dx: 0, dy: -500), spread: 300)
        }
        word = wordPoints.map { p in
            let ang = CGFloat.random(in: (CGFloat.pi * 1.05)...(CGFloat.pi * 1.95))   // вверх (ось Y вниз)
            let sp = CGFloat.random(in: 400...1100)
            return WordFlake(x: c.x, y: c.y - 4, vx: cos(ang) * sp, vy: sin(ang) * sp,
                             tx: p.x, ty: p.y, r: CGFloat.random(in: 1.8...3.0),
                             delay: CGFloat.random(in: 0...0.35))
        }
        // Дополнительный снег, который просто разлетается и падает.
        for _ in 0..<350 {
            let ang = CGFloat.random(in: (CGFloat.pi * 1.0)...(CGFloat.pi * 2.0))
            let sp = CGFloat.random(in: 200...900)
            addLoose(x: c.x, y: c.y - 4, vx: cos(ang) * sp, vy: sin(ang) * sp, r: CGFloat.random(in: 1.2...2.6))
        }
    }

    private func releaseWord() {
        for w in word {
            addLoose(x: w.x, y: w.y, vx: CGFloat.random(in: -25...25), vy: CGFloat.random(in: 0...40), r: w.r * 0.8)
        }
        word.removeAll()
        surpriseStart = -1
        impactTime = -1
    }

    // MARK: Отрисовка

    func drawSurprise(in ctx: CGContext, region: CGRect) {
        for p in puffs where region.insetBy(dx: -20, dy: -20).contains(CGPoint(x: p.x, y: p.y)) {
            ctx.setFillColor(CGColor(gray: 0.85, alpha: 0.5 * p.life / p.maxLife))
            ctx.fillEllipse(in: CGRect(x: p.x - p.r, y: p.y - p.r, width: p.r * 2, height: p.r * 2))
        }

        if surpriseStart >= 0 && impactTime < 0 {
            let p = rocketPos()
            if region.insetBy(dx: -40, dy: -120).contains(p) { drawRocket(ctx, tip: p) }
        }

        if impactTime >= 0 {
            let k = CGFloat(t - impactTime)
            if k < 0.4 {
                let rr = 30 + k * 520
                ctx.setFillColor(CGColor(red: 1, green: 0.95, blue: 0.75, alpha: 0.8 * (1 - k / 0.4)))
                ctx.fillEllipse(in: CGRect(x: rocketTo.x - rr, y: rocketTo.y - rr, width: rr * 2, height: rr * 2))
            }
        }

        let time = CGFloat(t)
        for (i, w) in word.enumerated() {
            let x = w.x + sin(time * 3 + CGFloat(i)) * 0.6
            let y = w.y + cos(time * 2.6 + CGFloat(i) * 1.7) * 0.6
            guard region.contains(CGPoint(x: x, y: y)) else { continue }
            let rr = w.r + 0.7
            ctx.setFillColor(CGColor(gray: 0, alpha: 0.18))
            ctx.fillEllipse(in: CGRect(x: x - rr, y: y - rr, width: rr * 2, height: rr * 2))
            ctx.setFillColor(CGColor(gray: 1, alpha: 1))
            ctx.fillEllipse(in: CGRect(x: x - w.r, y: y - w.r, width: w.r * 2, height: w.r * 2))
        }
    }

    /// Ракета носом вниз. tip — кончик носа; корпус и пламя выше него.
    private func drawRocket(_ ctx: CGContext, tip: CGPoint) {
        let x = tip.x, y = tip.y

        // Пламя (сзади, т.е. сверху)
        let fl = 20 + CGFloat.random(in: 0...14)
        ctx.setFillColor(CGColor(red: 1, green: 0.45, blue: 0.1, alpha: 0.9))
        let outer = CGMutablePath()
        outer.move(to: CGPoint(x: x - 9, y: y - 62))
        outer.addLine(to: CGPoint(x: x + 9, y: y - 62))
        outer.addLine(to: CGPoint(x: x, y: y - 62 - fl))
        outer.closeSubpath()
        ctx.addPath(outer); ctx.fillPath()
        ctx.setFillColor(CGColor(red: 1, green: 0.9, blue: 0.3, alpha: 1))
        let inner = CGMutablePath()
        inner.move(to: CGPoint(x: x - 5, y: y - 62))
        inner.addLine(to: CGPoint(x: x + 5, y: y - 62))
        inner.addLine(to: CGPoint(x: x, y: y - 62 - fl * 0.55))
        inner.closeSubpath()
        ctx.addPath(inner); ctx.fillPath()

        // Стабилизаторы
        ctx.setFillColor(CGColor(red: 0.85, green: 0.12, blue: 0.15, alpha: 1))
        let fins = CGMutablePath()
        fins.move(to: CGPoint(x: x - 11, y: y - 38)); fins.addLine(to: CGPoint(x: x - 21, y: y - 64))
        fins.addLine(to: CGPoint(x: x - 11, y: y - 58)); fins.closeSubpath()
        fins.move(to: CGPoint(x: x + 11, y: y - 38)); fins.addLine(to: CGPoint(x: x + 21, y: y - 64))
        fins.addLine(to: CGPoint(x: x + 11, y: y - 58)); fins.closeSubpath()
        ctx.addPath(fins); ctx.fillPath()

        // Корпус
        let body = CGPath(roundedRect: CGRect(x: x - 11, y: y - 62, width: 22, height: 50),
                          cornerWidth: 6, cornerHeight: 6, transform: nil)
        ctx.setFillColor(CGColor(gray: 0.95, alpha: 1))
        ctx.addPath(body); ctx.fillPath()
        ctx.setStrokeColor(CGColor(gray: 0.3, alpha: 1))
        ctx.setLineWidth(1)
        ctx.addPath(body); ctx.strokePath()

        // Иллюминатор
        ctx.setFillColor(CGColor(red: 0.3, green: 0.6, blue: 0.95, alpha: 1))
        ctx.fillEllipse(in: CGRect(x: x - 5, y: y - 43, width: 10, height: 10))
        ctx.strokeEllipse(in: CGRect(x: x - 5, y: y - 43, width: 10, height: 10))

        // Нос
        ctx.setFillColor(CGColor(red: 0.85, green: 0.12, blue: 0.15, alpha: 1))
        let nose = CGMutablePath()
        nose.move(to: CGPoint(x: x - 11, y: y - 14))
        nose.addLine(to: CGPoint(x: x + 11, y: y - 14))
        nose.addLine(to: CGPoint(x: x, y: y))
        nose.closeSubpath()
        ctx.addPath(nose); ctx.fillPath()
    }
}
