import Cocoa

/// Мост «замыкание → target/action» для элементов AppKit.
final class ActionTarget: NSObject {
    let fn: (Any?) -> Void
    init(_ fn: @escaping (Any?) -> Void) { self.fn = fn }
    @objc func fire(_ sender: Any?) { fn(sender) }
}

/// Простое окно настроек: подпись слева, элемент справа, разделы.
@MainActor
final class SettingsWindow: NSObject, NSWindowDelegate {
    let window: NSWindow
    private let grid = NSGridView(numberOfColumns: 2, rows: 0)
    private var targets: [ActionTarget] = []
    var onClose: (() -> Void)?

    init(title: String) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 400),
                          styleMask: [.titled, .closable], backing: .buffered, defer: false)
        super.init()
        window.title = title
        window.isReleasedWhenClosed = false
        window.delegate = self
        grid.rowSpacing = 9
        grid.columnSpacing = 12
        grid.column(at: 0).xPlacement = .trailing
        grid.rowAlignment = .firstBaseline
        grid.translatesAutoresizingMaskIntoConstraints = false
        let content = NSView()
        content.addSubview(grid)
        NSLayoutConstraint.activate([
            grid.topAnchor.constraint(equalTo: content.topAnchor, constant: 20),
            grid.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -20),
            grid.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            grid.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
        ])
        window.contentView = content
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
        window.contentView?.layoutSubtreeIfNeeded()
        if let size = window.contentView?.fittingSize { window.setContentSize(size) }
        window.center()
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }
}
