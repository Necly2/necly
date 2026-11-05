import Cocoa

/// Настройки гирлянды.
struct GarlandSettings {
    var enabled = false
    var onDock = true
    var onMenuBar = true
    var onWindows = false
    var mode = 0          // 0 плавно, 1 бегущие огни, 2 случайное мигание, 3 постоянно
    var palette = 0
    var brightness: CGFloat = 0.9

    static let modes = ["Плавное мерцание", "Бегущие огни", "Случайное мигание", "Горит постоянно"]
    static let palettes: [(String, [CGColor])] = [
        ("Разноцветная", [CGColor(red: 1, green: 0.25, blue: 0.25, alpha: 1), CGColor(red: 1, green: 0.8, blue: 0.2, alpha: 1),
                          CGColor(red: 0.3, green: 0.9, blue: 0.35, alpha: 1), CGColor(red: 0.3, green: 0.6, blue: 1, alpha: 1),
                          CGColor(red: 0.85, green: 0.4, blue: 1, alpha: 1)]),
        ("Тёплая белая", [CGColor(red: 1, green: 0.85, blue: 0.55, alpha: 1), CGColor(red: 1, green: 0.78, blue: 0.45, alpha: 1)]),
        ("Холодная (бело-голубая)", [CGColor(red: 0.85, green: 0.93, blue: 1, alpha: 1), CGColor(red: 0.45, green: 0.75, blue: 1, alpha: 1)]),
        ("Красно-зелёная", [CGColor(red: 1, green: 0.2, blue: 0.2, alpha: 1), CGColor(red: 0.25, green: 0.85, blue: 0.3, alpha: 1)]),
    ]
}

extension SnowEngine {
    static let bulbSpacing: CGFloat = 22
    static let hookSpacing: CGFloat = 66

    func drawGarland(in ctx: CGContext, region: CGRect) {
        let g = garland
        guard g.enabled else { return }
        let colors = GarlandSettings.palettes[min(max(g.palette, 0), GarlandSettings.palettes.count - 1)].1
        var strand = 0

        if g.onMenuBar {
            for line in menuBarLines where line.intersects(region.insetBy(dx: 0, dy: -20)) {
                drawStrand(ctx, x0: line.minX + 6, x1: line.maxX - 6, y: line.maxY + 1, sag: 7,
                           colors: colors, seed: strand, visible: nil)
                strand += 1
            }
        }
        if g.onDock, let d = dockSurface, d.frame.insetBy(dx: -10, dy: -30).intersects(region) {
            let inset = d.cornerR * 0.6
            drawStrand(ctx, x0: d.frame.minX + inset, x1: d.frame.maxX - inset, y: d.top + 2, sag: 6,
                       colors: colors, seed: 7, visible: nil)
        }
        if g.onWindows && !frozen {
            for s in windowSurfaces where s.frame.insetBy(dx: -10, dy: -30).intersects(region) {
                let inset = s.cornerR + 4
                guard s.frame.width > inset * 2 + 40 else { continue }
                drawStrand(ctx, x0: s.frame.minX + inset, x1: s.frame.maxX - inset, y: s.top + 2, sag: 5,
                           colors: colors, seed: s.id % 97, visible: { x in
                    guard let c = s.column(at: x) else { return false }
                    return s.visible[c]
                })
            }
        }
    }

    /// Провод, провисающий между крючками, и лампочки на нём.
    private func drawStrand(_ ctx: CGContext, x0: CGFloat, x1: CGFloat, y: CGFloat, sag: CGFloat,
                            colors: [CGColor], seed: Int, visible: ((CGFloat) -> Bool)?) {
        guard x1 - x0 > 30 else { return }
        let span = (x1 - x0) / max(1, ((x1 - x0) / SnowEngine.hookSpacing).rounded())
        func wireY(_ x: CGFloat) -> CGFloat {
            let f = ((x - x0) / span).truncatingRemainder(dividingBy: 1)
            return y + sag * sin(.pi * f)
        }

        // Провод
        ctx.saveGState()
        ctx.setStrokeColor(CGColor(gray: 0.12, alpha: 0.85))
        ctx.setLineWidth(1.2)
        var x = x0
        var drawing = false
        while x <= x1 {
            let vis = visible?(x) ?? true
            let p = CGPoint(x: x, y: wireY(x))
            if vis {
                if drawing { ctx.addLine(to: p) } else { ctx.move(to: p); drawing = true }
            } else if drawing {
                ctx.strokePath()
                drawing = false
            }
            x += 3
        }
        if drawing { ctx.strokePath() }
        ctx.restoreGState()

        // Лампочки
        let time = CGFloat(t)
        let n = Int((x1 - x0) / SnowEngine.bulbSpacing)
        guard n > 0 else { return }
        let step = (x1 - x0) / CGFloat(n)
        for k in 0...n {
            let bx = x0 + CGFloat(k) * step
            if let v = visible, !v(bx) { continue }
            let by = wireY(bx)
            let idx = k + seed * 3
            let color = colors[idx % colors.count]
            let b = brightness(idx, time) * garland.brightness

            // Свечение
            if let comps = color.components, comps.count >= 3 {
                let space = CGColorSpaceCreateDeviceRGB()
                let glow = [CGColor(red: comps[0], green: comps[1], blue: comps[2], alpha: 0.55 * b),
                            CGColor(red: comps[0], green: comps[1], blue: comps[2], alpha: 0)] as CFArray
                if let grad = CGGradient(colorsSpace: space, colors: glow, locations: [0, 1]) {
                    let c = CGPoint(x: bx, y: by + 8)
                    ctx.drawRadialGradient(grad, startCenter: c, startRadius: 0, endCenter: c, endRadius: 13, options: [])
                }
            }
            // Цоколь
            ctx.setFillColor(CGColor(gray: 0.2, alpha: 1))
            ctx.fill(CGRect(x: bx - 1.6, y: by, width: 3.2, height: 3))
            // Колба: тусклая, когда «не горит»
            let dim: CGFloat = 0.35 + 0.65 * b
            if let comps = color.components, comps.count >= 3 {
                ctx.setFillColor(CGColor(red: comps[0] * dim, green: comps[1] * dim, blue: comps[2] * dim, alpha: 1))
            }
            ctx.fillEllipse(in: CGRect(x: bx - 2.8, y: by + 2.5, width: 5.6, height: 8.5))
            // Блик
            ctx.setFillColor(CGColor(gray: 1, alpha: 0.55 * b))
            ctx.fillEllipse(in: CGRect(x: bx - 1.4, y: by + 3.8, width: 1.6, height: 2.6))
        }
    }

    /// Яркость лампочки 0…1 в зависимости от режима.
    private func brightness(_ k: Int, _ time: CGFloat) -> CGFloat {
        switch garland.mode {
        case 0:
            return 0.55 + 0.45 * sin(time * 2.2 + CGFloat(k) * 0.9)
        case 1:
            let step = Int(time * 7)
            return ((step - k) % 4 + 4) % 4 == 0 ? 1 : 0.18
        case 2:
            let h = CGFloat((k &* 2654435761) & 0xFFFF) / 65535
            return sin(time * (1.3 + h * 2.7) + h * 40) > 0.25 ? 1 : 0.2
        default:
            return 1
        }
    }
}
