// 开发用截图：在离屏的 WKWebView 里打开本地的 index.html，截一张 PNG。
// 本机的沙盒不让开端口（python3 -m http.server 起不来），所以直接用 file:// 打开；file:// 下不注册离线缓存，和本地预览一样。
//
// 用法：swift tools/snapshot.swift 输出.png [--width 390] [--height 844] [--hash '#/settings']
//                                  [--theme light|dark] [--lang zh-Hans|zh-Hant-TW|en] [--state 编出来的数据.json] [--wait 1.5]
//                                  [--js '点按钮、打字之类的脚本'] [--after 0.8]
//   --state：一份完整的数据 JSON（{ app:'picknest', v:1, data:{…} }），启动前写进 localStorage 的 picknest.state。
//            只用编出来的数据；不要拿真实备份来截图（截图和数据都不进仓库）。
//   --js：页面打开、等 --wait 秒之后执行的 JavaScript（比如 document.querySelector('.add-input').focus()），
//         再等 --after 秒截图。用来截编辑面板、输入联想这类要先操作才看得到的画面。脚本出错会打印出来，照样截图。
//   每次截图用一份全新的、不落盘的存储，不会碰到别的截图或者 Safari 里的数据。
import AppKit
import WebKit

var args = Array(CommandLine.arguments.dropFirst())
guard let out = args.first, !out.hasPrefix("--") else {
  FileHandle.standardError.write("用法：swift tools/snapshot.swift 输出.png [--width 390] [--height 844] [--hash '#/'] [--theme dark] [--lang en] [--state 数据.json] [--wait 1.5]\n".data(using: .utf8)!)
  exit(2)
}
args.removeFirst()
var opt: [String: String] = [:]
var i = 0
while i < args.count {
  let k = args[i]
  if k.hasPrefix("--"), i + 1 < args.count { opt[String(k.dropFirst(2))] = args[i + 1]; i += 2 } else { i += 1 }
}
let width = Double(opt["width"] ?? "390") ?? 390
let height = Double(opt["height"] ?? "844") ?? 844
let wait = Double(opt["wait"] ?? "1.5") ?? 1.5
let after = Double(opt["after"] ?? "0.8") ?? 0.8
let script = opt["js"]
let root = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().deletingLastPathComponent().standardizedFileURL
let index = root.appendingPathComponent("index.html")

// 启动前写进 localStorage：本机设置（语言、外观）和可选的数据
var local: [String: Any] = [:]
if let l = opt["lang"] { local["lang"] = l }
if let t = opt["theme"] { local["theme"] = t }
func jsString(_ s: String) -> String {
  let data = try! JSONSerialization.data(withJSONObject: [s], options: [])
  let arr = String(data: data, encoding: .utf8)!
  return String(arr.dropFirst().dropLast())
}
var setup = "try { localStorage.clear();"
if !local.isEmpty {
  let data = try! JSONSerialization.data(withJSONObject: local, options: [])
  setup += " localStorage.setItem('picknest.local', \(jsString(String(data: data, encoding: .utf8)!)));"
}
if let path = opt["state"] {
  guard let text = try? String(contentsOfFile: path, encoding: .utf8) else {
    FileHandle.standardError.write("读不到 \(path)\n".data(using: .utf8)!); exit(2)
  }
  setup += " localStorage.setItem('picknest.state', \(jsString(text)));"
}
setup += " } catch (e) {}"

// 类里不能直接用顶层的变量（Swift 不让类闭包捕获脚本顶层的值），所以截图参数从构造函数传进来
final class Shooter: NSObject, WKNavigationDelegate {
  let out: String, width: Double, height: Double, wait: Double, after: Double, script: String?
  init(out: String, width: Double, height: Double, wait: Double, after: Double, script: String?) {
    self.out = out; self.width = width; self.height = height; self.wait = wait; self.after = after; self.script = script
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    DispatchQueue.main.asyncAfter(deadline: .now() + self.wait) {
      guard let script = self.script else { self.shoot(webView); return }
      webView.evaluateJavaScript("(() => { \(script)\n })(); true") { _, error in
        if let error { FileHandle.standardError.write("脚本出错：\(error)\n".data(using: .utf8)!) }
        DispatchQueue.main.asyncAfter(deadline: .now() + self.after) { self.shoot(webView) }
      }
    }
  }
  func shoot(_ webView: WKWebView) {
    let out = self.out
    let cfg = WKSnapshotConfiguration()
    cfg.rect = CGRect(x: 0, y: 0, width: width, height: height)
    webView.takeSnapshot(with: cfg) { image, error in
      guard let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
            let png = rep.representation(using: .png, properties: [:]) else {
        FileHandle.standardError.write("截图失败：\(String(describing: error))\n".data(using: .utf8)!); exit(1)
      }
      do { try png.write(to: URL(fileURLWithPath: out)) } catch { FileHandle.standardError.write("写不进 \(out)\n".data(using: .utf8)!); exit(1) }
      print(out)
      exit(0)
    }
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    FileHandle.standardError.write("打开失败：\(error)\n".data(using: .utf8)!); exit(1)
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let config = WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent()
// file:// 页面加载自己目录里的 ES modules 需要这个开关（只在这个开发工具里开）
config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
config.userContentController.addUserScript(WKUserScript(source: setup, injectionTime: .atDocumentStart, forMainFrameOnly: true))
let web = WKWebView(frame: CGRect(x: 0, y: 0, width: width, height: height), configuration: config)
if let theme = opt["theme"] { web.appearance = NSAppearance(named: theme == "dark" ? .darkAqua : .aqua) }
let window = NSWindow(contentRect: CGRect(x: -10000, y: -10000, width: width, height: height), styleMask: [.borderless], backing: .buffered, defer: false)
window.contentView = web
window.orderBack(nil)
let shooter = Shooter(out: out, width: width, height: height, wait: wait, after: after, script: script)
web.navigationDelegate = shooter
var comps = URLComponents(url: index, resolvingAgainstBaseURL: false)!
if let hash = opt["hash"] { comps.fragment = hash.hasPrefix("#") ? String(hash.dropFirst()) : hash }
web.loadFileURL(comps.url!, allowingReadAccessTo: root)
DispatchQueue.main.asyncAfter(deadline: .now() + 30) { FileHandle.standardError.write("超时\n".data(using: .utf8)!); exit(1) }
app.run()
