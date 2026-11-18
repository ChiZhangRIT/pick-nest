// 把 icons/icon.svg 渲染成 App 要用的 PNG：swift tools/render-icons.swift（在仓库根目录运行；只用 macOS 自带的 AppKit，不用装东西）。
// 普通图标直接画整张 SVG（iOS 会自己切圆角）；maskable（安卓等会切成圆形）把 #artwork 那一组缩到 80%，
// 整组落在中间直径 80% 的安全区里，背景照样铺满。改了 icon.svg 以后重新运行，再跑 node scripts/prepare-release.mjs。
import AppKit
import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let svgURL = root.appendingPathComponent("icons/icon.svg")
guard let svg = try? String(contentsOf: svgURL, encoding: .utf8) else { fatalError("读不到 icons/icon.svg：请在仓库根目录运行") }

let artwork = "<g id=\"artwork\" transform=\""
guard svg.contains(artwork) else { fatalError("icon.svg 里要有 <g id=\"artwork\" transform=\"…\">（maskable 版靠它缩放）") }
// 在原来的 transform 外面再套一层：以中心 (256, 256) 缩到 0.8
let maskable = svg.replacingOccurrences(of: artwork, with: artwork + "translate(256 256) scale(0.8) translate(-256 -256) ")

func render(_ source: String, size: Int, to name: String) {
    guard let image = NSImage(data: Data(source.utf8)) else { fatalError("AppKit 读不了这个 SVG") }
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4,
                                        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
          let context = NSGraphicsContext(bitmapImageRep: bitmap) else { fatalError("建不了 \(size)px 的画布") }
    bitmap.size = NSSize(width: size, height: size)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    image.draw(in: NSRect(x: 0, y: 0, width: size, height: size), from: .zero, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    guard let png = bitmap.representation(using: .png, properties: [:]) else { fatalError("PNG 导出失败") }
    do { try png.write(to: root.appendingPathComponent("icons/" + name)) } catch { fatalError("写不了 icons/\(name)：\(error)") }
    print("icons/\(name)  \(size)×\(size)")
}

render(svg, size: 180, to: "icon-180.png")
render(svg, size: 192, to: "icon-192.png")
render(svg, size: 512, to: "icon-512.png")
render(maskable, size: 512, to: "icon-maskable-512.png")
