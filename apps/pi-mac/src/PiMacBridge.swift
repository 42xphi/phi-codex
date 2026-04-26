import AppKit
import ApplicationServices
import Foundation
import Network
import OSAKit
import SQLite3
import SwiftUI

private enum Defaults {
  static let portKey = "pi.bridge.port"
  static let tokenKey = "pi.bridge.token"
  static let codexPortKey = "pi.codex.port"
  static let automationSystemEventsGrantedKey = "pi.perm.automation.system_events.granted"
  static let automationSystemEventsDetailKey = "pi.perm.automation.system_events.detail"
}

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

private struct TccAuthRow {
  let authValue: Int
  let lastModified: Int
}

private func readTccAccessibilityAuth(bundleId: String) -> TccAuthRow? {
  let userDbPath = "\(NSHomeDirectory())/Library/Application Support/com.apple.TCC/TCC.db"
  let systemDbPath = "/Library/Application Support/com.apple.TCC/TCC.db"
  let candidates = [userDbPath, systemDbPath]

  for dbPath in candidates {
    guard FileManager.default.isReadableFile(atPath: dbPath) else { continue }

    var db: OpaquePointer?
    let opened: Int32 = dbPath.withCString { sqlite3_open_v2($0, &db, SQLITE_OPEN_READONLY, nil) }
    guard opened == SQLITE_OK, let db else { continue }
    defer { sqlite3_close(db) }

    let sql = """
    SELECT auth_value, last_modified
    FROM access
    WHERE service='kTCCServiceAccessibility'
      AND client=?
      AND client_type=0
      AND indirect_object_identifier='UNUSED'
    LIMIT 1;
    """

    var stmt: OpaquePointer?
    let prepared: Int32 = sql.withCString { sqlite3_prepare_v2(db, $0, -1, &stmt, nil) }
    guard prepared == SQLITE_OK, let stmt else { continue }
    defer { sqlite3_finalize(stmt) }

    _ = bundleId.withCString { sqlite3_bind_text(stmt, 1, $0, -1, SQLITE_TRANSIENT) }

    guard sqlite3_step(stmt) == SQLITE_ROW else { continue }
    let authValue = Int(sqlite3_column_int(stmt, 0))
    let lastModified = Int(sqlite3_column_int(stmt, 1))
    return TccAuthRow(authValue: authValue, lastModified: lastModified)
  }

  return nil
}

private func httpResponse(status: Int, json: Any) -> Data {
  let body = (try? JSONSerialization.data(withJSONObject: json, options: [])) ?? Data("{\"ok\":false}".utf8)
  var head = ""
  head += "HTTP/1.1 \(status) \r\n"
  head += "Content-Type: application/json; charset=utf-8\r\n"
  head += "Cache-Control: no-store\r\n"
  head += "Content-Length: \(body.count)\r\n"
  head += "Connection: close\r\n"
  head += "\r\n"
  var data = Data(head.utf8)
  data.append(body)
  return data
}

private struct ParsedRequest {
  let method: String
  let target: String
  let path: String
  let query: [String: String]
  let headers: [String: String]
  let body: Data
}

private func parseRequest(from data: Data, maxBodyBytes: Int) -> ParsedRequest? {
  guard let headerRange = data.range(of: Data("\r\n\r\n".utf8)) else { return nil }
  let headerData = data.subdata(in: 0..<headerRange.lowerBound)
  guard let headerText = String(data: headerData, encoding: .utf8) else { return nil }
  let lines = headerText.split(separator: "\r\n", omittingEmptySubsequences: false)
  guard let requestLine = lines.first else { return nil }
  let parts = requestLine.split(separator: " ", omittingEmptySubsequences: true)
  if parts.count < 2 { return nil }

  let method = String(parts[0]).uppercased()
  let target = String(parts[1])

  var headers: [String: String] = [:]
  for line in lines.dropFirst() {
    if line.isEmpty { continue }
    if let idx = line.firstIndex(of: ":") {
      let name = String(line[..<idx]).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
      let value = String(line[line.index(after: idx)...]).trimmingCharacters(in: .whitespacesAndNewlines)
      headers[name] = value
    }
  }

  let contentLength = Int(headers["content-length"] ?? "") ?? 0
  if contentLength < 0 || contentLength > maxBodyBytes { return nil }

  let bodyStart = headerRange.upperBound
  let needed = bodyStart + contentLength
  if data.count < needed { return nil }

  let body = data.subdata(in: bodyStart..<needed)

  let comps = URLComponents(string: "http://localhost\(target)")
  let path = comps?.path ?? target
  var query: [String: String] = [:]
  for item in comps?.queryItems ?? [] {
    if let v = item.value { query[item.name] = v }
  }

  return ParsedRequest(method: method, target: target, path: path, query: query, headers: headers, body: body)
}

private func extractAuthToken(req: ParsedRequest) -> String? {
  if let auth = req.headers["authorization"] {
    let lower = auth.lowercased()
    if lower.hasPrefix("bearer ") {
      return auth.dropFirst("bearer ".count).trimmingCharacters(in: .whitespacesAndNewlines)
    }
  }

  for key in ["x-codex-token", "x-codex-remote-token", "x-auth-token"] {
    if let v = req.headers[key] { return v }
  }

  if let t = req.query["token"] { return t }
  return nil
}

private struct OsaRequest: Decodable {
  let script: String
  let language: String?
  let timeoutMs: Int?
}

private struct OsaResult {
  let timedOut: Bool
  let exitCode: Int
  let stdout: String
  let stderr: String
  let errorNumber: Int?
}

private final class OsaRunner {
  private let queue = DispatchQueue(label: "pi.bridge.osa", qos: .userInitiated)

  func run(script: String, language: String, timeoutMs: Int) -> OsaResult {
    let maxTimeoutMs = max(1_000, min(300_000, timeoutMs))
    let semaphore = DispatchSemaphore(value: 0)
    let lock = NSLock()
    var result: OsaResult? = nil

    queue.async {
      let langName = (language == "JavaScript") ? "JavaScript" : "AppleScript"
      let lang = OSALanguage(forName: langName)
      let osa = OSAScript(source: script, language: lang)
      var errorInfo: NSDictionary?
      let desc = osa.executeAndReturnError(&errorInfo)
      let stdout = desc?.stringValue ?? desc?.description ?? ""

      var stderr = ""
      var errorNumber: Int? = nil
      if let err = errorInfo as? [String: Any] {
        if let n = err["NSAppleScriptErrorNumber"] as? NSNumber { errorNumber = n.intValue }
        else if let n = err["NSAppleScriptErrorNumber"] as? Int { errorNumber = n }

        if let msg = err["NSAppleScriptErrorBriefMessage"] as? String, !msg.isEmpty {
          stderr = msg
        } else if let msg = err["NSAppleScriptErrorMessage"] as? String, !msg.isEmpty {
          stderr = msg
        } else {
          stderr = String(describing: err)
        }
      } else if let err = errorInfo {
        stderr = err.description
      }

      let exitCode = (errorInfo == nil) ? 0 : 1
      lock.lock()
      result = OsaResult(timedOut: false, exitCode: exitCode, stdout: stdout, stderr: stderr, errorNumber: errorNumber)
      lock.unlock()
      semaphore.signal()
    }

    let waited = semaphore.wait(timeout: .now() + .milliseconds(maxTimeoutMs))
    if waited == .timedOut {
      return OsaResult(timedOut: true, exitCode: 124, stdout: "", stderr: "Timed out.", errorNumber: nil)
    }

    lock.lock()
    let final = result ?? OsaResult(timedOut: false, exitCode: 1, stdout: "", stderr: "Unknown error.", errorNumber: nil)
    lock.unlock()
    return final
  }
}

private final class PiHTTPServer {
  private var listener: NWListener?
  private let queue = DispatchQueue(label: "pi.bridge.http", qos: .userInitiated, attributes: .concurrent)
  private let osaRunner = OsaRunner()

  let port: UInt16
  let tokenProvider: () -> String
  let onLog: (String) -> Void
  let onListenerState: (NWListener.State) -> Void

  init(
    port: UInt16,
    tokenProvider: @escaping () -> String,
    onLog: @escaping (String) -> Void,
    onListenerState: @escaping (NWListener.State) -> Void
  ) {
    self.port = port
    self.tokenProvider = tokenProvider
    self.onLog = onLog
    self.onListenerState = onListenerState
  }

  func start() throws {
    if listener != nil { return }
    let nwPort = NWEndpoint.Port(rawValue: port) ?? 8790
    let l = try NWListener(using: .tcp, on: nwPort)

    l.stateUpdateHandler = { [weak self] state in
      self?.onListenerState(state)
      self?.onLog("listener_state=\(state)")
    }

    l.newConnectionHandler = { [weak self] conn in
      self?.handle(conn)
    }

    l.start(queue: queue)
    listener = l
  }

  func stop() {
    listener?.cancel()
    listener = nil
  }

  private func handle(_ conn: NWConnection) {
    conn.start(queue: queue)
    receiveRequest(conn: conn, buffer: Data())
  }

  private func receiveRequest(conn: NWConnection, buffer: Data) {
    conn.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
      guard let self else { return }
      if let error {
        self.onLog("conn_error=\(error)")
        conn.cancel()
        return
      }

      var next = buffer
      if let data { next.append(data) }

      let maxBodyBytes = 256_000
      if let req = parseRequest(from: next, maxBodyBytes: maxBodyBytes) {
        let response = self.route(req: req)
        conn.send(content: response, completion: .contentProcessed { _ in
          conn.cancel()
        })
        return
      }

      if isComplete {
        conn.send(content: httpResponse(status: 400, json: ["ok": false, "error": "bad_request"]), completion: .contentProcessed { _ in
          conn.cancel()
        })
        return
      }

      if next.count > (maxBodyBytes + 64 * 1024) {
        conn.send(content: httpResponse(status: 413, json: ["ok": false, "error": "request_too_large"]), completion: .contentProcessed { _ in
          conn.cancel()
        })
        return
      }

      self.receiveRequest(conn: conn, buffer: next)
    }
  }

  private func route(req: ParsedRequest) -> Data {
    let required = tokenProvider().trimmingCharacters(in: .whitespacesAndNewlines)
    if required.isEmpty {
      return httpResponse(status: 503, json: [
        "ok": false,
        "error": "token_not_configured",
        "message": "Set a bridge token in the Pi app settings.",
      ])
    }

    let token = extractAuthToken(req: req) ?? ""
    if token != required {
      return httpResponse(status: 401, json: ["ok": false, "error": "unauthorized"])
    }

    if req.method == "GET" && req.path == "/mac/health" {
      let version = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "unknown"
      return httpResponse(status: 200, json: [
        "ok": true,
        "enabled": true,
        "platform": "darwin",
        "version": version,
        "bundleId": Bundle.main.bundleIdentifier ?? "",
        "bundlePath": Bundle.main.bundleURL.path,
        "pid": ProcessInfo.processInfo.processIdentifier,
        "axTrusted": AXIsProcessTrusted(),
      ])
    }

    if req.method == "POST" && req.path == "/mac/osascript" {
      if req.body.isEmpty {
        return httpResponse(status: 400, json: ["ok": false, "error": "missing_body"])
      }

      let decoder = JSONDecoder()
      let body: OsaRequest
      do {
        body = try decoder.decode(OsaRequest.self, from: req.body)
      } catch {
        return httpResponse(status: 400, json: ["ok": false, "error": "bad_json"])
      }

      let script = body.script.trimmingCharacters(in: .whitespacesAndNewlines)
      if script.isEmpty {
        return httpResponse(status: 400, json: ["ok": false, "error": "missing_script"])
      }
      if script.count > 200_000 {
        return httpResponse(status: 413, json: ["ok": false, "error": "script_too_large"])
      }

      let language = (body.language == "JavaScript") ? "JavaScript" : "AppleScript"
      let timeoutMs = body.timeoutMs ?? 30_000

      onLog("osascript lang=\(language) chars=\(script.count)")
      let res = osaRunner.run(script: script, language: language, timeoutMs: timeoutMs)
      if res.timedOut {
        return httpResponse(status: 504, json: ["ok": false, "error": "timeout"])
      }

      var payload: [String: Any] = [
        "ok": res.exitCode == 0,
        "exitCode": res.exitCode,
        "stdout": res.stdout,
        "stderr": res.stderr,
      ]
      if let n = res.errorNumber { payload["errorNumber"] = n }
      return httpResponse(status: 200, json: payload)
    }

    return httpResponse(status: 404, json: ["ok": false, "error": "not_found"])
  }
}

@MainActor
final class BridgeStore: ObservableObject {
  @Published var port: String
  @Published var token: String
  @Published var running: Bool
  @Published var codexPort: String
  @Published var codexRunning: Bool
  @Published var codexLog: String
  @Published var codexError: String?
  @Published var axTrusted: Bool
  @Published var screenCaptureGranted: Bool
  @Published var tccAccessibilityAuthValue: Int?
  @Published var tccAccessibilityLastModified: Int?
  @Published var automationSystemEventsGranted: Bool?
  @Published var automationSystemEventsDetail: String
  @Published var log: String
  @Published var error: String?

  private var bridgeServer: PiHTTPServer? = nil
  private var codexProcess: Process? = nil
  private var codexOutPipe: Pipe? = nil
  private var codexErrPipe: Pipe? = nil
  private var lastTccPoll: Date = .distantPast

  init() {
    let storedPort = UserDefaults.standard.integer(forKey: Defaults.portKey)
    let port = storedPort > 0 ? storedPort : 8790
    self.port = String(port)

    let storedToken = (UserDefaults.standard.string(forKey: Defaults.tokenKey) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if storedToken.isEmpty {
      let generated = UUID().uuidString.replacingOccurrences(of: "-", with: "")
      self.token = generated
      UserDefaults.standard.set(generated, forKey: Defaults.tokenKey)
    } else {
      self.token = storedToken
    }

    self.running = false
    let storedCodexPort = UserDefaults.standard.integer(forKey: Defaults.codexPortKey)
    let codexPort = storedCodexPort > 0 ? storedCodexPort : 8787
    self.codexPort = String(codexPort)
    self.codexRunning = false
    self.codexLog = ""
    self.codexError = nil
    let axOpts: NSDictionary = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as NSString: false]
    self.axTrusted = AXIsProcessTrustedWithOptions(axOpts)
    self.screenCaptureGranted = CGPreflightScreenCaptureAccess()
    self.tccAccessibilityAuthValue = nil
    self.tccAccessibilityLastModified = nil
    if UserDefaults.standard.object(forKey: Defaults.automationSystemEventsGrantedKey) != nil {
      self.automationSystemEventsGranted = UserDefaults.standard.bool(forKey: Defaults.automationSystemEventsGrantedKey)
    } else {
      self.automationSystemEventsGranted = nil
    }
    self.automationSystemEventsDetail =
      UserDefaults.standard.string(forKey: Defaults.automationSystemEventsDetailKey) ?? "Not requested yet."
    self.log = ""
    self.error = nil

    start()
  }

  func refreshAx() {
    let opts: NSDictionary = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as NSString: false]
    axTrusted = AXIsProcessTrustedWithOptions(opts)
    screenCaptureGranted = CGPreflightScreenCaptureAccess()
    if axTrusted {
      tccAccessibilityAuthValue = nil
      tccAccessibilityLastModified = nil
      return
    }

    let now = Date()
    if now.timeIntervalSince(lastTccPoll) < 5 { return }
    lastTccPoll = now

    guard let bundleId = Bundle.main.bundleIdentifier else { return }
    if let row = readTccAccessibilityAuth(bundleId: bundleId) {
      tccAccessibilityAuthValue = row.authValue
      tccAccessibilityLastModified = row.lastModified
    } else {
      tccAccessibilityAuthValue = nil
      tccAccessibilityLastModified = nil
    }
  }

  func requestAccessibility() {
    let opts: NSDictionary = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as NSString: true]
    _ = AXIsProcessTrustedWithOptions(opts)
    refreshAx()
  }

  func requestScreenCapture() {
    _ = CGRequestScreenCaptureAccess()
    refreshAx()
  }

  func relaunch() {
    let path = Bundle.main.bundleURL.path.replacingOccurrences(of: "\"", with: "\\\"")
    let cmd = "sleep 0.2; /usr/bin/open \"\(path)\""

    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/sh")
    p.arguments = ["-c", cmd]
    try? p.run()

    NSApp.terminate(nil)
  }

  func resetAccessibilityPermission() {
    guard let bundleId = Bundle.main.bundleIdentifier else { return }

    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/tccutil")
    p.arguments = ["reset", "Accessibility", bundleId]
    try? p.run()
    p.waitUntilExit()
    refreshAx()
  }

  func requestAutomationForSystemEvents() {
    automationSystemEventsDetail = "Requesting… (watch for the macOS prompt)"
    UserDefaults.standard.set(automationSystemEventsDetail, forKey: Defaults.automationSystemEventsDetailKey)

    let script = """
    tell application "System Events"
      return name of first application process whose frontmost is true
    end tell
    """

    Task { [script] in
      let res: OsaResult = await withCheckedContinuation { cont in
        DispatchQueue.global(qos: .userInitiated).async {
          let runner = OsaRunner()
          cont.resume(returning: runner.run(script: script, language: "AppleScript", timeoutMs: 60_000))
        }
      }

      if res.timedOut {
        automationSystemEventsGranted = false
        automationSystemEventsDetail = "Timed out waiting for permission prompt."
        UserDefaults.standard.set(false, forKey: Defaults.automationSystemEventsGrantedKey)
        UserDefaults.standard.set(automationSystemEventsDetail, forKey: Defaults.automationSystemEventsDetailKey)
        return
      }
      if res.exitCode == 0 {
        automationSystemEventsGranted = true
        automationSystemEventsDetail = "Granted (System Events)."
        UserDefaults.standard.set(true, forKey: Defaults.automationSystemEventsGrantedKey)
        UserDefaults.standard.set(automationSystemEventsDetail, forKey: Defaults.automationSystemEventsDetailKey)
        return
      }

      automationSystemEventsGranted = false
      if res.errorNumber == -1743 {
        automationSystemEventsDetail = "Denied (not authorized to send Apple events). Open Automation settings and allow Pi → System Events."
      } else if !res.stderr.isEmpty {
        automationSystemEventsDetail = res.stderr
      } else {
        automationSystemEventsDetail = "Denied."
      }

      UserDefaults.standard.set(false, forKey: Defaults.automationSystemEventsGrantedKey)
      UserDefaults.standard.set(automationSystemEventsDetail, forKey: Defaults.automationSystemEventsDetailKey)
    }
  }

  private func describeListenerFailure(_ err: NWError, port: UInt16) -> String {
    switch err {
    case .posix(let code) where code == .EADDRINUSE:
      return "Port \(port) is already in use. Quit the other app using it (often another Pi), or change the port."
    default:
      return "Listener failed: \(String(describing: err))"
    }
  }

  func saveSettings() {
    let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
    UserDefaults.standard.set(trimmed, forKey: Defaults.tokenKey)
    if let p = UInt16(port) {
      UserDefaults.standard.set(Int(p), forKey: Defaults.portKey)
    }
    if let p = UInt16(codexPort) {
      UserDefaults.standard.set(Int(p), forKey: Defaults.codexPortKey)
    }
  }

  func start() {
    stopCodexServer()
    stopBridge()

    saveSettings()
    refreshAx()
    error = nil
    log = ""
    running = false

    let p = UInt16(port) ?? 8790
    let tokenProvider = { [weak self] in
      (self?.token ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    let srv = PiHTTPServer(
      port: p,
      tokenProvider: tokenProvider,
      onLog: { [weak self] msg in
        Task { @MainActor in self?.log = msg }
      },
      onListenerState: { [weak self] state in
        Task { @MainActor in
          guard let self else { return }
          switch state {
          case .ready:
            self.running = true
            self.error = nil
          case .failed(let err):
            self.running = false
            self.error = self.describeListenerFailure(err, port: p)
          case .cancelled:
            self.running = false
          default:
            break
          }
        }
      }
    )

    do {
      try srv.start()
      bridgeServer = srv
    } catch {
      self.error = error.localizedDescription
      running = false
    }

    startCodexServer()
  }

  func stop() {
    stopCodexServer()
    stopBridge()
  }

  private func stopBridge() {
    bridgeServer?.stop()
    bridgeServer = nil
    running = false
  }

  private func appendCodexLogLine(_ rawLine: String) {
    let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
    if line.isEmpty { return }

    codexLog = line
    if line.contains("EADDRINUSE") {
      let portValue = UInt16(codexPort) ?? 8787
      codexError = "Port \(portValue) is already in use. Change the Codex port or quit the other app."

      Task { [weak self] in
        guard let self else { return }
        if await self.isCodexServerHealthy(port: portValue) {
          self.codexRunning = true
          self.codexError = nil
          self.codexLog = "Using existing server on port \(portValue)."
        }
      }
    }
    if codexError != nil, line.contains("[server] ws listening") {
      codexError = nil
    }
  }

  private func bundledServerRoot() -> URL? {
    Bundle.main.resourceURL?.appendingPathComponent("server")
  }

  private func startCodexServer() {
    codexError = nil
    codexLog = ""
    codexRunning = false

    let portValue = UInt16(codexPort) ?? 8787

    Task { [weak self] in
      guard let self else { return }
      if await self.isCodexServerHealthy(port: portValue) {
        self.codexRunning = true
        self.codexError = nil
        self.codexLog = "Using existing server on port \(portValue)."
        return
      }
      self.startEmbeddedCodexServer(portValue: portValue)
    }
  }

  private func isCodexServerHealthy(port: UInt16) async -> Bool {
    guard let url = URL(string: "http://127.0.0.1:\(port)/health") else { return false }
    var req = URLRequest(url: url)
    req.httpMethod = "GET"
    req.timeoutInterval = 0.7
    do {
      let (_, resp) = try await URLSession.shared.data(for: req)
      return (resp as? HTTPURLResponse)?.statusCode == 200
    } catch {
      return false
    }
  }

  private func startEmbeddedCodexServer(portValue: UInt16) {
    guard let serverRoot = bundledServerRoot() else {
      codexError = "Embedded server bundle is missing."
      return
    }
    let script = serverRoot.appendingPathComponent("dist/index.js")
    guard FileManager.default.fileExists(atPath: script.path) else {
      codexError = "Embedded server script not found. Rebuild Pi.app with build.sh."
      return
    }

    let requiredToken = token.trimmingCharacters(in: .whitespacesAndNewlines)

    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    proc.arguments = ["node", script.path]
    proc.currentDirectoryURL = serverRoot

    var env = ProcessInfo.processInfo.environment
    env["HOST"] = "0.0.0.0"
    env["PORT"] = String(portValue)
    env["CODEX_REMOTE_TOKEN"] = requiredToken
    proc.environment = env

    let outPipe = Pipe()
    let errPipe = Pipe()
    proc.standardOutput = outPipe
    proc.standardError = errPipe

    outPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
      guard let self else { return }
      let data = handle.availableData
      if data.isEmpty { return }
      guard let text = String(data: data, encoding: .utf8) else { return }
      Task { @MainActor in
        for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
          self.appendCodexLogLine(String(line))
        }
      }
    }

    errPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
      guard let self else { return }
      let data = handle.availableData
      if data.isEmpty { return }
      guard let text = String(data: data, encoding: .utf8) else { return }
      Task { @MainActor in
        for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
          self.appendCodexLogLine(String(line))
        }
      }
    }

    proc.terminationHandler = { [weak self] proc in
      Task { @MainActor in
        guard let self else { return }
        if self.codexProcess?.processIdentifier == proc.processIdentifier {
          self.codexProcess = nil
          self.codexOutPipe = nil
          self.codexErrPipe = nil
        }
        self.codexRunning = false
        if self.codexError == nil {
          self.codexError = "Codex server stopped (exit \(proc.terminationStatus))."
        }
      }
    }

    do {
      try proc.run()
      codexProcess = proc
      codexOutPipe = outPipe
      codexErrPipe = errPipe
      codexRunning = true
      codexError = nil
    } catch {
      codexError = error.localizedDescription
      codexRunning = false
    }
  }

  private func stopCodexServer() {
    codexOutPipe?.fileHandleForReading.readabilityHandler = nil
    codexErrPipe?.fileHandleForReading.readabilityHandler = nil

    codexProcess?.terminate()
    codexProcess = nil
    codexOutPipe = nil
    codexErrPipe = nil
    codexRunning = false
  }
}

struct ContentView: View {
  @ObservedObject var store: BridgeStore

  private let refreshTimer = Timer.publish(every: 1.0, on: .main, in: .common).autoconnect()

  private func copyToPasteboard(_ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
  }

  private var currentPort: UInt16 {
    UInt16(store.port) ?? 8790
  }

  private var localBaseUrl: String {
    "http://127.0.0.1:\(currentPort)"
  }

  private var codexPort: UInt16 {
    UInt16(store.codexPort) ?? 8787
  }

  private var codexLocalBaseUrl: String {
    "http://127.0.0.1:\(codexPort)"
  }

  private var codexLocalWsUrl: String {
    "ws://127.0.0.1:\(codexPort)"
  }

  private func openAccessibilitySettings() {
    if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
      NSWorkspace.shared.open(url)
    }
  }

  private func openAutomationSettings() {
    if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation") {
      NSWorkspace.shared.open(url)
    }
  }

  private func openScreenRecordingSettings() {
    if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
      NSWorkspace.shared.open(url)
    }
  }

  private func revealAppInFinder() {
    NSWorkspace.shared.activateFileViewerSelecting([Bundle.main.bundleURL])
  }

  private var isInstalledInApplications: Bool {
    let path = Bundle.main.bundleURL.path
    if path.hasPrefix("/Applications/") { return true }
    if path.hasPrefix("\(NSHomeDirectory())/Applications/") { return true }
    return false
  }

  var body: some View {
    Form {
      Section {
        let anyRunning = store.running || store.codexRunning

        HStack(alignment: .center, spacing: 12) {
          Image(nsImage: NSApp.applicationIconImage)
            .resizable()
            .frame(width: 44, height: 44)
            .cornerRadius(10)
          VStack(alignment: .leading, spacing: 2) {
            Text("Pi").font(.title2).bold()
            Text("macOS companion (server + automation)").foregroundStyle(.secondary)
          }
          Spacer()
          Button(anyRunning ? "Restart" : "Start") { store.start() }
          Button("Stop") { store.stop() }.disabled(!anyRunning)
        }
      }

      Section("Automation Bridge") {
        LabeledContent("App") {
          HStack(spacing: 10) {
            VStack(alignment: .trailing, spacing: 2) {
              Text(Bundle.main.bundleIdentifier ?? "")
                .foregroundStyle(.secondary)
              Text(Bundle.main.bundleURL.path)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
            }
            Button("Reveal") { revealAppInFinder() }
          }
        }

        LabeledContent("Server") {
          Text(store.running ? "Running" : "Stopped")
            .foregroundStyle(store.running ? Color.green : Color.secondary)
        }

        HStack {
          Text("Port")
            .frame(width: 70, alignment: .leading)
          TextField("8790", text: $store.port)
            .textFieldStyle(.roundedBorder)
            .frame(width: 100)
          Spacer()
          Button("Save") { store.saveSettings() }
        }

        HStack {
          Text("Token")
            .frame(width: 70, alignment: .leading)
          SecureField("Required", text: $store.token)
            .textFieldStyle(.roundedBorder)
          Button("Save") { store.saveSettings() }
        }

        if let err = store.error {
          Label(err, systemImage: "exclamationmark.triangle.fill")
            .foregroundStyle(.red)
            .textSelection(.enabled)
        } else if !store.log.isEmpty {
          Text(store.log)
            .font(.caption)
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
        }
      }

      Section("Codex Remote Server") {
        LabeledContent("Server") {
          Text(store.codexRunning ? "Running" : "Stopped")
            .foregroundStyle(store.codexRunning ? Color.green : Color.secondary)
        }

        HStack {
          Text("Port")
            .frame(width: 70, alignment: .leading)
          TextField("8787", text: $store.codexPort)
            .textFieldStyle(.roundedBorder)
            .frame(width: 100)
          Spacer()
          Button("Save") { store.saveSettings() }
        }

        if let err = store.codexError {
          Label(err, systemImage: "exclamationmark.triangle.fill")
            .foregroundStyle(.red)
            .textSelection(.enabled)
        } else if !store.codexLog.isEmpty {
          Text(store.codexLog)
            .font(.caption)
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
        }
      }

      Section("Permissions") {
        if !isInstalledInApplications {
          Label("For stable permissions, run Pi from /Applications (or ~/Applications).", systemImage: "info.circle")
            .foregroundStyle(.secondary)
        }

        HStack {
          Button("Request all recommended…") {
            store.requestAccessibility()
            store.requestScreenCapture()
            store.requestAutomationForSystemEvents()
          }
          Spacer()
          Button("Relaunch Pi") { store.relaunch() }
        }

        HStack {
          Text("Accessibility")
          Spacer()
          let tccGranted = store.tccAccessibilityAuthValue == 2
          let statusText: String = {
            if store.axTrusted { return "Granted" }
            return tccGranted ? "Relaunch needed" : "Not granted"
          }()
          Text(statusText)
            .foregroundStyle(store.axTrusted ? Color.green : Color.orange)
          Button("Request…") { store.requestAccessibility() }
          Button("Settings") { openAccessibilitySettings() }
          if !store.axTrusted, tccGranted {
            Button("Relaunch") { store.relaunch() }
            Button("Reset…") { store.resetAccessibilityPermission() }
          }
        }

        if !store.axTrusted, store.tccAccessibilityAuthValue == 2 {
          Text("macOS shows Accessibility enabled for Pi, but Pi still isn’t trusted. Try Relaunch first. If it stays not granted, click Reset… and grant again.")
            .font(.caption)
            .foregroundStyle(.secondary)
        }

        HStack {
          Text("Screen recording")
          Spacer()
          Text(store.screenCaptureGranted ? "Granted" : "Not granted")
            .foregroundStyle(store.screenCaptureGranted ? Color.green : Color.orange)
          Button("Request…") { store.requestScreenCapture() }
          Button("Settings") { openScreenRecordingSettings() }
        }

        HStack {
          Text("Automation (System Events)")
          Spacer()
          let statusText: String = {
            if let granted = store.automationSystemEventsGranted {
              return granted ? "Granted" : "Not granted"
            }
            return "Not requested"
          }()
          Text(statusText)
            .foregroundStyle((store.automationSystemEventsGranted ?? false) ? Color.green : Color.secondary)
          Button("Request…") { store.requestAutomationForSystemEvents() }
          Button("Settings") { openAutomationSettings() }
        }

        Text(store.automationSystemEventsDetail)
          .font(.caption)
          .foregroundStyle(.secondary)
          .textSelection(.enabled)

        Text("Automation permissions only appear after Pi first tries to control an app. Click Request to trigger the macOS prompt, then allow Pi → System Events.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }

      Section("Endpoints") {
        let codexHealth = "\(codexLocalBaseUrl)/health"
        let codexWs = codexLocalWsUrl
        let bridgeHealth = "\(localBaseUrl)/mac/health"
        let bridgeOsa = "\(localBaseUrl)/mac/osascript"
        let remoteBridgeHealth = "https://pi.phi.pe/mac/health"

        HStack {
          Text("Local Codex WS")
          Spacer()
          Text(codexWs)
            .font(.system(.body, design: .monospaced))
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
          Button("Copy") { copyToPasteboard(codexWs) }
        }

        HStack {
          Text("Local Codex health")
          Spacer()
          Text(codexHealth)
            .font(.system(.body, design: .monospaced))
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
          Button("Copy") { copyToPasteboard(codexHealth) }
        }

        HStack {
          Text("Local bridge health")
          Spacer()
          Text(bridgeHealth)
            .font(.system(.body, design: .monospaced))
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
          Button("Copy") { copyToPasteboard(bridgeHealth) }
        }

        HStack {
          Text("Local bridge osascript")
          Spacer()
          Text(bridgeOsa)
            .font(.system(.body, design: .monospaced))
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
          Button("Copy") { copyToPasteboard(bridgeOsa) }
        }

        HStack {
          Text("Tunnel bridge health")
          Spacer()
          Text(remoteBridgeHealth)
            .font(.system(.body, design: .monospaced))
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
          Button("Copy") { copyToPasteboard(remoteBridgeHealth) }
        }
      }

      Section {
        Text("Pi accepts requests only when the token matches (Bearer / x-codex-token / ?token=). Keep it secret.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped)
    .frame(width: 620, height: 520)
    .onReceive(refreshTimer) { _ in
      store.refreshAx()
    }
  }
}

@main
struct PiMacBridgeApp: App {
  @StateObject private var store = BridgeStore()

  var body: some Scene {
    WindowGroup {
      ContentView(store: store)
    }
  }
}
