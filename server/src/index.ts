import "dotenv/config";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";
import { ClientMessageSchema, type ServerMessage } from "./protocol.js";
import {
  streamChatCompletionsText,
  type ChatMessage,
} from "./openai.js";
import {
  getOrCreateConversation,
  normalizeClientId,
  saveConversation,
  type TranscriptMessage,
} from "./store.js";
import {
  DEFAULT_MAX_FILE_BYTES,
  listDir,
  readTextFile,
  searchWorkspace,
  workspaceRootName,
} from "./workspace.js";

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? "8787");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ?? "You are Codex, a helpful coding assistant.";

const REQUIRED_TOKEN = process.env.CODEX_REMOTE_TOKEN;

if (!OPENAI_API_KEY) {
  console.warn(
    "[server] OPENAI_API_KEY is missing. Set it in server/.env before chatting.",
  );
}

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

function getClientId(req: IncomingMessage): string | null {
  return parseRequestUrl(req).searchParams.get("clientId");
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message.toLowerCase().includes("aborted"))
  );
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const token = getAuthToken(req);
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

    let history: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...conversation.transcript.map((m) => ({ role: m.role, content: m.text })),
    ];

    let currentAbort: AbortController | null = null;

    send(ws, { type: "ready", sessionId, model: OPENAI_MODEL, clientId });
    send(ws, {
      type: "workspace_info",
      rootName: workspaceRootName(),
      maxFileBytes: DEFAULT_MAX_FILE_BYTES,
    });
    send(ws, { type: "history", messages: conversation.transcript });

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

      if (msg.data.type === "list_dir") {
        try {
          const { path, entries } = await listDir(msg.data.path ?? ".");
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
        if (currentAbort) currentAbort.abort();
        history.splice(1);
        conversation.transcript.length = 0;
        await saveConversation(conversation);
        send(ws, { type: "reset_ok" });
        send(ws, { type: "history", messages: conversation.transcript });
        return;
      }

      if (msg.data.type === "user_message") {
      if (currentAbort) currentAbort.abort();
      currentAbort = new AbortController();

      const messageId = randomUUID();
      const userText = msg.data.text;
      history.push({ role: "user", content: userText });

      const userMsgId = msg.data.id?.trim() || randomUUID();
      const userCreatedAt = msg.data.createdAt?.trim() || new Date().toISOString();
      const userTranscript: TranscriptMessage = {
        id: userMsgId,
        role: "user",
        text: userText,
        createdAt: userCreatedAt,
      };
      conversation.transcript.push(userTranscript);
      await saveConversation(conversation);

      send(ws, { type: "assistant_start", messageId });

      if (!OPENAI_API_KEY) {
        const assistantText =
          "This server is missing `OPENAI_API_KEY`. Add it to `server/.env` on your Mac and restart the server.";
        const assistantCreatedAt = new Date().toISOString();
        const assistantTranscript: TranscriptMessage = {
          id: messageId,
          role: "assistant",
          text: assistantText,
          createdAt: assistantCreatedAt,
        };
        conversation.transcript.push(assistantTranscript);
        history.push({ role: "assistant", content: assistantText });
        await saveConversation(conversation);
        send(ws, { type: "assistant_delta", messageId, delta: assistantText });
        send(ws, { type: "assistant_end", messageId, text: assistantText });
        send(ws, {
          type: "error",
          code: "missing_api_key",
          message:
            "OPENAI_API_KEY is not set on the server. Add it to server/.env and restart.",
        });
        return;
      }

      let assistantText = "";
      const assistantCreatedAt = new Date().toISOString();
      const assistantTranscript: TranscriptMessage = {
        id: messageId,
        role: "assistant",
        text: "",
        createdAt: assistantCreatedAt,
      };
      conversation.transcript.push(assistantTranscript);
      try {
        for await (const delta of streamChatCompletionsText({
          apiKey: OPENAI_API_KEY,
          baseUrl: OPENAI_BASE_URL,
          model: OPENAI_MODEL,
          messages: history,
          signal: currentAbort.signal,
        })) {
          assistantText += delta;
          assistantTranscript.text = assistantText;
          send(ws, { type: "assistant_delta", messageId, delta });
        }

        history.push({ role: "assistant", content: assistantText });
        await saveConversation(conversation);
        send(ws, { type: "assistant_end", messageId, text: assistantText });
      } catch (err) {
        if (isAbortError(err)) {
          await saveConversation(conversation);
          send(ws, {
            type: "assistant_end",
            messageId,
            text: assistantText,
            aborted: true,
          });
          return;
        }

        const message =
          err instanceof Error ? err.message : "Unknown server error.";
        assistantTranscript.text = assistantText;
        await saveConversation(conversation);
        send(ws, {
          type: "assistant_end",
          messageId,
          text: assistantText,
          aborted: true,
        });
        send(ws, { type: "error", code: "openai_error", message });
      }
      }
    });

    ws.on("close", () => {
      if (currentAbort) currentAbort.abort();
      currentAbort = null;
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
