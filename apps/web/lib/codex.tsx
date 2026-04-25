"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  ApprovalDecision,
  ClientMessage,
  GitCommit,
  GitStatusEntry,
  SearchMatch,
  ServerMessage,
  ThreadSummary,
  TranscriptMessage,
  WorkspaceEntry,
} from "@/lib/protocol";

type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  streaming?: boolean;
};

export type ApprovalRequest = {
  requestId: string;
  kind: "command" | "fileChange" | "permissions" | "unknown";
  title: string;
  detail: string;
  data?: unknown;
};

type CodexContextValue = {
  connectionState: ConnectionState;
  errorBanner: string | null;
  model: string | null;
  sessionId: string | null;
  serverClientId: string | null;
  wsUrl: string;
  token: string;
  clientId: string;
  setWsUrl: (value: string) => void;
  setToken: (value: string) => void;
  setClientId: (value: string) => void;
  connect: () => void;
  disconnect: () => void;
  saveConnectionSettings: () => void;

  activeThreadId: string | null;
  pendingThreadId: string | null;
  activeCwd: string | null;
  projectCwd: string | null;
  setProjectCwd: (cwd: string | null) => void;
  threads: ThreadSummary[];
  threadsLoading: boolean;
  refreshThreads: (opts?: { searchTerm?: string; limit?: number }) => void;
  selectThread: (threadId: string) => void;
  startThread: (opts?: { cwd?: string }) => void;

  messages: ChatMessage[];
  sendUserMessage: (text: string) => void;
  abort: () => void;
  reset: () => void;

  approvals: ApprovalRequest[];
  respondApproval: (requestId: string, decision: ApprovalDecision) => void;

  workspaceRootName: string | null;
  workspaceMaxFileBytes: number;

  browsePath: string;
  browseEntries: WorkspaceEntry[];
  browseLoading: boolean;
  listDir: (path?: string) => void;

  selectedFilePath: string | null;
  selectedFileContent: string;
  selectedFileLoading: boolean;
  selectedFileTruncated: boolean;
  readFile: (path: string) => void;
  clearSelectedFile: () => void;

  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchMatches: SearchMatch[];
  searchLoading: boolean;
  searchTruncated: boolean;
  searchWorkspace: (query: string, opts?: { path?: string; limit?: number }) => void;

  gitBranch: string | null;
  gitHiddenCount: number;
  gitEntries: GitStatusEntry[];
  gitStatusLoading: boolean;
  refreshGitStatus: () => void;

  gitCommits: GitCommit[];
  gitLogLoading: boolean;
  refreshGitLog: (opts?: { limit?: number }) => void;

  gitDiffPath: string | null;
  gitDiffText: string;
  gitDiffLoading: boolean;
  gitDiffTruncated: boolean;
  gitDiffFile: (path: string, opts?: { maxBytes?: number }) => void;
  clearGitDiff: () => void;
};

const CodexContext = createContext<CodexContextValue | null>(null);

const STORAGE_KEYS = {
  wsUrl: "codex_remote_ws_url",
  token: "codex_remote_token",
  clientId: "codex_remote_client_id",
  projectCwd: "codex_remote_project_cwd",
  threads: "codex_remote_threads_v1",
  threadsLastSyncedAt: "codex_remote_threads_last_synced_at_v1",
};

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  const cryptoAny = globalThis.crypto as any;
  if (cryptoAny?.randomUUID) return `${prefix}_${cryptoAny.randomUUID()}`;
  return `${prefix}_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function normalizeWsBase(raw: string) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) return trimmed;
  if (trimmed.startsWith("http://")) return `ws://${trimmed.slice("http://".length)}`;
  if (trimmed.startsWith("https://")) return `wss://${trimmed.slice("https://".length)}`;
  return `wss://${trimmed}`;
}

function defaultWsUrl() {
  const env = (process.env.NEXT_PUBLIC_WS_URL ?? "").trim();
  if (env) return normalizeWsBase(env);

  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  if (!window.location.host) return "";
  return `${proto}//${window.location.host}`;
}

function getStored(key: string) {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function setStored(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

const THREADS_STALE_AFTER_MS = 60_000;

function loadStoredThreads(): ThreadSummary[] {
  const raw = getStored(STORAGE_KEYS.threads);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t) =>
        t &&
        typeof t.id === "string" &&
        typeof t.cwd === "string" &&
        typeof t.preview === "string",
    ) as ThreadSummary[];
  } catch {
    return [];
  }
}

function loadStoredThreadsSyncedAt(): number {
  const raw = getStored(STORAGE_KEYS.threadsLastSyncedAt);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function buildWsUrl(base: string, token: string, clientId: string) {
  const normalized = normalizeWsBase(base);
  if (!normalized) return "";
  const url = new URL(normalized);
  if (token.trim()) url.searchParams.set("token", token.trim());
  if (clientId.trim()) url.searchParams.set("clientId", clientId.trim());
  return url.toString();
}

function transcriptToChat(messages: TranscriptMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    text: m.text,
    createdAt: m.createdAt,
  }));
}

export function CodexProvider({ children }: { children: React.ReactNode }) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [serverClientId, setServerClientId] = useState<string | null>(null);

  const [wsUrl, setWsUrl] = useState<string>(() => getStored(STORAGE_KEYS.wsUrl) || defaultWsUrl());
  const [token, setToken] = useState<string>(() => getStored(STORAGE_KEYS.token));
  const [clientId, setClientId] = useState<string>(() => getStored(STORAGE_KEYS.clientId) || makeId("client"));

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const [projectCwd, setProjectCwd] = useState<string | null>(() => {
    const raw = getStored(STORAGE_KEYS.projectCwd).trim();
    return raw ? raw : null;
  });

  const [threads, setThreads] = useState<ThreadSummary[]>(loadStoredThreads);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const threadsRef = useRef<ThreadSummary[]>(threads);
  const threadsLastSyncedAtRef = useRef<number>(loadStoredThreadsSyncedAt());

  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);

  const [workspaceRootName, setWorkspaceRootName] = useState<string | null>(null);
  const [workspaceMaxFileBytes, setWorkspaceMaxFileBytes] = useState<number>(120_000);

  const [browsePath, setBrowsePath] = useState<string>("");
  const [browseEntries, setBrowseEntries] = useState<WorkspaceEntry[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);

  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedFileContent, setSelectedFileContent] = useState<string>("");
  const [selectedFileLoading, setSelectedFileLoading] = useState(false);
  const [selectedFileTruncated, setSelectedFileTruncated] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);

  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [gitHiddenCount, setGitHiddenCount] = useState(0);
  const [gitEntries, setGitEntries] = useState<GitStatusEntry[]>([]);
  const [gitStatusLoading, setGitStatusLoading] = useState(false);

  const [gitCommits, setGitCommits] = useState<GitCommit[]>([]);
  const [gitLogLoading, setGitLogLoading] = useState(false);

  const [gitDiffPath, setGitDiffPath] = useState<string | null>(null);
  const [gitDiffText, setGitDiffText] = useState<string>("");
  const [gitDiffLoading, setGitDiffLoading] = useState(false);
  const [gitDiffTruncated, setGitDiffTruncated] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const streamingIdRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const openTimeoutRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(true);
  const lastToastRef = useRef<{ message: string; at: number } | null>(null);

  const threadsRequestIdRef = useRef<string | null>(null);
  const browseRequestIdRef = useRef<string | null>(null);
  const fileRequestIdRef = useRef<string | null>(null);
  const searchRequestIdRef = useRef<string | null>(null);
  const gitStatusRequestIdRef = useRef<string | null>(null);
  const gitLogRequestIdRef = useRef<string | null>(null);
  const gitDiffRequestIdRef = useRef<string | null>(null);

  const pingTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const connectRef = useRef<() => void>(() => {});

  const safeSend = useCallback((message: ClientMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }, []);

  const toastError = useCallback((message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;
    const now = Date.now();
    const last = lastToastRef.current;
    if (last && last.message === trimmed && now - last.at < 1500) return;
    lastToastRef.current = { message: trimmed, at: now };
    toast.error(trimmed);
  }, []);

  const cleanupSocket = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (openTimeoutRef.current) {
      window.clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
    if (pingTimerRef.current) {
      window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
      } catch {}
    }
    wsRef.current = null;
    streamingIdRef.current = null;
  }, []);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    cleanupSocket();
    setConnectionState("disconnected");
  }, [cleanupSocket]);

  const scheduleReconnect = useCallback(() => {
    if (!shouldReconnectRef.current) return;
    if (reconnectTimerRef.current) return;

    const attempt = reconnectAttemptRef.current;
    const delay = Math.min(10_000, 500 * Math.pow(1.6, attempt));
    reconnectAttemptRef.current = attempt + 1;
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connectRef.current();
    }, delay);
  }, []);

  const refreshThreads = useCallback(
    (opts: { searchTerm?: string; limit?: number } = {}) => {
      const requestId = makeId("threads");
      threadsRequestIdRef.current = requestId;
      setThreadsLoading(true);
      safeSend({
        type: "threads_list",
        requestId,
        limit: opts.limit,
        searchTerm: opts.searchTerm,
      });
    },
    [safeSend],
  );

  const listDir = useCallback(
    (path?: string) => {
      const requestId = makeId("dir");
      browseRequestIdRef.current = requestId;
      setBrowseLoading(true);
      safeSend({ type: "list_dir", requestId, path });
    },
    [safeSend],
  );

  const refreshGitStatus = useCallback(() => {
    const requestId = makeId("git_status");
    gitStatusRequestIdRef.current = requestId;
    setGitStatusLoading(true);
    safeSend({ type: "git_status", requestId });
  }, [safeSend]);

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === "ready") {
      setSessionId(msg.sessionId);
      setModel(msg.model);
      setServerClientId(msg.clientId);
      setConnectionState("connected");
      setErrorBanner(null);
      reconnectAttemptRef.current = 0;
      return;
    }

    if (msg.type === "thread_active") {
      setPendingThreadId(null);
      setActiveThreadId(msg.threadId);
      setActiveCwd(msg.cwd);
      setProjectCwd(msg.cwd);
      setModel(msg.model);
      // Only sync threads list when it's stale or we haven't cached this thread yet.
      const cached = threadsRef.current;
      const hasThread = cached.some((t) => t.id === msg.threadId);
      const now = Date.now();
      const last = threadsLastSyncedAtRef.current;
      const isFresh = cached.length > 0 && last > 0 && now - last < THREADS_STALE_AFTER_MS;
      if (!hasThread || !isFresh) refreshThreads();
      listDir();
      refreshGitStatus();
      return;
    }

    if (msg.type === "history") {
      setMessages(transcriptToChat(msg.messages));
      streamingIdRef.current = null;
      return;
    }

    if (msg.type === "assistant_start") {
      streamingIdRef.current = msg.messageId;
      setMessages((prev) => [
        ...prev,
        {
          id: msg.messageId,
          role: "assistant",
          text: "",
          createdAt: nowIso(),
          streaming: true,
        },
      ]);
      return;
    }

    if (msg.type === "assistant_delta") {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msg.messageId ? { ...m, text: `${m.text}${msg.delta}`, streaming: true } : m,
        ),
      );
      return;
    }

    if (msg.type === "assistant_end") {
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.messageId ? { ...m, text: msg.text, streaming: false } : m)),
      );
      streamingIdRef.current = null;
      return;
    }

    if (msg.type === "approval_request") {
      setApprovals((prev) => {
        if (prev.some((p) => p.requestId === msg.requestId)) return prev;
        return [
          ...prev,
          {
            requestId: msg.requestId,
            kind: msg.kind,
            title: msg.title,
            detail: msg.detail,
            data: msg.data,
          },
        ];
      });
      return;
    }

    if (msg.type === "workspace_info") {
      setWorkspaceRootName(msg.rootName);
      setWorkspaceMaxFileBytes(msg.maxFileBytes);
      return;
    }

    if (msg.type === "threads") {
      if (threadsRequestIdRef.current && msg.requestId !== threadsRequestIdRef.current) return;
      setThreads(msg.threads);
      threadsRef.current = msg.threads;
      const now = Date.now();
      threadsLastSyncedAtRef.current = now;
      setStored(STORAGE_KEYS.threadsLastSyncedAt, String(now));
      setThreadsLoading(false);
      setErrorBanner(null);
      return;
    }

    if (msg.type === "dir_list") {
      if (browseRequestIdRef.current && msg.requestId !== browseRequestIdRef.current) return;
      setBrowsePath(msg.path);
      setBrowseEntries(msg.entries);
      setBrowseLoading(false);
      setErrorBanner(null);
      return;
    }

    if (msg.type === "file_content") {
      if (fileRequestIdRef.current && msg.requestId !== fileRequestIdRef.current) return;
      setSelectedFilePath(msg.path);
      setSelectedFileContent(msg.content);
      setSelectedFileTruncated(Boolean(msg.truncated));
      setSelectedFileLoading(false);
      setErrorBanner(null);
      return;
    }

    if (msg.type === "search_results") {
      if (searchRequestIdRef.current && msg.requestId !== searchRequestIdRef.current) return;
      setSearchMatches(msg.matches);
      setSearchTruncated(Boolean(msg.truncated));
      setSearchLoading(false);
      setErrorBanner(null);
      return;
    }

    if (msg.type === "git_status") {
      if (gitStatusRequestIdRef.current && msg.requestId !== gitStatusRequestIdRef.current) return;
      setGitBranch(msg.branch);
      setGitEntries(msg.entries);
      setGitHiddenCount(msg.hiddenCount ?? 0);
      setGitStatusLoading(false);
      setErrorBanner(null);
      return;
    }

    if (msg.type === "git_log") {
      if (gitLogRequestIdRef.current && msg.requestId !== gitLogRequestIdRef.current) return;
      setGitCommits(msg.commits);
      setGitLogLoading(false);
      setErrorBanner(null);
      return;
    }

    if (msg.type === "git_diff") {
      if (gitDiffRequestIdRef.current && msg.requestId !== gitDiffRequestIdRef.current) return;
      setGitDiffPath(msg.path);
      setGitDiffText(msg.diff);
      setGitDiffTruncated(Boolean(msg.truncated));
      setGitDiffLoading(false);
      setErrorBanner(null);
      return;
    }

    if (msg.type === "reset_ok") {
      setMessages([]);
      return;
    }

    if (msg.type === "error") {
      setPendingThreadId(null);
      const message = msg.message || msg.code;
      setErrorBanner(message);
      toastError(message);
      if (msg.requestId && msg.requestId === threadsRequestIdRef.current) setThreadsLoading(false);
      if (msg.requestId && msg.requestId === browseRequestIdRef.current) setBrowseLoading(false);
      if (msg.requestId && msg.requestId === fileRequestIdRef.current) setSelectedFileLoading(false);
      if (msg.requestId && msg.requestId === searchRequestIdRef.current) setSearchLoading(false);
      if (msg.requestId && msg.requestId === gitStatusRequestIdRef.current) setGitStatusLoading(false);
      if (msg.requestId && msg.requestId === gitLogRequestIdRef.current) setGitLogLoading(false);
      if (msg.requestId && msg.requestId === gitDiffRequestIdRef.current) setGitDiffLoading(false);
      return;
    }
  }, [listDir, refreshGitStatus, refreshThreads, toastError]);

  const connect = useCallback(() => {
    const url = buildWsUrl(wsUrl, token, clientId);
    if (!url) {
      setConnectionState("error");
      setErrorBanner("Missing WS URL.");
      toastError("Missing WS URL.");
      return;
    }

    shouldReconnectRef.current = true;
    cleanupSocket();
    setErrorBanner(null);
    setConnectionState("connecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      setConnectionState("error");
      const message = err instanceof Error ? err.message : "Failed to open WebSocket.";
      setErrorBanner(message);
      toastError(message);
      scheduleReconnect();
      return;
    }

    wsRef.current = ws;
    openTimeoutRef.current = window.setTimeout(() => {
      if (wsRef.current !== ws) return;
      if (ws.readyState === WebSocket.OPEN) return;
      try {
        ws.close();
      } catch {}
      setConnectionState("error");
      setErrorBanner("Connection timed out.");
      toastError("Connection timed out.");
      scheduleReconnect();
    }, 9000);

    ws.onopen = () => {
      setConnectionState("connected");
      setErrorBanner(null);
      reconnectAttemptRef.current = 0;
      if (openTimeoutRef.current) {
        window.clearTimeout(openTimeoutRef.current);
        openTimeoutRef.current = null;
      }
      pingTimerRef.current = window.setInterval(() => safeSend({ type: "ping" }), 25_000);
      listDir();
    };

    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.data ?? "{}")) as ServerMessage;
        if (!parsed || typeof (parsed as any).type !== "string") return;
        handleServerMessage(parsed);
      } catch {}
    };

    ws.onerror = () => {
      setConnectionState("error");
      setErrorBanner("WebSocket error.");
      toastError("WebSocket error.");
    };

    ws.onclose = () => {
      cleanupSocket();
      setConnectionState("disconnected");
      scheduleReconnect();
    };
  }, [
    clientId,
    cleanupSocket,
    handleServerMessage,
    listDir,
    safeSend,
    scheduleReconnect,
    toastError,
    token,
    wsUrl,
  ]);
  connectRef.current = connect;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = buildWsUrl(wsUrl, token, clientId);
    if (!url) return;
    // Auto-connect only when a token is set. This prevents noisy reconnect loops
    // when the server requires CODEX_REMOTE_TOKEN but the client isn't configured yet.
    if (!token.trim()) return;
    connect();
    return () => disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setStored(STORAGE_KEYS.projectCwd, projectCwd ?? "");
  }, [projectCwd]);

  useEffect(() => {
    threadsRef.current = threads;
    setStored(STORAGE_KEYS.threads, JSON.stringify(threads));
  }, [threads]);

  const saveConnectionSettings = useCallback(() => {
    const normalizedUrl = normalizeWsBase(wsUrl);
    const trimmedToken = token.trim();
    const normalizedClientId = clientId.trim() || makeId("client");
    setWsUrl(normalizedUrl);
    setToken(trimmedToken);
    setClientId(normalizedClientId);
    setStored(STORAGE_KEYS.wsUrl, normalizedUrl);
    setStored(STORAGE_KEYS.token, trimmedToken);
    setStored(STORAGE_KEYS.clientId, normalizedClientId);
    connect();
  }, [clientId, connect, token, wsUrl]);

  const selectThread = useCallback(
    (threadId: string) => {
      if (!threadId) return;
      setPendingThreadId(threadId);
      if (!safeSend({ type: "thread_select", threadId })) {
        setPendingThreadId(null);
        setErrorBanner("Not connected.");
        toastError("Not connected.");
      }
    },
    [safeSend, toastError],
  );

  const startThread = useCallback(
    (opts: { cwd?: string } = {}) => {
      const cwd = opts.cwd ?? projectCwd ?? activeCwd ?? undefined;
      setPendingThreadId("starting");
      if (!safeSend({ type: "thread_start", cwd })) {
        setPendingThreadId(null);
        setErrorBanner("Not connected.");
        toastError("Not connected.");
      }
    },
    [activeCwd, projectCwd, safeSend, toastError],
  );

  const sendUserMessage = useCallback(
    (text: string) => {
      const trimmed = (text ?? "").trim();
      if (!trimmed) return;
      const id = makeId("msg");
      const createdAt = nowIso();
      setMessages((prev) => [...prev, { id, role: "user", text: trimmed, createdAt }]);
      if (!safeSend({ type: "user_message", id, createdAt, text: trimmed })) {
        setErrorBanner("Not connected.");
        toastError("Not connected.");
      }
    },
    [safeSend, toastError],
  );

  const abort = useCallback(() => {
    safeSend({ type: "abort" });
  }, [safeSend]);

  const reset = useCallback(() => {
    safeSend({ type: "reset" });
  }, [safeSend]);

  const respondApproval = useCallback(
    (requestId: string, decision: ApprovalDecision) => {
      if (!requestId) return;
      safeSend({ type: "approval_response", requestId, decision });
      setApprovals((prev) => prev.filter((p) => p.requestId !== requestId));
    },
    [safeSend],
  );

  const readFile = useCallback(
    (path: string) => {
      if (!path) return;
      const requestId = makeId("file");
      fileRequestIdRef.current = requestId;
      setSelectedFileLoading(true);
      setSelectedFileTruncated(false);
      safeSend({ type: "read_file", requestId, path });
    },
    [safeSend],
  );

  const clearSelectedFile = useCallback(() => {
    setSelectedFilePath(null);
    setSelectedFileContent("");
    setSelectedFileLoading(false);
    setSelectedFileTruncated(false);
  }, []);

  const searchWorkspace = useCallback(
    (query: string, opts: { path?: string; limit?: number } = {}) => {
      const trimmed = (query ?? "").trim();
      if (!trimmed) return;
      const requestId = makeId("search");
      searchRequestIdRef.current = requestId;
      setSearchLoading(true);
      setSearchTruncated(false);
      safeSend({
        type: "search",
        requestId,
        query: trimmed,
        path: opts.path,
        limit: opts.limit,
      });
    },
    [safeSend],
  );

  const refreshGitLog = useCallback(
    (opts: { limit?: number } = {}) => {
      const requestId = makeId("git_log");
      gitLogRequestIdRef.current = requestId;
      setGitLogLoading(true);
      safeSend({ type: "git_log", requestId, limit: opts.limit });
    },
    [safeSend],
  );

  const gitDiffFile = useCallback(
    (path: string, opts: { maxBytes?: number } = {}) => {
      if (!path) return;
      const requestId = makeId("git_diff");
      gitDiffRequestIdRef.current = requestId;
      setGitDiffLoading(true);
      setGitDiffTruncated(false);
      safeSend({ type: "git_diff", requestId, path, maxBytes: opts.maxBytes });
    },
    [safeSend],
  );

  const clearGitDiff = useCallback(() => {
    setGitDiffPath(null);
    setGitDiffText("");
    setGitDiffLoading(false);
    setGitDiffTruncated(false);
  }, []);

  const value: CodexContextValue = useMemo(
    () => ({
      connectionState,
      errorBanner,
      model,
      sessionId,
      serverClientId,
      wsUrl,
      token,
      clientId,
      setWsUrl,
      setToken,
      setClientId,
      connect,
      disconnect,
      saveConnectionSettings,

      activeThreadId,
      pendingThreadId,
      activeCwd,
      projectCwd,
      setProjectCwd,
      threads,
      threadsLoading,
      refreshThreads,
      selectThread,
      startThread,

      messages,
      sendUserMessage,
      abort,
      reset,

      approvals,
      respondApproval,

      workspaceRootName,
      workspaceMaxFileBytes,

      browsePath,
      browseEntries,
      browseLoading,
      listDir,

      selectedFilePath,
      selectedFileContent,
      selectedFileLoading,
      selectedFileTruncated,
      readFile,
      clearSelectedFile,

      searchQuery,
      setSearchQuery,
      searchMatches,
      searchLoading,
      searchTruncated,
      searchWorkspace,

      gitBranch,
      gitHiddenCount,
      gitEntries,
      gitStatusLoading,
      refreshGitStatus,

      gitCommits,
      gitLogLoading,
      refreshGitLog,

      gitDiffPath,
      gitDiffText,
      gitDiffLoading,
      gitDiffTruncated,
      gitDiffFile,
      clearGitDiff,
    }),
    [
      abort,
      activeCwd,
      activeThreadId,
      approvals,
      browseEntries,
      browseLoading,
      browsePath,
      clearGitDiff,
      clearSelectedFile,
      clientId,
      connect,
      connectionState,
      disconnect,
      errorBanner,
      gitBranch,
      gitCommits,
      gitDiffFile,
      gitDiffLoading,
      gitDiffPath,
      gitDiffText,
      gitDiffTruncated,
      gitEntries,
      gitHiddenCount,
      gitLogLoading,
      gitStatusLoading,
      listDir,
      messages,
      model,
      projectCwd,
      pendingThreadId,
      readFile,
      refreshGitLog,
      refreshGitStatus,
      refreshThreads,
      reset,
      respondApproval,
      saveConnectionSettings,
      searchLoading,
      searchMatches,
      searchQuery,
      searchTruncated,
      searchWorkspace,
      selectThread,
      sendUserMessage,
      serverClientId,
      sessionId,
      setClientId,
      setProjectCwd,
      setSearchQuery,
      setToken,
      setWsUrl,
      selectedFileContent,
      selectedFileLoading,
      selectedFilePath,
      selectedFileTruncated,
      startThread,
      threads,
      threadsLoading,
      token,
      workspaceMaxFileBytes,
      workspaceRootName,
      wsUrl,
    ],
  );

  return <CodexContext.Provider value={value}>{children}</CodexContext.Provider>;
}

export function useCodex() {
  const ctx = useContext(CodexContext);
  if (!ctx) throw new Error("useCodex must be used within CodexProvider");
  return ctx;
}
