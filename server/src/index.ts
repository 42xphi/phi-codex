import "dotenv/config";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";
import { ClientMessageSchema, type ServerMessage } from "./protocol.js";
import {
  getOrCreateConversation,
  normalizeClientId,
  saveConversation,
} from "./store.js";
import {
  DEFAULT_WORKSPACE_ROOT,
  DEFAULT_MAX_FILE_BYTES,
  listDir,
  readTextFile,
  searchWorkspace,
  workspaceRootNameFor,
} from "./workspace.js";
import { gitDiffFile, gitLog, gitStatus } from "./git.js";
import {
  CodexSession,
  type ApprovalDecision,
  type ApprovalRequest,
} from "./codex.js";

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? "8787");

const CODEX_APP_SERVER_URL =
  process.env.CODEX_APP_SERVER_URL ?? "ws://127.0.0.1:8788";
const CODEX_BIN =
  process.env.CODEX_BIN ?? "/Applications/Codex.app/Contents/Resources/codex";
const CODEX_APP_SERVER_AUTOSTART = process.env.CODEX_APP_SERVER_AUTOSTART !== "0";
const CODEX_CWD = process.env.CODEX_CWD ?? DEFAULT_WORKSPACE_ROOT;
const CODEX_APPROVAL_POLICY =
  (process.env.CODEX_APPROVAL_POLICY as
    | "untrusted"
    | "on-failure"
    | "on-request"
    | "never"
    | undefined) ?? "untrusted";
const CODEX_SANDBOX =
  (process.env.CODEX_SANDBOX as
    | "read-only"
    | "workspace-write"
    | "danger-full-access"
    | undefined) ?? "danger-full-access";

const REQUIRED_TOKEN = process.env.CODEX_REMOTE_TOKEN;

function send(ws: import("ws").WebSocket, message: ServerMessage) {
  ws.send(JSON.stringify(message));
}

function parseRequestUrl(req: IncomingMessage): URL {
  const rawUrl = req.url ?? "/";
  const host = req.headers.host ?? "localhost";
  return new URL(rawUrl, `http://${host}`);
}

function getAuthToken(req: IncomingMessage): string | null {
  return parseRequestUrl(req).searchParams.get("token");
}

function getHeaderToken(req: IncomingMessage): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice("bearer ".length).trim();
  }

  const tokenHeader =
    req.headers["x-codex-token"] ??
    req.headers["x-codex-remote-token"] ??
    req.headers["x-auth-token"];
  if (Array.isArray(tokenHeader)) return tokenHeader[0] ?? null;
  if (typeof tokenHeader === "string") return tokenHeader;
  return null;
}

function getAnyAuthToken(req: IncomingMessage): string | null {
  return getHeaderToken(req) ?? getAuthToken(req);
}

function getClientId(req: IncomingMessage): string | null {
  return parseRequestUrl(req).searchParams.get("clientId");
}

function wsUrlToHttp(wsUrl: string, path: string) {
  const trimmed = wsUrl.trim();
  if (trimmed.startsWith("wss://")) return `https://${trimmed.slice("wss://".length)}${path}`;
  if (trimmed.startsWith("ws://")) return `http://${trimmed.slice("ws://".length)}${path}`;
  return trimmed;
}

let codexAutostartPromise: Promise<void> | null = null;

async function isCodexAppServerUp(): Promise<boolean> {
  const url = wsUrlToHttp(CODEX_APP_SERVER_URL, "/healthz");
  try {
    const res = await fetch(url, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureCodexAppServer(): Promise<void> {
  if (await isCodexAppServerUp()) return;
  if (!CODEX_APP_SERVER_AUTOSTART) {
    throw new Error(
      `Codex app-server is not reachable at ${CODEX_APP_SERVER_URL}. Start it with: codex app-server --listen ${CODEX_APP_SERVER_URL}`,
    );
  }

  if (codexAutostartPromise) return codexAutostartPromise;
  codexAutostartPromise = (async () => {
    const args = ["app-server", "--listen", CODEX_APP_SERVER_URL];
    try {
      const child = spawn(CODEX_BIN, args, { stdio: "ignore", detached: true });
      child.unref();
    } catch (err) {
      throw new Error(
        `Failed to start Codex app-server (${CODEX_BIN}). ${
          err instanceof Error ? err.message : "Unknown error."
        }`,
      );
    }

    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      if (await isCodexAppServerUp()) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(
      `Timed out starting Codex app-server at ${CODEX_APP_SERVER_URL}.`,
    );
  })().finally(() => {
    codexAutostartPromise = null;
  });
  return codexAutostartPromise;
}

const KB_CWD = process.env.KB_CWD;
const KB_PY = process.env.KB_PY ?? "kb.py";
const KB_CONFIG = process.env.KB_CONFIG ?? "kb_config.toml";
const KB_PYTHON = process.env.KB_PYTHON ?? "python3";
const KB_TIMEOUT_MS = Number(process.env.KB_TIMEOUT_MS ?? "30000");

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(moduleDir, "..");
const repoRoot = path.resolve(serverRoot, "..");
const DEFAULT_WEB_BUILD_DIR = path.join(repoRoot, "apps", "web", "out");
const WEB_BUILD_DIR = process.env.WEB_BUILD_DIR
  ? path.resolve(process.env.WEB_BUILD_DIR)
  : DEFAULT_WEB_BUILD_DIR;

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

async function fileExists(p: string) {
  try {
    const st = await fsp.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

function resolveStaticPath(baseDir: string, urlPath: string) {
  const base = path.resolve(baseDir);
  const basePrefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  const decoded = decodeURIComponent(urlPath);
  const rel = decoded.replace(/^\/+/, "");
  const resolved = path.resolve(base, rel);
  if (resolved !== base && !resolved.startsWith(basePrefix)) return null;
  return resolved;
}

async function maybeServeWeb(req: IncomingMessage, res: http.ServerResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  // Only serve if a build exists.
  try {
    const st = await fsp.stat(WEB_BUILD_DIR);
    if (!st.isDirectory()) return false;
  } catch {
    return false;
  }

  const url = parseRequestUrl(req);
  const pathname = url.pathname || "/";
  const hasExt = path.posix.extname(pathname) !== "";

  const candidates: string[] = [];
  if (pathname === "/") {
    candidates.push("/index.html");
  } else if (pathname.endsWith("/")) {
    candidates.push(`${pathname}index.html`);
  } else if (hasExt) {
    candidates.push(pathname);
  } else {
    candidates.push(`${pathname}/index.html`);
    candidates.push(`${pathname}.html`);
  }

  for (const candidate of candidates) {
    const abs = resolveStaticPath(WEB_BUILD_DIR, candidate);
    if (!abs) continue;
    if (!(await fileExists(abs))) continue;

    const ext = path.extname(abs).toLowerCase();
    const type = mimeTypes[ext] ?? "application/octet-stream";

    const cacheControl =
      candidate.startsWith("/_next/") || candidate.includes("/_next/")
        ? "public, max-age=31536000, immutable"
        : "no-store";

    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": cacheControl,
    });
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    fs.createReadStream(abs).pipe(res);
    return true;
  }

  // SPA-ish fallback: serve index.html for unknown routes (no extension).
  if (!hasExt) {
    const abs = resolveStaticPath(WEB_BUILD_DIR, "/index.html");
    if (abs && (await fileExists(abs))) {
      res.writeHead(200, {
        "Content-Type": mimeTypes[".html"],
        "Cache-Control": "no-store",
      });
      if (req.method === "HEAD") {
        res.end();
        return true;
      }
      fs.createReadStream(abs).pipe(res);
      return true;
    }
  }

  return false;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buf.length;
    if (total > maxBytes) throw new Error("body_too_large");
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

async function spawnText(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d) => (stdout += String(d)));
    child.stderr?.on("data", (d) => (stderr += String(d)));

    let timedOut = false;
    const timeoutMs = opts.timeoutMs ?? 0;
    const t =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            try {
              child.kill("SIGKILL");
            } catch {}
          }, timeoutMs)
        : null;

    child.on("error", (err) => {
      if (t) clearTimeout(t);
      reject(err);
    });
    child.on("close", (code) => {
      if (t) clearTimeout(t);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}

async function handleKb(req: IncomingMessage, res: http.ServerResponse) {
  if (REQUIRED_TOKEN) {
    const token = getAnyAuthToken(req);
    if (token !== REQUIRED_TOKEN) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
  }

  if (!KB_CWD) {
    sendJson(res, 503, {
      ok: false,
      error: "kb_not_configured",
      message: "Set KB_CWD (folder containing kb.py and kb_config.toml).",
    });
    return;
  }

  const url = parseRequestUrl(req);

  if (req.method === "GET" && url.pathname === "/kb/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/kb/search") {
    let body: any;
    try {
      body = await readJsonBody(req, 64_000);
    } catch (err) {
      sendJson(res, 400, { ok: false, error: "bad_json" });
      return;
    }

    const q = String(body?.q ?? body?.query ?? "").trim();
    const limitRaw = Number(body?.limit ?? 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 10;
    if (!q) {
      sendJson(res, 400, { ok: false, error: "missing_query" });
      return;
    }

    const { exitCode, stdout, stderr, timedOut } = await spawnText(
      KB_PYTHON,
      [KB_PY, "--config", KB_CONFIG, "query", "--json", q, "--limit", String(limit)],
      { cwd: KB_CWD, timeoutMs: KB_TIMEOUT_MS },
    );
    if (timedOut) {
      sendJson(res, 504, { ok: false, error: "timeout" });
      return;
    }
    if (exitCode !== 0 && exitCode !== 1 && exitCode !== 2) {
      sendJson(res, 500, { ok: false, error: "kb_failed" });
      return;
    }
    try {
      sendJson(res, 200, JSON.parse(stdout));
    } catch {
      sendJson(res, 500, {
        ok: false,
        error: "kb_bad_output",
        stderr: stderr.slice(0, 2000),
      });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/kb/doc") {
    let body: any;
    try {
      body = await readJsonBody(req, 64_000);
    } catch {
      sendJson(res, 400, { ok: false, error: "bad_json" });
      return;
    }
    const id = String(body?.id ?? body?.docId ?? "").trim();
    const maxCharsRaw = Number(body?.maxChars ?? 20_000);
    const maxChars = Number.isFinite(maxCharsRaw)
      ? Math.max(0, Math.min(200_000, Math.floor(maxCharsRaw)))
      : 20_000;
    if (!id) {
      sendJson(res, 400, { ok: false, error: "missing_id" });
      return;
    }

    const { exitCode, stdout, stderr, timedOut } = await spawnText(
      KB_PYTHON,
      [KB_PY, "--config", KB_CONFIG, "doc", "--json", id, "--max-chars", String(maxChars)],
      { cwd: KB_CWD, timeoutMs: KB_TIMEOUT_MS },
    );
    if (timedOut) {
      sendJson(res, 504, { ok: false, error: "timeout" });
      return;
    }
    if (exitCode !== 0 && exitCode !== 1 && exitCode !== 2) {
      sendJson(res, 500, { ok: false, error: "kb_failed" });
      return;
    }
    try {
      const parsed = JSON.parse(stdout);
      if (parsed?.ok === false && parsed?.error === "not_found") {
        sendJson(res, 404, parsed);
        return;
      }
      sendJson(res, 200, parsed);
    } catch {
      sendJson(res, 500, {
        ok: false,
        error: "kb_bad_output",
        stderr: stderr.slice(0, 2000),
      });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: "not_found" });
}

const server = http.createServer((req, res) => {
  void (async () => {
    const url = parseRequestUrl(req);

    if (req.method === "GET" && url.pathname.startsWith("/health")) {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === "/kb/health" || url.pathname.startsWith("/kb/")) {
      await handleKb(req, res);
      return;
    }

    if (await maybeServeWeb(req, res)) return;

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  })().catch((err) => {
    sendJson(res, 500, { ok: false, error: "server_error", message: String(err) });
  });
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const token = getAnyAuthToken(req);
  if (REQUIRED_TOKEN && token !== REQUIRED_TOKEN) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws, req) => {
  void (async () => {
    const sessionId = randomUUID();

    const rawClientId = req ? getClientId(req) : null;
    const normalizedClientId = rawClientId ? normalizeClientId(rawClientId) : "";
    const clientId = normalizedClientId || randomUUID();

    const conversation = await getOrCreateConversation(clientId);

    let activeWorkspaceRoot = CODEX_CWD;

    send(ws, { type: "ready", sessionId, model: "codex", clientId });
	    send(ws, {
	      type: "workspace_info",
	      rootName: workspaceRootNameFor(activeWorkspaceRoot),
	      maxFileBytes: DEFAULT_MAX_FILE_BYTES,
	    });

	    let codex: CodexSession | null = null;
	    let codexBootPromise: Promise<void> | null = null;
	    let codexBootError: Error | null = null;
	    let connectionClosed = false;

	    function safeSend(message: ServerMessage) {
	      try {
	        send(ws, message);
	      } catch {}
    }

    function handleApprovalRequest(request: ApprovalRequest) {
      safeSend({
        type: "approval_request",
        requestId: request.requestId,
        kind: request.kind,
        title: request.title,
        detail: request.detail,
        data: request.data,
      });
	    }

	    async function bootCodex() {
	      try {
	        codexBootError = null;
	        await ensureCodexAppServer();
	        if (connectionClosed) return;

	        codex = new CodexSession({
	          url: CODEX_APP_SERVER_URL,
	          cwd: CODEX_CWD,
          approvalPolicy: CODEX_APPROVAL_POLICY,
          sandbox: CODEX_SANDBOX,
          threadId: conversation.codexThreadId ?? null,
          clientName: "codex-remote-chat",
          clientVersion: "0.1.0",
          onAssistantStart: (messageId) => safeSend({ type: "assistant_start", messageId }),
          onAssistantDelta: (messageId, delta) =>
            safeSend({ type: "assistant_delta", messageId, delta }),
          onAssistantEnd: (messageId, text, aborted) =>
            safeSend({ type: "assistant_end", messageId, text, aborted }),
          onApprovalRequest: handleApprovalRequest,
          onUnhandledServerRequest: (req) =>
            safeSend({
              type: "error",
              code: "codex_unhandled_server_request",
              message: `Codex requested unsupported method: ${req.method}`,
            }),
          onError: (err) =>
            safeSend({
              type: "error",
              code: "codex_error",
              message: err.message || "Codex error",
            }),
	        });

	        await codex.connect();
	        if (connectionClosed) {
	          codex.close();
	          codex = null;
	          return;
	        }
	        const started = await codex.startOrResumeThread();
	        if (connectionClosed) {
	          codex.close();
	          codex = null;
	          return;
	        }

	        activeWorkspaceRoot = started.cwd || CODEX_CWD;

	        conversation.codexThreadId = started.threadId;
        conversation.transcript = started.history;
        await saveConversation(conversation);

        safeSend({ type: "ready", sessionId, model: started.model, clientId });
        safeSend({
          type: "thread_active",
          threadId: started.threadId,
          cwd: started.cwd,
          model: started.model,
        });
        safeSend({
          type: "workspace_info",
          rootName: workspaceRootNameFor(activeWorkspaceRoot),
          maxFileBytes: DEFAULT_MAX_FILE_BYTES,
        });
	        safeSend({ type: "history", messages: started.history });
	      } catch (err) {
	        const message = err instanceof Error ? err.message : "Unknown error.";
	        codexBootError = err instanceof Error ? err : new Error(message);
	        safeSend({
	          type: "error",
	          code: "codex_connect_failed",
	          message,
	        });
	        safeSend({ type: "history", messages: conversation.transcript });
	      }
	    }

	    function bootCodexOnce(): Promise<void> {
	      if (!codexBootPromise) {
	        codexBootPromise = bootCodex().finally(() => {
	          // Allow retries if the boot failed or the socket closed early.
	          if (!codex) codexBootPromise = null;
	        });
	      }
	      return codexBootPromise;
	    }

	    async function ensureCodexReady(timeoutMs = 12_000): Promise<CodexSession> {
	      if (codex) return codex;
	      const boot = bootCodexOnce();
	      const timeout = new Promise<void>((_, reject) =>
	        setTimeout(() => reject(new Error("Codex is not ready yet.")), timeoutMs),
	      );
	      await Promise.race([boot, timeout]);
	      if (codex) return codex;
	      throw codexBootError ?? new Error("Codex is not ready yet.");
	    }

	    void bootCodexOnce();

    ws.on("message", async (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        send(ws, {
          type: "error",
          code: "bad_json",
          message: "Message must be valid JSON.",
        });
        return;
      }

      const msg = ClientMessageSchema.safeParse(parsed);
      if (!msg.success) {
        send(ws, {
          type: "error",
          code: "bad_message",
          message: "Message shape is invalid.",
        });
        return;
      }

      if (msg.data.type === "ping") {
        send(ws, { type: "pong" });
        return;
      }

	      if (msg.data.type === "abort") {
	        try {
	          const session = await ensureCodexReady(2000);
	          await session.interruptTurn();
	        } catch {}
	        return;
	      }

	      if (msg.data.type === "threads_list") {
	        let session: CodexSession;
	        try {
	          session = await ensureCodexReady();
	        } catch (err) {
	          send(ws, {
	            type: "error",
	            requestId: msg.data.requestId,
	            code: "codex_not_ready",
	            message: err instanceof Error ? err.message : "Codex is not ready yet.",
	          });
	          return;
	        }

	        try {
	          const { threads, nextCursor } = await session.listThreads({
	            limit: msg.data.limit ?? 50,
	            searchTerm: msg.data.searchTerm ?? null,
	          });
          send(ws, {
            type: "threads",
            requestId: msg.data.requestId,
            threads,
            nextCursor: nextCursor ?? undefined,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error.";
          send(ws, {
            type: "error",
            requestId: msg.data.requestId,
            code: "threads_list_failed",
            message,
          });
        }
        return;
      }

	      if (msg.data.type === "thread_select") {
	        let session: CodexSession;
	        try {
	          session = await ensureCodexReady();
	        } catch (err) {
	          send(ws, {
	            type: "error",
	            code: "codex_not_ready",
	            message: err instanceof Error ? err.message : "Codex is not ready yet.",
	          });
	          return;
	        }

	        try {
	          const started = await session.resumeThread(msg.data.threadId);
	          activeWorkspaceRoot = started.cwd || CODEX_CWD;
	          conversation.codexThreadId = started.threadId;
	          conversation.transcript = started.history;
          await saveConversation(conversation);
          send(ws, {
            type: "thread_active",
            threadId: started.threadId,
            cwd: started.cwd,
            model: started.model,
          });
          send(ws, {
            type: "workspace_info",
            rootName: workspaceRootNameFor(activeWorkspaceRoot),
            maxFileBytes: DEFAULT_MAX_FILE_BYTES,
          });
          send(ws, { type: "history", messages: started.history });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error.";
          send(ws, { type: "error", code: "thread_select_failed", message });
        }
        return;
      }

	      if (msg.data.type === "thread_start") {
	        let session: CodexSession;
	        try {
	          session = await ensureCodexReady();
	        } catch (err) {
	          send(ws, {
	            type: "error",
	            code: "codex_not_ready",
	            message: err instanceof Error ? err.message : "Codex is not ready yet.",
	          });
	          return;
	        }

	        const cwd = msg.data.cwd ?? activeWorkspaceRoot ?? CODEX_CWD;

	        try {
	          const started = await session.startThread(cwd);
	          activeWorkspaceRoot = started.cwd || cwd;
	          conversation.codexThreadId = started.threadId;
	          conversation.transcript = started.history;
          await saveConversation(conversation);
          send(ws, {
            type: "thread_active",
            threadId: started.threadId,
            cwd: started.cwd,
            model: started.model,
          });
          send(ws, {
            type: "workspace_info",
            rootName: workspaceRootNameFor(activeWorkspaceRoot),
            maxFileBytes: DEFAULT_MAX_FILE_BYTES,
          });
          send(ws, { type: "history", messages: started.history });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error.";
          send(ws, { type: "error", code: "thread_start_failed", message });
        }
        return;
      }

      if (msg.data.type === "git_status") {
        try {
          const { branch, entries, hiddenCount } = await gitStatus(activeWorkspaceRoot);
          send(ws, {
            type: "git_status",
            requestId: msg.data.requestId,
            branch,
            entries,
            hiddenCount: hiddenCount > 0 ? hiddenCount : undefined,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error.";
          send(ws, {
            type: "error",
            requestId: msg.data.requestId,
            code: "git_status_failed",
            message,
          });
        }
        return;
      }

      if (msg.data.type === "git_diff") {
        try {
          const { path, diff, truncated } = await gitDiffFile(
            activeWorkspaceRoot,
            msg.data.path,
            msg.data.maxBytes,
          );
          send(ws, {
            type: "git_diff",
            requestId: msg.data.requestId,
            path,
            diff,
            truncated,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error.";
          send(ws, {
            type: "error",
            requestId: msg.data.requestId,
            code: "git_diff_failed",
            message,
          });
        }
        return;
      }

      if (msg.data.type === "git_log") {
        try {
          const { commits } = await gitLog(activeWorkspaceRoot, msg.data.limit);
          send(ws, {
            type: "git_log",
            requestId: msg.data.requestId,
            commits,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error.";
          send(ws, {
            type: "error",
            requestId: msg.data.requestId,
            code: "git_log_failed",
            message,
          });
        }
        return;
      }

      if (msg.data.type === "list_dir") {
        try {
          const { path, entries } = await listDir(activeWorkspaceRoot, msg.data.path ?? ".");
          send(ws, {
            type: "dir_list",
            requestId: msg.data.requestId,
            path,
            entries,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error.";
          send(ws, {
            type: "error",
            requestId: msg.data.requestId,
            code: "list_dir_failed",
            message,
          });
        }
        return;
      }

      if (msg.data.type === "read_file") {
        try {
          const maxBytes = msg.data.maxBytes ?? DEFAULT_MAX_FILE_BYTES;
          const { path, content, truncated } = await readTextFile(
            activeWorkspaceRoot,
            msg.data.path,
            maxBytes,
          );
          send(ws, {
            type: "file_content",
            requestId: msg.data.requestId,
            path,
            content,
            truncated,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error.";
          send(ws, {
            type: "error",
            requestId: msg.data.requestId,
            code: "read_file_failed",
            message,
          });
        }
        return;
      }

      if (msg.data.type === "search") {
        try {
          const limit = msg.data.limit ?? 200;
          const { matches, truncated } = await searchWorkspace(
            activeWorkspaceRoot,
            msg.data.query,
            msg.data.path,
            limit,
          );
          send(ws, {
            type: "search_results",
            requestId: msg.data.requestId,
            query: msg.data.query,
            matches,
            truncated,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error.";
          send(ws, {
            type: "error",
            requestId: msg.data.requestId,
            code: "search_failed",
            message,
          });
        }
        return;
      }

      if (msg.data.type === "reset") {
        let session: CodexSession;
        try {
          session = await ensureCodexReady();
        } catch (err) {
          send(ws, {
            type: "error",
            code: "codex_not_ready",
            message: err instanceof Error ? err.message : "Codex is not ready yet.",
          });
          return;
        }

        const started = await session.resetThread();
        activeWorkspaceRoot = started.cwd || CODEX_CWD;
        conversation.transcript = started.history ?? [];
        conversation.codexThreadId = started.threadId ?? null;
        await saveConversation(conversation);
        send(ws, { type: "reset_ok" });
        send(ws, {
          type: "thread_active",
          threadId: started.threadId,
          cwd: started.cwd,
          model: started.model,
        });
        send(ws, {
          type: "workspace_info",
          rootName: workspaceRootNameFor(activeWorkspaceRoot),
          maxFileBytes: DEFAULT_MAX_FILE_BYTES,
        });
        send(ws, { type: "history", messages: conversation.transcript });
        return;
      }

      if (msg.data.type === "approval_response") {
        const decision = msg.data.decision as ApprovalDecision;
        codex?.respondToApproval(msg.data.requestId, decision);
        return;
      }

      if (msg.data.type === "user_message") {
        let session: CodexSession;
        try {
          session = await ensureCodexReady();
        } catch (err) {
          send(ws, {
            type: "error",
            code: "codex_not_ready",
            message: err instanceof Error ? err.message : "Codex is not ready yet.",
          });
          return;
        }

        try {
          await session.sendUserMessage(msg.data.text);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error.";
          send(ws, { type: "error", code: "codex_turn_failed", message });
        }
        return;
      }
    });

    ws.on("close", () => {
      connectionClosed = true;
      codex?.close();
      codex = null;
    });
  })().catch((err) => {
    const message = err instanceof Error ? err.message : "Unknown server error.";
    try {
      send(ws, { type: "error", code: "server_error", message });
    } catch {}
    try {
      ws.close();
    } catch {}
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[server] ws listening on ws://${HOST}:${PORT}`);
  console.log(`[server] health: http://${HOST}:${PORT}/health`);
});
