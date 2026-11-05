import Cocoa

/// Мост «замыкание → target/action» для элементов AppKit.
final class ActionTarget: NSObject {
    let fn: (Any?) -> Void
    init(_ fn: @escaping (Any?) -> Void) { self.fn = fn }
    @objc func fire(_ sender: Any?) { fn(sender) }
}

/// Документ, который растёт сверху вниз (для прокрутки).
final class FlippedView: NSView {
    override var isFlipped: Bool { true }
}

/// Окно настроек: колонки с разделами (подпись слева, элемент справа).
/// Окно можно растягивать; если всё не помещается — появляется прокрутка.
@MainActor
final class SettingsWindow: NSObject, NSWindowDelegate {
    let window: NSWindow
    private var grid: NSGridView
    private let columns = NSStackView()
    private let doc = FlippedView()
    private var targets: [ActionTarget] = []
    var onClose: (() -> Void)?

    private static func makeGrid() -> NSGridView {
        let g = NSGridView(numberOfColumns: 2, rows: 0)
        g.rowSpacing = 9
        g.columnSpacing = 12
        g.column(at: 0).xPlacement = .trailing
        g.rowAlignment = .firstBaseline
        return g
    }

    init(title: String) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 760, height: 480),
                          styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        grid = SettingsWindow.makeGrid()
        super.init()
        window.title = title
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentMinSize = NSSize(width: 420, height: 260)

        columns.orientation = .horizontal
        columns.alignment = .top
        columns.spacing = 32
        columns.translatesAutoresizingMaskIntoConstraints = false
        columns.addArrangedSubview(grid)

        doc.translatesAutoresizingMaskIntoConstraints = false
        doc.addSubview(columns)
        NSLayoutConstraint.activate([
            columns.topAnchor.constraint(equalTo: doc.topAnchor, constant: 18),
            columns.bottomAnchor.constraint(equalTo: doc.bottomAnchor, constant: -18),
            columns.leadingAnchor.constraint(equalTo: doc.leadingAnchor, constant: 22),
            columns.trailingAnchor.constraint(lessThanOrEqualTo: doc.trailingAnchor, constant: -22),
        ])

        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = true
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        scroll.documentView = doc
        let clip = scroll.contentView
        NSLayoutConstraint.activate([
            doc.topAnchor.constraint(equalTo: clip.topAnchor),
            doc.leadingAnchor.constraint(equalTo: clip.leadingAnchor),
            doc.widthAnchor.constraint(greaterThanOrEqualTo: clip.widthAnchor),
        ])
        window.contentView = scroll
    }

    /// Начать новую колонку справа.
    func column() {
        let sep = NSBox()
        sep.boxType = .separator
        sep.translatesAutoresizingMaskIntoConstraints = false
        columns.addArrangedSubview(sep)
        sep.heightAnchor.constraint(equalTo: columns.heightAnchor, constant: -8).isActive = true
        grid = SettingsWindow.makeGrid()
        columns.addArrangedSubview(grid)
    }

    func windowWillClose(_ notification: Notification) { onClose?() }

    private func target(_ fn: @escaping (Any?) -> Void) -> ActionTarget {
        let t = ActionTarget(fn)
        targets.append(t)
        return t
    }

    private func label(_ text: String, bold: Bool = false) -> NSTextField {
        let l = NSTextField(labelWithString: text)
        l.font = bold ? .boldSystemFont(ofSize: 13) : .systemFont(ofSize: 13)
        return l
    }

    private func add(_ title: String, _ view: NSView) {
        grid.addRow(with: [label(title), view])
    }

    // MARK: Элементы

    func section(_ title: String) {
        let row = grid.addRow(with: [label(title, bold: true), NSGridCell.emptyContentView])
        if grid.numberOfRows > 1 { row.topPadding = 12 }
        row.cell(at: 0).xPlacement = .leading
        row.mergeCells(in: NSRange(location: 0, length: 2))
    }

    func popup(_ title: String, _ items: [String], selected: Int, _ onChange: @escaping (Int) -> Void) {
        let p = NSPopUpButton(frame: .zero, pullsDown: false)
        p.addItems(withTitles: items)
        if selected >= 0 && selected < items.count { p.selectItem(at: selected) }
        let t = target { s in onChange((s as? NSPopUpButton)?.indexOfSelectedItem ?? 0) }
        p.target = t
        p.action = #selector(ActionTarget.fire(_:))
        add(title, p)
    }

    func checkbox(_ title: String, _ text: String, on: Bool, _ onChange: @escaping (Bool) -> Void) {
        let t = target { s in onChange((s as? NSButton)?.state == .on) }
        let b = NSButton(checkboxWithTitle: text, target: t, action: #selector(ActionTarget.fire(_:)))
        b.state = on ? .on : .off
        add(title, b)
    }

    /// Несколько флажков в одной строке.
    func checkboxes(_ title: String, _ items: [(String, Bool)], _ onChange: @escaping (Int, Bool) -> Void) {
        let stack = NSStackView()
        stack.orientation = .horizontal
        stack.spacing = 14
        for (i, it) in items.enumerated() {
            let t = target { s in onChange(i, (s as? NSButton)?.state == .on) }
            let b = NSButton(checkboxWithTitle: it.0, target: t, action: #selector(ActionTarget.fire(_:)))
            b.state = it.1 ? .on : .off
            stack.addArrangedSubview(b)
        }
        add(title, stack)
    }

    func textField(_ title: String, value: String, placeholder: String, button: String,
                   width: CGFloat = 260, _ onCommit: @escaping (String) -> Void) {
        let f = NSTextField(string: value)
        f.placeholderString = placeholder
        f.translatesAutoresizingMaskIntoConstraints = false
        f.widthAnchor.constraint(equalToConstant: width).isActive = true
        let t = target { _ in onCommit(f.stringValue) }
        f.target = t
        f.action = #selector(ActionTarget.fire(_:))     // Enter
        let b = NSButton(title: button, target: t, action: #selector(ActionTarget.fire(_:)))
        b.bezelStyle = .rounded
        let stack = NSStackView(views: [f, b])
        stack.orientation = .horizontal
        stack.spacing = 8
        add(title, stack)
    }

    func slider(_ title: String, value: Double, min: Double, max: Double, _ onChange: @escaping (Double) -> Void) {
        let t = target { s in onChange((s as? NSSlider)?.doubleValue ?? value) }
        let sl = NSSlider(value: value, minValue: min, maxValue: max, target: t, action: #selector(ActionTarget.fire(_:)))
        sl.isContinuous = true
        sl.translatesAutoresizingMaskIntoConstraints = false
        sl.widthAnchor.constraint(equalToConstant: 200).isActive = true
        add(title, sl)
    }

    func button(_ title: String, _ text: String, _ action: @escaping () -> Void) {
        let t = target { _ in action() }
        let b = NSButton(title: text, target: t, action: #selector(ActionTarget.fire(_:)))
        b.bezelStyle = .rounded
        add(title, b)
    }

    func note(_ text: String) {
        let l = NSTextField(wrappingLabelWithString: text)
        l.font = .systemFont(ofSize: 11)
        l.textColor = .secondaryLabelColor
        l.preferredMaxLayoutWidth = 340
        grid.addRow(with: [NSGridCell.emptyContentView, l])
    }

    func show() {
        doc.layoutSubtreeIfNeeded()
        let fit = doc.fittingSize
        let vis = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame.size ?? NSSize(width: 1200, height: 800)
        let size = NSSize(width: min(fit.width + 2, vis.width * 0.92), height: min(fit.height + 2, vis.height * 0.88))
        window.setContentSize(size)
        window.center()
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }
}
