import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-native-markdown-display';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  NativeModules,
  Platform,
  Pressable,
  SafeAreaView,
  SectionList,
  ScrollView,
  Share,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

type ChatRole = 'user' | 'assistant';

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  createdAt?: string;
};

type WorkspaceEntry = {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  mtimeMs?: number;
};

type SearchMatch = {
  path: string;
  line: number;
  column: number;
  text: string;
};

type GitStatusEntry = {
  path: string;
  code: string;
  fromPath?: string;
};

type GitCommit = {
  hash: string;
  subject: string;
};

type ThreadSummary = {
  id: string;
  preview: string;
  cwd: string;
  createdAt: number | null;
  updatedAt: number | null;
  statusType: string | null;
  name: string | null;
};

type ApprovalRequestPayload = {
  requestId: string;
  kind: 'command' | 'fileChange' | 'permissions' | 'unknown';
  title: string;
  detail: string;
  data?: any;
};

type ServerMessage =
  | { type: 'ready'; sessionId: string; model: string; clientId: string }
  | { type: 'thread_active'; threadId: string; cwd: string; model: string }
  | {
      type: 'threads';
      requestId: string;
      threads: ThreadSummary[];
      nextCursor?: string;
    }
  | {
      type: 'approval_request';
      requestId: string;
      kind: 'command' | 'fileChange' | 'permissions' | 'unknown';
      title: string;
      detail: string;
      data?: any;
    }
  | { type: 'workspace_info'; rootName: string; maxFileBytes: number }
  | { type: 'history'; messages: ChatMessage[] }
  | {
      type: 'git_status';
      requestId: string;
      branch: string;
      entries: GitStatusEntry[];
      hiddenCount?: number;
    }
  | {
      type: 'git_diff';
      requestId: string;
      path: string;
      diff: string;
      truncated?: boolean;
    }
  | { type: 'git_log'; requestId: string; commits: GitCommit[] }
  | { type: 'dir_list'; requestId: string; path: string; entries: WorkspaceEntry[] }
  | {
      type: 'file_content';
      requestId: string;
      path: string;
      content: string;
      truncated?: boolean;
    }
  | {
      type: 'search_results';
      requestId: string;
      query: string;
      matches: SearchMatch[];
      truncated?: boolean;
    }
  | { type: 'pong' }
  | { type: 'reset_ok' }
  | { type: 'assistant_start'; messageId: string }
  | { type: 'assistant_delta'; messageId: string; delta: string }
  | { type: 'assistant_end'; messageId: string; text: string; aborted?: boolean }
  | { type: 'error'; requestId?: string; code: string; message: string };

type ConnectionState = 'disconnected' | 'connecting' | 'connected';

type HealthCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; latencyMs: number }
  | { status: 'error'; message: string };

type WsCloseInfo = {
  code?: number;
  reason?: string;
  at: string;
};

const STORAGE_KEYS = {
  wsUrl: 'codex_remote_ws_url',
  wsUrlOverride: 'codex_remote_ws_url_override_v1',
  token: 'codex_remote_token',
  tokenOverride: 'codex_remote_token_override_v1',
  clientId: 'codex_remote_client_id',
  messages: 'codex_remote_messages_v1',
  autoApproveCommands: 'codex_remote_auto_approve_commands_v1',
  threads: 'codex_remote_threads_v1',
  threadsLastSyncedAt: 'codex_remote_threads_last_synced_at_v1',
  projectCollapsed: 'codex_remote_project_collapsed_v1',
  lastUpdateCheckAt: 'codex_remote_last_update_check_at_v1',
} as const;

const MAX_FILE_CONTEXT_CHARS = 16_000;
const THREADS_STALE_AFTER_MS = 60_000;
const UPDATE_CHECK_MIN_INTERVAL_MS = 0;

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function parseWsUrlList(raw: string | undefined) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function uniqStrings(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const value = v.trim();
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function normalizeClientIdInput(raw: string) {
  const trimmed = raw.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9_-]/g, '');
  return safe.slice(0, 80);
}

function guessWsUrlFromBundle(): string | null {
  if (Platform.OS === 'web') return null;
  try {
    const scriptUrl = (NativeModules as any)?.SourceCode?.scriptURL as string | undefined;
    if (!scriptUrl) return null;
    const match = scriptUrl.match(/^[a-z]+:\/\/([^/:?#]+)(?::\d+)?/i);
    const host = match?.[1]?.trim();
    if (!host) return null;
    return `ws://${host}:8787`;
  } catch {
    return null;
  }
}

function defaultWsUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_WS_URL?.trim();
  if (envUrl) return envUrl;
  const envList = parseWsUrlList(process.env.EXPO_PUBLIC_WS_URLS);
  if (envList.length > 0) return envList[0];
  if (Platform.OS === 'web') return 'ws://localhost:8787';
  return guessWsUrlFromBundle() ?? '';
}

function withQueryParam(wsUrl: string, key: string, value: string) {
  if (!value) return wsUrl;
  try {
    const url = new URL(wsUrl);
    url.searchParams.set(key, value);
    return url.toString();
  } catch {
    const joiner = wsUrl.includes('?') ? '&' : '?';
    return `${wsUrl}${joiner}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
}

function buildEffectiveUrl(wsUrl: string, token: string, clientId: string) {
  let url = wsUrl;
  url = withQueryParam(url, 'token', token);
  url = withQueryParam(url, 'clientId', clientId);
  return url;
}

function healthUrlFromWsUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  const match = trimmed.match(/^(wss?|https?):\/\/([^/?#]+)(?:[/?#].*)?$/i);
  if (!match) return null;
  const scheme = match[1].toLowerCase();
  const authority = match[2];
  const httpScheme = scheme === 'wss' || scheme === 'https' ? 'https' : 'http';
  return `${httpScheme}://${authority}/health`;
}

function hostLabel(rawUrl: string) {
  try {
    return new URL(rawUrl).host;
  } catch {
    return rawUrl;
  }
}

function basenameFromPath(rawPath: string | null | undefined) {
  const value = (rawPath ?? '').trim();
  if (!value) return '';
  const trimmed = value.replace(/\/+$/, '');
  const parts = trimmed.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : trimmed;
}

const MONO_FONT_FAMILY = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

const MARKDOWN_STYLES = {
  body: {
    padding: 0,
    margin: 0,
  },
  text: {
    color: '#f9fafb',
    fontSize: 15,
    lineHeight: 20,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 8,
  },
  heading1: {
    flexDirection: 'row',
    fontSize: 17,
    fontWeight: '800',
    marginTop: 10,
    marginBottom: 6,
  },
  heading2: {
    flexDirection: 'row',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 10,
    marginBottom: 6,
  },
  heading3: {
    flexDirection: 'row',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 4,
  },
  heading4: {
    flexDirection: 'row',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 4,
  },
  heading5: {
    flexDirection: 'row',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 4,
  },
  heading6: {
    flexDirection: 'row',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 4,
  },
  bullet_list: {
    marginVertical: 6,
  },
  ordered_list: {
    marginVertical: 6,
  },
  list_item: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginVertical: 2,
  },
  bullet_list_icon: {
    marginLeft: 6,
    marginRight: 8,
  },
  bullet_list_content: {
    flex: 1,
  },
  ordered_list_icon: {
    marginLeft: 6,
    marginRight: 8,
  },
  ordered_list_content: {
    flex: 1,
  },
  blockquote: {
    backgroundColor: 'transparent',
    borderColor: '#273244',
    borderLeftWidth: 2,
    paddingLeft: 12,
    marginVertical: 8,
    opacity: 0.9,
  },
  link: {
    color: '#93c5fd',
    textDecorationLine: 'underline',
  },
  hr: {
    backgroundColor: '#273244',
    height: StyleSheet.hairlineWidth,
    marginVertical: 10,
  },
  code_inline: {
    fontFamily: MONO_FONT_FAMILY,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderWidth: 0,
    borderColor: 'transparent',
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    borderRadius: 10,
    overflow: 'hidden',
    marginVertical: 8,
  },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
  },
  th: {
    flex: 1,
    padding: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  td: {
    flex: 1,
    padding: 6,
  },
} as const;

function isSafeMarkdownUrl(rawUrl: string) {
  const value = (rawUrl ?? '').trim();
  if (!value) return false;

  try {
    const parsed = new URL(value);
    const protocol = parsed.protocol.toLowerCase();
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' || protocol === 'tel:';
  } catch {
    return false;
  }
}

type MessageBlock =
  | { type: 'text'; text: string }
  | { type: 'code'; lang?: string; code: string };

function parseMessageBlocks(rawText: string): MessageBlock[] {
  const text = rawText ?? '';
  if (!text.includes('```')) return [{ type: 'text', text }];

  const blocks: MessageBlock[] = [];
  let rest = text;

  while (rest.length > 0) {
    const fenceStart = rest.indexOf('```');
    if (fenceStart === -1) {
      blocks.push({ type: 'text', text: rest });
      break;
    }

    if (fenceStart > 0) {
      blocks.push({ type: 'text', text: rest.slice(0, fenceStart) });
    }

    const afterStart = rest.slice(fenceStart + 3);
    const fenceEnd = afterStart.indexOf('```');
    if (fenceEnd === -1) {
      blocks.push({ type: 'text', text: rest.slice(fenceStart) });
      break;
    }

    const fenceBody = afterStart.slice(0, fenceEnd);
    rest = afterStart.slice(fenceEnd + 3);

    const firstNewline = fenceBody.indexOf('\n');
    let lang: string | undefined;
    let code = fenceBody;
    if (firstNewline !== -1) {
      const firstLine = fenceBody.slice(0, firstNewline).trim();
      const remaining = fenceBody.slice(firstNewline + 1);
      if (firstLine && !firstLine.includes(' ')) {
        lang = firstLine;
        code = remaining;
      }
    }
    code = code.replace(/\n$/, '');

    blocks.push({ type: 'code', lang, code });
  }

  return blocks;
}

function formatMessageTime(iso: string | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function App() {
  const { width: windowWidth } = useWindowDimensions();
  const showSidebars = windowWidth >= 1024;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [connState, setConnState] = useState<ConnectionState>('disconnected');
  const [serverModel, setServerModel] = useState<string | null>(null);
  const [serverSessionId, setServerSessionId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [approvalQueue, setApprovalQueue] = useState<ApprovalRequestPayload[]>([]);
  const [autoApproveCommands, setAutoApproveCommands] = useState(true);
  const [clientId, setClientId] = useState('');
  const [healthCheck, setHealthCheck] = useState<HealthCheckState>({ status: 'idle' });
  const [updateBanner, setUpdateBanner] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [lastOpenAt, setLastOpenAt] = useState<string | null>(null);
  const [lastErrorAt, setLastErrorAt] = useState<string | null>(null);
  const [lastClose, setLastClose] = useState<WsCloseInfo | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(() => defaultWsUrl().length === 0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [wsUrl, setWsUrl] = useState(defaultWsUrl);
  const [token, setToken] = useState(process.env.EXPO_PUBLIC_CODEX_TOKEN ?? '');
  const [activeBaseUrl, setActiveBaseUrl] = useState('');

  const [threadsOpen, setThreadsOpen] = useState(false);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsLastSyncedAt, setThreadsLastSyncedAt] = useState<number | null>(null);
  const [threadsSearch, setThreadsSearch] = useState('');
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [projectCollapsed, setProjectCollapsed] = useState<Record<string, boolean>>({});

  const [activityOpen, setActivityOpen] = useState(false);
  const [activityTab, setActivityTab] = useState<'status' | 'log'>('status');
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [gitHiddenCount, setGitHiddenCount] = useState(0);
  const [gitEntries, setGitEntries] = useState<GitStatusEntry[]>([]);
  const [gitCommits, setGitCommits] = useState<GitCommit[]>([]);
  const [gitStatusLoading, setGitStatusLoading] = useState(false);
  const [gitLogLoading, setGitLogLoading] = useState(false);
  const [gitDiffPath, setGitDiffPath] = useState<string | null>(null);
  const [gitDiffText, setGitDiffText] = useState('');
  const [gitDiffTruncated, setGitDiffTruncated] = useState(false);
  const [gitDiffLoading, setGitDiffLoading] = useState(false);

  const [filesOpen, setFilesOpen] = useState(false);
  const [filesTab, setFilesTab] = useState<'browse' | 'search'>('browse');
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [workspaceMaxFileBytes, setWorkspaceMaxFileBytes] = useState<number>(120_000);
  const [browsePath, setBrowsePath] = useState('');
  const [browseEntries, setBrowseEntries] = useState<WorkspaceEntry[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedFileContent, setSelectedFileContent] = useState<string>('');
  const [selectedFileTruncated, setSelectedFileTruncated] = useState(false);
  const [selectedFileLoading, setSelectedFileLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const streamingAssistantIdRef = useRef<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const isNearBottomRef = useRef(true);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shouldReconnectRef = useRef(true);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const threadsPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapsedPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const candidateIndexRef = useRef(0);
  const browseRequestIdRef = useRef<string | null>(null);
  const fileRequestIdRef = useRef<string | null>(null);
  const searchRequestIdRef = useRef<string | null>(null);
  const gitStatusRequestIdRef = useRef<string | null>(null);
  const gitDiffRequestIdRef = useRef<string | null>(null);
  const gitLogRequestIdRef = useRef<string | null>(null);
  const threadsRequestIdRef = useRef<string | null>(null);
  const filesWorkspaceKeyRef = useRef<string | null>(null);
  const threadsRefreshAtRef = useRef(0);
  const threadsLastSyncedAtRef = useRef(0);
  const autoApproveCommandsRef = useRef(true);

  const candidateBaseUrls = useMemo(() => {
    const envList = parseWsUrlList(process.env.EXPO_PUBLIC_WS_URLS);
    const envUrl = process.env.EXPO_PUBLIC_WS_URL?.trim();
    return uniqStrings([wsUrl.trim(), ...(envUrl ? [envUrl] : []), ...envList]);
  }, [wsUrl]);

  const projectGroups = useMemo(() => {
    const term = threadsSearch.trim().toLowerCase();
    const byCwd = new Map<string, ThreadSummary[]>();

    for (const t of threads) {
      const cwd = (t.cwd ?? '').trim() || '(unknown)';
      const list = byCwd.get(cwd) ?? [];
      list.push(t);
      byCwd.set(cwd, list);
    }

    const groups = Array.from(byCwd.entries()).map(([cwd, list]) => {
      const sortedThreads = [...list].sort((a, b) => {
        const aTs = a.updatedAt ?? a.createdAt ?? 0;
        const bTs = b.updatedAt ?? b.createdAt ?? 0;
        return bTs - aTs;
      });
      const lastUpdated = sortedThreads.length
        ? sortedThreads[0].updatedAt ?? sortedThreads[0].createdAt ?? 0
        : 0;
      const title = basenameFromPath(cwd) || cwd;
      return { cwd, title, threads: sortedThreads, lastUpdated };
    });

    groups.sort((a, b) => {
      if (a.lastUpdated !== b.lastUpdated) return b.lastUpdated - a.lastUpdated;
      return a.title.localeCompare(b.title);
    });

    if (!term) return groups;

    return groups
      .map((group) => {
        const folderMatch =
          group.title.toLowerCase().includes(term) || group.cwd.toLowerCase().includes(term);
        if (folderMatch) return group;

        const filteredThreads = group.threads.filter((t) => {
          const title = (t.name?.trim() || t.preview?.trim() || '').toLowerCase();
          return title.includes(term) || t.id.toLowerCase().includes(term);
        });
        if (!filteredThreads.length) return null;
        return { ...group, threads: filteredThreads };
      })
      .filter(Boolean) as typeof groups;
  }, [threads, threadsSearch]);

  const projectSections = useMemo(() => {
    const active = (activeCwd ?? '').trim();
    return projectGroups.map((g) => {
      const stored = projectCollapsed[g.cwd];
      const collapsed = stored === undefined ? g.cwd !== active : Boolean(stored);
      return {
        title: g.title,
        cwd: g.cwd,
        threadCount: g.threads.length,
        lastUpdated: g.lastUpdated,
        threads: g.threads,
        collapsed,
        data: collapsed ? [] : g.threads,
      };
    });
  }, [projectGroups, projectCollapsed, activeCwd]);

  const effectiveUrlPreview = useMemo(() => {
    const baseUrl = (activeBaseUrl || wsUrl).trim();
    if (!baseUrl) return '';
    const maskedToken = token.trim() ? '***' : '';
    return buildEffectiveUrl(baseUrl, maskedToken, clientId.trim());
  }, [activeBaseUrl, wsUrl, token, clientId]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    return () => {
      shouldReconnectRef.current = false;
      clearReconnectTimer();
      clearOpenTimeout();
      stopPing();
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      if (threadsPersistTimerRef.current) clearTimeout(threadsPersistTimerRef.current);
      if (collapsedPersistTimerRef.current) clearTimeout(collapsedPersistTimerRef.current);
      try {
        wsRef.current?.close();
      } catch {}
      wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    autoApproveCommandsRef.current = autoApproveCommands;
  }, [autoApproveCommands]);

  useEffect(() => {
    (async () => {
      const storedUrl = await AsyncStorage.getItem(STORAGE_KEYS.wsUrl);
      const storedUrlOverride = await AsyncStorage.getItem(STORAGE_KEYS.wsUrlOverride);
      const storedToken = await AsyncStorage.getItem(STORAGE_KEYS.token);
      const storedTokenOverride = await AsyncStorage.getItem(STORAGE_KEYS.tokenOverride);
      const storedClientId = await AsyncStorage.getItem(STORAGE_KEYS.clientId);
      const storedMessages = await AsyncStorage.getItem(STORAGE_KEYS.messages);
      const storedAutoApproveCommands = await AsyncStorage.getItem(STORAGE_KEYS.autoApproveCommands);
      const storedThreads = await AsyncStorage.getItem(STORAGE_KEYS.threads);
      const storedThreadsSyncedAt = await AsyncStorage.getItem(STORAGE_KEYS.threadsLastSyncedAt);
      const storedProjectCollapsed = await AsyncStorage.getItem(STORAGE_KEYS.projectCollapsed);
      const urlOverrideEnabled = storedUrlOverride === '1';
      const tokenOverrideEnabled = storedTokenOverride === '1';
      const envDefault = defaultWsUrl();
      const envToken = (process.env.EXPO_PUBLIC_CODEX_TOKEN ?? '').trim();

      const resolvedUrl = urlOverrideEnabled
        ? (storedUrl ?? '').trim()
        : (envDefault || storedUrl || '').trim();
      const resolvedToken = tokenOverrideEnabled
        ? (storedToken ?? '').trim()
        : (envToken || storedToken || '').trim();

      if (resolvedUrl) setWsUrl(resolvedUrl);
      if (resolvedToken) setToken(resolvedToken);
      else setToken('');

      if (storedClientId) {
        const normalized = normalizeClientIdInput(storedClientId);
        if (normalized) {
          setClientId(normalized);
        } else {
          const newId = makeId('client');
          setClientId(newId);
          await AsyncStorage.setItem(STORAGE_KEYS.clientId, newId);
        }
      } else {
        const newId = makeId('client');
        setClientId(newId);
        await AsyncStorage.setItem(STORAGE_KEYS.clientId, newId);
      }

      if (storedMessages) {
        try {
          const parsed = JSON.parse(storedMessages) as ChatMessage[];
          if (Array.isArray(parsed)) setMessages(parsed);
        } catch {}
      }

      if (storedThreads) {
        try {
          const parsed = JSON.parse(storedThreads) as ThreadSummary[];
          if (Array.isArray(parsed)) {
            const cleaned = parsed.filter(
              (t) =>
                t &&
                typeof (t as any).id === 'string' &&
                typeof (t as any).cwd === 'string' &&
                typeof (t as any).preview === 'string',
            );
            if (cleaned.length) setThreads(cleaned);
          }
        } catch {}
      }

      if (storedProjectCollapsed) {
        try {
          const parsed = JSON.parse(storedProjectCollapsed) as Record<string, boolean>;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            setProjectCollapsed(parsed);
          }
        } catch {}
      }

      if (storedThreadsSyncedAt) {
        const parsed = Number(storedThreadsSyncedAt);
        if (Number.isFinite(parsed) && parsed > 0) {
          threadsLastSyncedAtRef.current = parsed;
          setThreadsLastSyncedAt(parsed);
        }
      }

      if (storedAutoApproveCommands === '0') {
        setAutoApproveCommands(false);
      } else if (storedAutoApproveCommands === '1') {
        setAutoApproveCommands(true);
      } else {
        setAutoApproveCommands(true);
        await AsyncStorage.setItem(STORAGE_KEYS.autoApproveCommands, '1');
      }

      if (!resolvedUrl || !resolvedToken) {
        setSettingsOpen(true);
      }
      setStorageReady(true);
    })().catch(() => {});
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageReady, wsUrl, token]);

  useEffect(() => {
    if (!storageReady) return;
    (async () => {
      if (!Updates.isEnabled) return;
      const now = Date.now();
      const rawLast = await AsyncStorage.getItem(STORAGE_KEYS.lastUpdateCheckAt);
      const last = rawLast ? Number(rawLast) : 0;
      if (Number.isFinite(last) && last > 0 && now - last < UPDATE_CHECK_MIN_INTERVAL_MS) return;
      await AsyncStorage.setItem(STORAGE_KEYS.lastUpdateCheckAt, String(now));

      try {
        const res = await Updates.checkForUpdateAsync();
        if (!res.isAvailable) return;
        setUpdateBanner('Updating…');
        await Updates.fetchUpdateAsync();
        await Updates.reloadAsync();
      } catch {
        // Silent: the app should still be usable offline.
      } finally {
        setUpdateBanner(null);
      }
    })().catch(() => {});
  }, [storageReady]);

  useEffect(() => {
    if (!activityOpen) return;
    if (connState !== 'connected') return;
    requestGitStatus();
    requestGitLog(25);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityOpen, connState]);

  useEffect(() => {
    if (!storageReady) return;
    if (!threadsOpen && !showSidebars) return;
    if (connState !== 'connected') return;
    if (threadsLoading) return;
    const now = Date.now();
    const last = threadsLastSyncedAtRef.current;
    const hasCache = threads.length > 0;
    const isFresh = hasCache && last > 0 && now - last < THREADS_STALE_AFTER_MS;
    if (isFresh) return;
    requestThreadsList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageReady, threadsOpen, showSidebars, connState]);

  useEffect(() => {
    if (!showSidebars) return;
    if (connState !== 'connected') return;
    const key = (activeCwd ?? '').trim();
    if (filesWorkspaceKeyRef.current === key && browseEntries.length > 0) return;
    filesWorkspaceKeyRef.current = key;
    openFiles({ showModal: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSidebars, connState, activeCwd]);

  useEffect(() => {
    if (!activeThreadId) return;
    if (connState !== 'connected') return;
    if (!threadsOpen && !showSidebars) return;
    if (threadsLoading) return;
    const hasThread = threads.some((t) => t.id === activeThreadId);
    if (hasThread) return;
    const now = Date.now();
    if (now - threadsRefreshAtRef.current < 2000) return;
    threadsRefreshAtRef.current = now;
    requestThreadsList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId, connState, threadsOpen, showSidebars, threadsLoading, threads]);

  useEffect(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEYS.messages, JSON.stringify(messages)).catch(() => {});
    }, 600);
  }, [messages]);

  useEffect(() => {
    if (!storageReady) return;
    if (threadsPersistTimerRef.current) clearTimeout(threadsPersistTimerRef.current);
    threadsPersistTimerRef.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEYS.threads, JSON.stringify(threads)).catch(() => {});
      const ts = threadsLastSyncedAtRef.current;
      if (ts) AsyncStorage.setItem(STORAGE_KEYS.threadsLastSyncedAt, String(ts)).catch(() => {});
    }, 800);
  }, [storageReady, threads]);

  useEffect(() => {
    if (!storageReady) return;
    if (collapsedPersistTimerRef.current) clearTimeout(collapsedPersistTimerRef.current);
    collapsedPersistTimerRef.current = setTimeout(() => {
      AsyncStorage.setItem(
        STORAGE_KEYS.projectCollapsed,
        JSON.stringify(projectCollapsed),
      ).catch(() => {});
    }, 500);
  }, [storageReady, projectCollapsed]);

  function stopPing() {
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    pingIntervalRef.current = null;
  }

  function startPing() {
    stopPing();
    pingIntervalRef.current = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify({ type: 'ping' }));
      } catch {}
    }, 20_000);
  }

  function clearReconnectTimer() {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }

  function clearOpenTimeout() {
    if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);
    openTimeoutRef.current = null;
  }

  function disconnect({ keepReconnect } = { keepReconnect: true }) {
    const ws = wsRef.current;
    wsRef.current = null;
    streamingAssistantIdRef.current = null;
    setApprovalQueue([]);
    stopPing();
    clearOpenTimeout();
    if (!keepReconnect) clearReconnectTimer();
    try {
      ws?.close();
    } catch {}
    setConnState('disconnected');
  }

  function scheduleReconnect(reason: string) {
    if (!shouldReconnectRef.current) return;
    if (reconnectTimerRef.current) return;

    if (candidateBaseUrls.length > 1) {
      candidateIndexRef.current = (candidateIndexRef.current + 1) % candidateBaseUrls.length;
    }

    const attempt = Math.min(reconnectAttemptRef.current + 1, 6);
    reconnectAttemptRef.current = attempt;
    setReconnectAttempt(attempt);
    const baseDelayMs = Math.min(30_000, 1000 * 2 ** (attempt - 1));
    const jitterMs = Math.floor(Math.random() * 350);
    const delayMs = baseDelayMs + jitterMs;

    setConnState('connecting');
    setErrorBanner(`${reason} Reconnecting in ${Math.ceil(delayMs / 1000)}s…`);

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connect();
    }, delayMs);
  }

  function connect() {
    clearReconnectTimer();
    disconnect({ keepReconnect: true });
    setHealthCheck({ status: 'idle' });

    const baseUrl = candidateBaseUrls[candidateIndexRef.current] ?? wsUrl.trim();
    setActiveBaseUrl(baseUrl);
    const effectiveUrl = buildEffectiveUrl(baseUrl, token.trim(), clientId.trim());

    if (!effectiveUrl || !effectiveUrl.startsWith('ws')) {
      setErrorBanner('Set a valid WebSocket URL (ws:// or wss://) in Settings.');
      return;
    }

    setConnState('connecting');
    setErrorBanner(null);

    const ws = new WebSocket(effectiveUrl);
    wsRef.current = ws;

    clearOpenTimeout();
    openTimeoutRef.current = setTimeout(() => {
      if (wsRef.current !== ws) return;
      if (ws.readyState === WebSocket.OPEN) return;
      setConnState('disconnected');
      setErrorBanner(`Connection timed out (${hostLabel(baseUrl)}).`);
      try {
        ws.close();
      } catch {}
      scheduleReconnect('Timed out.');
    }, 9000);

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      reconnectAttemptRef.current = 0;
      setReconnectAttempt(0);
      setLastOpenAt(new Date().toISOString());
      setLastErrorAt(null);
      setLastClose(null);
      clearOpenTimeout();
      setConnState('connected');
      setErrorBanner(null);
      startPing();
    };

    ws.onclose = (event) => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      stopPing();
      clearOpenTimeout();
      const closeCode = (event as any)?.code as number | undefined;
      const closeReason = (event as any)?.reason as string | undefined;
      setLastClose({ code: closeCode, reason: closeReason, at: new Date().toISOString() });

      if (!reconnectTimerRef.current) setConnState('disconnected');
      if (shouldReconnectRef.current) {
        const code = (event as any)?.code;
        scheduleReconnect(code ? `Disconnected (${code}).` : 'Disconnected.');
      }
    };

    ws.onerror = () => {
      if (wsRef.current !== ws) return;
      stopPing();
      clearOpenTimeout();
      setLastErrorAt(new Date().toISOString());
      setConnState('disconnected');
      setErrorBanner(`WebSocket error (${hostLabel(baseUrl)}).`);
      scheduleReconnect('WebSocket error.');
      try {
        ws.close();
      } catch {}
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === 'ready') {
        setServerModel(msg.model);
        setServerSessionId(msg.sessionId);
        if (msg.clientId && msg.clientId !== clientId) {
          setClientId(msg.clientId);
          AsyncStorage.setItem(STORAGE_KEYS.clientId, msg.clientId).catch(() => {});
        }
        return;
      }

      if (msg.type === 'thread_active') {
        setActiveThreadId(msg.threadId);
        setActiveCwd(msg.cwd);
        if (msg.model) setServerModel(msg.model);
        return;
      }

      if (msg.type === 'threads') {
        if (msg.requestId === threadsRequestIdRef.current) {
          const nextThreads = Array.isArray(msg.threads) ? msg.threads : [];
          setThreads(nextThreads);
          setThreadsLoading(false);
          const now = Date.now();
          threadsLastSyncedAtRef.current = now;
          setThreadsLastSyncedAt(now);
        }
        return;
      }

      if (msg.type === 'workspace_info') {
        setWorkspaceName(msg.rootName);
        setWorkspaceMaxFileBytes(msg.maxFileBytes);
        return;
      }

      if (msg.type === 'history') {
        if (Array.isArray(msg.messages)) setMessages(msg.messages);
        return;
      }

      if (msg.type === 'approval_request') {
        const req: ApprovalRequestPayload = {
          requestId: msg.requestId,
          kind: msg.kind,
          title: msg.title,
          detail: msg.detail,
          data: (msg as any).data,
        };
        if (req.kind === 'command' && autoApproveCommandsRef.current) {
          try {
            ws.send(
              JSON.stringify({
                type: 'approval_response',
                requestId: req.requestId,
                decision: 'acceptForSession',
              }),
            );
          } catch {}
          return;
        }
        setApprovalQueue((prev) => {
          if (prev.some((p) => p.requestId === req.requestId)) return prev;
          return [...prev, req];
        });
        return;
      }

      if (msg.type === 'git_status') {
        if (msg.requestId === gitStatusRequestIdRef.current) {
          setGitBranch(msg.branch);
          setGitEntries(Array.isArray(msg.entries) ? msg.entries : []);
          setGitHiddenCount(msg.hiddenCount ?? 0);
          setGitStatusLoading(false);
        }
        return;
      }

      if (msg.type === 'git_log') {
        if (msg.requestId === gitLogRequestIdRef.current) {
          setGitCommits(Array.isArray(msg.commits) ? msg.commits : []);
          setGitLogLoading(false);
        }
        return;
      }

      if (msg.type === 'git_diff') {
        if (msg.requestId === gitDiffRequestIdRef.current) {
          setGitDiffPath(msg.path);
          setGitDiffText(msg.diff ?? '');
          setGitDiffTruncated(Boolean(msg.truncated));
          setGitDiffLoading(false);
        }
        return;
      }

      if (msg.type === 'dir_list') {
        if (msg.requestId === browseRequestIdRef.current) {
          setBrowsePath(msg.path ?? '');
          setBrowseEntries(Array.isArray(msg.entries) ? msg.entries : []);
          setBrowseLoading(false);
        }
        return;
      }

      if (msg.type === 'file_content') {
        if (msg.requestId === fileRequestIdRef.current) {
          setSelectedFilePath(msg.path);
          setSelectedFileContent(msg.content ?? '');
          setSelectedFileTruncated(Boolean(msg.truncated));
          setSelectedFileLoading(false);
        }
        return;
      }

      if (msg.type === 'search_results') {
        if (msg.requestId === searchRequestIdRef.current) {
          setSearchMatches(Array.isArray(msg.matches) ? msg.matches : []);
          setSearchTruncated(Boolean(msg.truncated));
          setSearchLoading(false);
        }
        return;
      }

      if (msg.type === 'reset_ok') {
        setMessages([]);
        streamingAssistantIdRef.current = null;
        return;
      }

      if (msg.type === 'assistant_start') {
        streamingAssistantIdRef.current = msg.messageId;
        setMessages((prev) => [
          ...prev,
          { id: msg.messageId, role: 'assistant', text: '', createdAt: new Date().toISOString() },
        ]);
        return;
      }

      if (msg.type === 'assistant_delta') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msg.messageId ? { ...m, text: m.text + msg.delta } : m,
          ),
        );
        return;
      }

      if (msg.type === 'assistant_end') {
        streamingAssistantIdRef.current = null;
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.messageId ? { ...m, text: msg.text } : m)),
        );
        return;
      }

      if (msg.type === 'error') {
        if (msg.requestId && msg.requestId === browseRequestIdRef.current) {
          setBrowseLoading(false);
        }
        if (msg.requestId && msg.requestId === fileRequestIdRef.current) {
          setSelectedFileLoading(false);
        }
        if (msg.requestId && msg.requestId === searchRequestIdRef.current) {
          setSearchLoading(false);
        }
        if (msg.requestId && msg.requestId === gitStatusRequestIdRef.current) {
          setGitStatusLoading(false);
        }
        if (msg.requestId && msg.requestId === gitLogRequestIdRef.current) {
          setGitLogLoading(false);
        }
        if (msg.requestId && msg.requestId === gitDiffRequestIdRef.current) {
          setGitDiffLoading(false);
        }
        if (msg.requestId && msg.requestId === threadsRequestIdRef.current) {
          setThreadsLoading(false);
        }
        setErrorBanner(`${msg.code}: ${msg.message}`);
        return;
      }
    };
  }

  function sendTextMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return false;

    const ws = wsRef.current;
    if (!ws || connState !== 'connected') {
      setErrorBanner('Not connected. Open Settings and check your WS URL.');
      return false;
    }

    setErrorBanner(null);

    const id = makeId('user');
    const createdAt = new Date().toISOString();
    setMessages((prev) => [...prev, { id, role: 'user', text: trimmed, createdAt }]);
    try {
      ws.send(JSON.stringify({ type: 'user_message', id, createdAt, text: trimmed }));
      return true;
    } catch {
      setErrorBanner('Failed to send message.');
      return false;
    }
  }

  function sendUserMessage() {
    const trimmed = input.trim();
    if (!trimmed) return;
    setInput('');
    sendTextMessage(trimmed);
  }

  function sendApprovalDecision(requestId: string, decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel') {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setErrorBanner('Not connected. Cannot send approval decision.');
      return;
    }
    try {
      ws.send(JSON.stringify({ type: 'approval_response', requestId, decision }));
      setApprovalQueue((prev) => prev.filter((p) => p.requestId !== requestId));
    } catch {
      setErrorBanner('Failed to send approval decision.');
    }
  }

  function parentDirPath(current: string) {
    const trimmed = current.trim().replace(/^\/+/, '').replace(/\/+$/, '');
    if (!trimmed) return '';
    const parts = trimmed.split('/').filter(Boolean);
    return parts.slice(0, -1).join('/');
  }

  function requestListDir(path: string) {
    const ws = wsRef.current;
    if (!ws || connState !== 'connected') {
      setErrorBanner('Not connected. Open Settings and check your WS URL.');
      return;
    }
    setBrowseLoading(true);
    const requestId = makeId('dir');
    browseRequestIdRef.current = requestId;
    try {
      ws.send(JSON.stringify({ type: 'list_dir', requestId, path }));
    } catch {
      setBrowseLoading(false);
      setErrorBanner('Failed to request directory listing.');
    }
  }

  function requestReadFile(path: string) {
    const ws = wsRef.current;
    if (!ws || connState !== 'connected') {
      setErrorBanner('Not connected. Open Settings and check your WS URL.');
      return;
    }
    setSelectedFileLoading(true);
    setSelectedFilePath(path);
    setSelectedFileContent('');
    setSelectedFileTruncated(false);
    const requestId = makeId('file');
    fileRequestIdRef.current = requestId;
    try {
      ws.send(
        JSON.stringify({
          type: 'read_file',
          requestId,
          path,
          maxBytes: workspaceMaxFileBytes,
        }),
      );
    } catch {
      setSelectedFileLoading(false);
      setErrorBanner('Failed to request file contents.');
    }
  }

  function requestSearch(query: string, path?: string) {
    const ws = wsRef.current;
    if (!ws || connState !== 'connected') {
      setErrorBanner('Not connected. Open Settings and check your WS URL.');
      return;
    }
    const q = query.trim();
    if (!q) return;
    setSearchLoading(true);
    setSearchMatches([]);
    setSearchTruncated(false);
    const requestId = makeId('search');
    searchRequestIdRef.current = requestId;
    try {
      ws.send(
        JSON.stringify({
          type: 'search',
          requestId,
          query: q,
          path: path && path.trim() ? path : undefined,
          limit: 200,
        }),
      );
    } catch {
      setSearchLoading(false);
      setErrorBanner('Failed to start search.');
    }
  }

  function openFiles({ showModal = true }: { showModal?: boolean } = {}) {
    setFilesTab('browse');
    if (showModal) setFilesOpen(true);
    setSelectedFilePath(null);
    setSelectedFileContent('');
    setSelectedFileLoading(false);
    setSelectedFileTruncated(false);
    setSearchQuery('');
    setSearchMatches([]);
    setSearchLoading(false);
    setSearchTruncated(false);
    setBrowseEntries([]);
    setBrowsePath('');
    setBrowseLoading(false);
    if (connState === 'connected') requestListDir('');
  }

  function closeFiles() {
    setFilesOpen(false);
    setSelectedFilePath(null);
    setSelectedFileContent('');
    setSelectedFileLoading(false);
    setSelectedFileTruncated(false);
    setBrowseLoading(false);
    setSearchLoading(false);
    browseRequestIdRef.current = null;
    fileRequestIdRef.current = null;
    searchRequestIdRef.current = null;
  }

  function requestThreadsList(searchTerm?: string) {
    const ws = wsRef.current;
    if (!ws || connState !== 'connected') {
      setErrorBanner('Not connected. Open Settings and check your WS URL.');
      return;
    }
    setThreadsLoading(true);
    const requestId = makeId('threads');
    threadsRequestIdRef.current = requestId;
    try {
      ws.send(
        JSON.stringify({
          type: 'threads_list',
          requestId,
          limit: 200,
          searchTerm: (searchTerm ?? '').trim() ? (searchTerm ?? '').trim() : undefined,
        }),
      );
    } catch {
      setThreadsLoading(false);
      setErrorBanner('Failed to request threads.');
    }
  }

  function openThreads() {
    setThreadsOpen(true);
  }

  function closeThreads() {
    setThreadsOpen(false);
    setThreadsLoading(false);
    threadsRequestIdRef.current = null;
  }

  function doSelectThread(threadId: string) {
    const ws = wsRef.current;
    if (!ws || connState !== 'connected') {
      setErrorBanner('Not connected. Open Settings and check your WS URL.');
      return;
    }
    setErrorBanner(null);
    try {
      ws.send(JSON.stringify({ type: 'thread_select', threadId }));
      closeThreads();
    } catch {
      setErrorBanner('Failed to switch threads.');
    }
  }

  function confirmSelectThread(thread: ThreadSummary) {
    if (thread.id === activeThreadId) {
      if (!showSidebars) closeThreads();
      return;
    }
    doSelectThread(thread.id);
  }

  function doStartThread(cwd?: string) {
    const ws = wsRef.current;
    if (!ws || connState !== 'connected') {
      setErrorBanner('Not connected. Open Settings and check your WS URL.');
      return;
    }
    setErrorBanner(null);
    try {
      ws.send(JSON.stringify({ type: 'thread_start', cwd: cwd?.trim() || undefined }));
      closeThreads();
    } catch {
      setErrorBanner('Failed to start a new thread.');
    }
  }

  function confirmStartThread(cwd?: string) {
    doStartThread(cwd);
  }

  function requestGitStatus() {
    const ws = wsRef.current;
    if (!ws || connState !== 'connected') {
      setErrorBanner('Not connected. Open Settings and check your WS URL.');
      return;
    }
    setGitStatusLoading(true);
    const requestId = makeId('git_status');
    gitStatusRequestIdRef.current = requestId;
    try {
      ws.send(JSON.stringify({ type: 'git_status', requestId }));
    } catch {
      setGitStatusLoading(false);
      setErrorBanner('Failed to request git status.');
    }
  }

  function requestGitLog(limit = 20) {
    const ws = wsRef.current;
    if (!ws || connState !== 'connected') {
      setErrorBanner('Not connected. Open Settings and check your WS URL.');
      return;
    }
    setGitLogLoading(true);
    const requestId = makeId('git_log');
    gitLogRequestIdRef.current = requestId;
    try {
      ws.send(JSON.stringify({ type: 'git_log', requestId, limit }));
    } catch {
      setGitLogLoading(false);
      setErrorBanner('Failed to request git log.');
    }
  }

  function requestGitDiff(path: string) {
    const ws = wsRef.current;
    if (!ws || connState !== 'connected') {
      setErrorBanner('Not connected. Open Settings and check your WS URL.');
      return;
    }
    setGitDiffLoading(true);
    setGitDiffPath(path);
    setGitDiffText('');
    setGitDiffTruncated(false);
    const requestId = makeId('git_diff');
    gitDiffRequestIdRef.current = requestId;
    try {
      ws.send(JSON.stringify({ type: 'git_diff', requestId, path, maxBytes: 220_000 }));
    } catch {
      setGitDiffLoading(false);
      setErrorBanner('Failed to request git diff.');
    }
  }

  function openActivity() {
    setActivityTab('status');
    setActivityOpen(true);
    setGitDiffPath(null);
    setGitDiffText('');
    setGitDiffTruncated(false);
    setGitDiffLoading(false);
  }

  function closeGitDiff() {
    setGitDiffPath(null);
    setGitDiffText('');
    setGitDiffTruncated(false);
    setGitDiffLoading(false);
    gitDiffRequestIdRef.current = null;
  }

  function closeActivity() {
    setActivityOpen(false);
    closeGitDiff();
    setGitStatusLoading(false);
    setGitLogLoading(false);
    gitStatusRequestIdRef.current = null;
    gitLogRequestIdRef.current = null;
  }

  function buildGitDiffContext(path: string, diff: string, truncated: boolean) {
    const shortened =
      diff.length > MAX_FILE_CONTEXT_CHARS
        ? `${diff.slice(0, MAX_FILE_CONTEXT_CHARS)}\n… (truncated for chat)`
        : diff;
    const header = `Git diff: ${path}${truncated ? ' (server-truncated)' : ''}`;
    return `${header}\n\n\`\`\`diff\n${shortened}\n\`\`\``;
  }

  function insertGitDiffIntoComposer() {
    if (!gitDiffPath) return;
    const snippet = buildGitDiffContext(gitDiffPath, gitDiffText, gitDiffTruncated);
    setInput((prev) => (prev.trim() ? `${prev}\n\n${snippet}` : snippet));
    closeActivity();
  }

  function sendGitDiffToChat() {
    if (!gitDiffPath) return;
    const snippet = buildGitDiffContext(gitDiffPath, gitDiffText, gitDiffTruncated);
    closeActivity();
    sendTextMessage(snippet);
  }

  function buildFileContext(path: string, content: string, truncated: boolean) {
    const shortened =
      content.length > MAX_FILE_CONTEXT_CHARS
        ? `${content.slice(0, MAX_FILE_CONTEXT_CHARS)}\n… (truncated for chat)`
        : content;
    const header = `File: ${path}${truncated ? ' (server-truncated)' : ''}`;
    return `${header}\n\n\`\`\`\n${shortened}\n\`\`\``;
  }

  function insertSelectedFileIntoComposer() {
    if (!selectedFilePath) return;
    const snippet = buildFileContext(
      selectedFilePath,
      selectedFileContent,
      selectedFileTruncated,
    );
    setInput((prev) => (prev.trim() ? `${prev}\n\n${snippet}` : snippet));
    closeFiles();
  }

  function sendSelectedFileToChat() {
    if (!selectedFilePath) return;
    const snippet = buildFileContext(
      selectedFilePath,
      selectedFileContent,
      selectedFileTruncated,
    );
    closeFiles();
    sendTextMessage(snippet);
  }

  function abortAssistant() {
    const ws = wsRef.current;
    if (!ws || connState !== 'connected') return;
    try {
      ws.send(JSON.stringify({ type: 'abort' }));
    } catch {}
  }

  async function shareText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      await Share.share({ message: trimmed });
    } catch {}
  }

  function showMessageActions(message: ChatMessage) {
    const text = message.text ?? '';
    if (!text.trim()) return;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Share'],
          cancelButtonIndex: 0,
        },
        (index) => {
          if (index === 1) void shareText(text);
        },
      );
      return;
    }

    Alert.alert('Message', 'Share this message?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Share', onPress: () => void shareText(text) },
    ]);
  }

  function openHeaderMenu() {
    if (Platform.OS === 'ios') {
      if (showSidebars) {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ['Cancel', 'New chat', 'Activity', 'Reset Chat', 'Settings'],
            cancelButtonIndex: 0,
            destructiveButtonIndex: 3,
          },
          (index) => {
            if (index === 1) confirmStartThread();
            if (index === 2) openActivity();
            if (index === 3) confirmResetChat();
            if (index === 4) setSettingsOpen(true);
          },
        );
        return;
      }

      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Projects', 'Activity', 'Files', 'New chat', 'Reset Chat', 'Settings'],
          cancelButtonIndex: 0,
          destructiveButtonIndex: 5,
        },
        (index) => {
          if (index === 1) openThreads();
          if (index === 2) openActivity();
          if (index === 3) openFiles();
          if (index === 4) confirmStartThread();
          if (index === 5) confirmResetChat();
          if (index === 6) setSettingsOpen(true);
        },
      );
      return;
    }

    setMenuOpen(true);
  }

  function confirmResetChat() {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Reset chat?',
          message: 'This clears the server-side history for this Client ID.',
          options: ['Cancel', 'Reset Chat'],
          cancelButtonIndex: 0,
          destructiveButtonIndex: 1,
        },
        (index) => {
          if (index === 1) resetChat();
        },
      );
      return;
    }

    Alert.alert('Reset chat?', 'This clears the server-side history for this Client ID.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: resetChat },
    ]);
  }

  function resetChat() {
    const ws = wsRef.current;
    if (!ws || connState !== 'connected') {
      setMessages([]);
      return;
    }
    ws.send(JSON.stringify({ type: 'reset' }));
  }

  async function saveSettings() {
    const url = wsUrl.trim();
    const tok = token.trim();
    const nextClientId = normalizeClientIdInput(clientId) || makeId('client');
    await AsyncStorage.setItem(STORAGE_KEYS.wsUrl, url);
    await AsyncStorage.setItem(STORAGE_KEYS.wsUrlOverride, '1');
    await AsyncStorage.setItem(STORAGE_KEYS.token, tok);
    await AsyncStorage.setItem(STORAGE_KEYS.tokenOverride, '1');
    setClientId(nextClientId);
    await AsyncStorage.setItem(STORAGE_KEYS.clientId, nextClientId);
    setSettingsOpen(false);
    candidateIndexRef.current = 0;
    connect();
  }

  async function useRecommendedDefaults() {
    const envDefault = defaultWsUrl().trim();
    if (!envDefault) {
      setErrorBanner('No default WS URL is configured in this build.');
      return;
    }
    const envToken = (process.env.EXPO_PUBLIC_CODEX_TOKEN ?? '').trim();
    setWsUrl(envDefault);
    if (envToken) setToken(envToken);
    await AsyncStorage.setItem(STORAGE_KEYS.wsUrl, envDefault);
    await AsyncStorage.removeItem(STORAGE_KEYS.wsUrlOverride);
    await AsyncStorage.removeItem(STORAGE_KEYS.tokenOverride);
    if (envToken) await AsyncStorage.removeItem(STORAGE_KEYS.token);
    setSettingsOpen(false);
    candidateIndexRef.current = 0;
  }

  async function checkHealth() {
    const url = healthUrlFromWsUrl(wsUrl);
    if (!url) {
      setHealthCheck({ status: 'error', message: 'WS URL is invalid.' });
      return;
    }

    setHealthCheck({ status: 'checking' });
    const startedAt = Date.now();

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort(), 4500);

    try {
      const res = await fetch(url, controller ? ({ signal: controller.signal } as any) : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json().catch(() => null)) as any;
      if (!json || json.ok !== true) throw new Error('Unexpected response');
      setHealthCheck({ status: 'ok', latencyMs: Date.now() - startedAt });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Health check failed.';
      setHealthCheck({ status: 'error', message });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function checkForUpdates() {
    setUpdateBanner(null);
    try {
      if (!Updates.isEnabled) {
        setUpdateBanner('Updates are disabled in this build.');
        return;
      }
      setUpdateBanner('Checking for updates…');
      const res = await Updates.checkForUpdateAsync();
      if (!res.isAvailable) {
        setUpdateBanner('No update available.');
        return;
      }
      setUpdateBanner('Downloading update…');
      await Updates.fetchUpdateAsync();
      setUpdateBanner('Update downloaded. Reloading…');
      await Updates.reloadAsync();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Update check failed.';
      setUpdateBanner(message);
    }
  }

  function scrollToBottom(animated: boolean) {
    listRef.current?.scrollToEnd({ animated });
  }

  function handleChatScroll(event: any) {
    const native = event?.nativeEvent;
    const y = native?.contentOffset?.y ?? 0;
    const visible = native?.layoutMeasurement?.height ?? 0;
    const total = native?.contentSize?.height ?? 0;
    const paddingToBottom = 120;
    const nearBottom = y + visible >= total - paddingToBottom;

    if (isNearBottomRef.current !== nearBottom) {
      isNearBottomRef.current = nearBottom;
      setShowScrollToBottom(!nearBottom);
    }
  }

  useEffect(() => {
    if (isNearBottomRef.current) scrollToBottom(true);
  }, [messages.length]);

  const currentApproval = approvalQueue.length > 0 ? approvalQueue[0] : null;

  const stopMode =
    connState === 'connected' &&
    Boolean(streamingAssistantIdRef.current) &&
    input.trim().length === 0;

  function ProjectsSidebar({ showClose }: { showClose: boolean }) {
    function toggleProjectCollapse(cwd: string) {
      setProjectCollapsed((prev) => {
        const active = (activeCwd ?? '').trim();
        const stored = prev[cwd];
        const collapsed = stored === undefined ? cwd !== active : Boolean(stored);
        return { ...prev, [cwd]: !collapsed };
      });
    }

    return (
      <View style={styles.sidebarPane}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Projects</Text>
          {showClose ? (
            <Pressable onPress={closeThreads} style={styles.headerButton}>
              <Text style={styles.headerButtonText}>Close</Text>
            </Pressable>
          ) : null}
        </View>

        {connState !== 'connected' ? (
	          <View style={styles.modalBody}>
            <Text style={styles.hint}>
              Not connected. Open Settings, connect to your Mac, then come back to browse Codex
              threads and workspaces.
            </Text>
            <Pressable
              onPress={() => {
                if (showClose) closeThreads();
                setSettingsOpen(true);
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed ? styles.primaryButtonPressed : null,
              ]}
            >
              <Text style={styles.primaryButtonText}>Open Settings</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.activityBody}>
            <View style={styles.threadsActionsRow}>
              <View style={styles.threadsActionsLeft}>
                <Text style={styles.activityBranchText} numberOfLines={1}>
                  {activeCwd ? basenameFromPath(activeCwd) || 'Workspace' : 'Workspace'}
                </Text>
                <Text style={styles.activitySummaryMeta} numberOfLines={1}>
                  {activeCwd ? activeCwd : '—'}
                </Text>
              </View>

              <View style={styles.threadsActionsRight}>
                <Pressable
                  onPress={() => confirmStartThread()}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed ? styles.secondaryButtonPressed : null,
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>New chat</Text>
                </Pressable>
                <Pressable
                  onPress={() => requestThreadsList()}
                  disabled={threadsLoading}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    threadsLoading ? styles.sendButtonDisabled : null,
                    pressed ? styles.secondaryButtonPressed : null,
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>
                    {threadsLoading ? 'Syncing…' : 'Refresh'}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.filesSearchRow}>
              <TextInput
                value={threadsSearch}
                onChangeText={setThreadsSearch}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.modalInput, styles.filesSearchInput]}
                placeholder="Search projects or threads…"
                placeholderTextColor="#6b7280"
              />
              <Pressable
                onPress={() => setThreadsSearch('')}
                disabled={!threadsSearch.trim()}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  !threadsSearch.trim() ? styles.sendButtonDisabled : null,
                  pressed ? styles.secondaryButtonPressed : null,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Clear</Text>
              </Pressable>
            </View>

            {projectSections.length ? (
              <SectionList
                sections={projectSections}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.filesList}
                stickySectionHeadersEnabled={false}
                renderSectionHeader={({ section }) => {
                  const isCollapsed = Boolean((section as any).collapsed);
                  const isActive = section.cwd === (activeCwd ?? '');
                  const canStart = section.cwd !== '(unknown)';
                  const previewThreads: ThreadSummary[] = Array.isArray((section as any).threads)
                    ? ((section as any).threads as ThreadSummary[])
                    : [];
                  const previewLimit = 3;
                  return (
                    <View style={styles.projectHeaderWrap}>
                      <View
                        style={[
                          styles.projectHeaderRow,
                          isActive ? styles.projectHeaderRowActive : null,
                        ]}
                      >
                        <Pressable
                          onPress={() => toggleProjectCollapse(section.cwd)}
                          style={({ pressed }) => [
                            styles.projectHeaderLeftPressable,
                            pressed ? styles.entryRowPressed : null,
                          ]}
                        >
                          <View style={styles.projectHeaderLeft}>
                            <Text style={styles.projectHeaderTitle} numberOfLines={1}>
                              {section.title}
                            </Text>
                            <Text style={styles.projectHeaderMeta} numberOfLines={1}>
                              {section.cwd === '(unknown)'
                                ? 'Unknown folder'
                                : `${section.threadCount} thread${section.threadCount === 1 ? '' : 's'}`}
                            </Text>
                          </View>
                        </Pressable>
                        <View style={styles.projectHeaderRight}>
                          <Pressable
                            onPress={() => doStartThread(section.cwd)}
                            disabled={!canStart}
                            style={({ pressed }) => [
                              styles.projectHeaderNewButton,
                              !canStart ? styles.sendButtonDisabled : null,
                              pressed ? styles.secondaryButtonPressed : null,
                            ]}
                          >
                            <Text style={styles.projectHeaderNewText}>＋</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => toggleProjectCollapse(section.cwd)}
                            hitSlop={10}
                            style={({ pressed }) => [
                              styles.projectHeaderChevronButton,
                              pressed ? styles.entryRowPressed : null,
                            ]}
                          >
                            <Text style={styles.projectHeaderChevron}>
                              {isCollapsed ? '›' : '⌄'}
                            </Text>
                          </Pressable>
                        </View>
                        {isCollapsed && previewThreads.length ? (
                          <View style={styles.projectPreviewList}>
                            {previewThreads.slice(0, previewLimit).map((t) => {
                              const preview = (t.preview ?? '').trim().replace(/\s+/g, ' ');
                              const label = preview || (t.name ?? '').trim() || '(Untitled)';
                              const isThreadActive = t.id === activeThreadId;
                              return (
                                <Pressable
                                  key={`${section.cwd}:${t.id}`}
                                  onPress={() => confirmSelectThread(t)}
                                  style={({ pressed }) => [
                                    styles.projectPreviewPressable,
                                    pressed ? styles.entryRowPressed : null,
                                  ]}
                                >
                                  <View style={styles.projectPreviewRow}>
                                    <Text
                                      style={[
                                        styles.projectPreviewBullet,
                                        isThreadActive ? styles.projectPreviewBulletActive : null,
                                      ]}
                                    >
                                      •
                                    </Text>
                                    <Text
                                      style={[
                                        styles.projectPreviewText,
                                        isThreadActive ? styles.projectPreviewTextActive : null,
                                      ]}
                                      numberOfLines={1}
                                    >
                                      {label}
                                    </Text>
                                  </View>
                                </Pressable>
                              );
                            })}
                            {section.threadCount > previewLimit ? (
                              <Pressable
                                onPress={() => toggleProjectCollapse(section.cwd)}
                                style={({ pressed }) => [
                                  styles.projectPreviewPressable,
                                  pressed ? styles.entryRowPressed : null,
                                ]}
                              >
                                <View style={styles.projectPreviewRow}>
                                  <Text style={styles.projectPreviewBullet}>…</Text>
                                  <Text style={styles.projectPreviewMore} numberOfLines={1}>
                                    {section.threadCount - previewLimit} more
                                  </Text>
                                </View>
                              </Pressable>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                    </View>
                  );
                }}
                renderItem={({ item }) => {
                  const isActive = item.id === activeThreadId;
                  const title = item.name?.trim() || item.preview?.trim() || '(Untitled)';
                  return (
                    <Pressable
                      onPress={() => confirmSelectThread(item)}
                      style={({ pressed }) => [
                        styles.threadRow,
                        isActive ? styles.threadRowActive : null,
                        pressed ? styles.entryRowPressed : null,
                      ]}
                    >
                      <View style={styles.threadRowLeft}>
                        <Text style={styles.threadRowTitle} numberOfLines={1}>
                          {title}
                        </Text>
                        <Text style={styles.threadRowMeta} numberOfLines={1}>
                          {item.id.slice(0, 8)}…
                        </Text>
                      </View>
                      {isActive ? (
                        <View style={styles.threadActivePill}>
                          <Text style={styles.threadActivePillText}>Active</Text>
                        </View>
                      ) : (
                        <Text style={styles.entryChevron}>›</Text>
                      )}
                    </Pressable>
                  );
                }}
              />
            ) : threadsLoading ? (
              <View style={styles.filesLoading}>
                <ActivityIndicator color="#e5e7eb" />
                <Text style={styles.filesHint}>Loading projects…</Text>
              </View>
            ) : (
              <View style={styles.filesLoading}>
                <Text style={styles.filesHint}>No projects yet. Tap Refresh to sync.</Text>
              </View>
            )}
          </View>
        )}
      </View>
    );
  }

  function FilesSidebar({ showClose }: { showClose: boolean }) {
    return (
      <View style={styles.sidebarPane}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>
            {workspaceName ? `Workspace • ${workspaceName}` : 'Workspace'}
          </Text>
          {showClose ? (
            <Pressable onPress={closeFiles} style={styles.headerButton}>
              <Text style={styles.headerButtonText}>Close</Text>
            </Pressable>
          ) : null}
        </View>

        {connState !== 'connected' ? (
          <View style={styles.modalBody}>
            <Text style={styles.hint}>
              Not connected. Open Settings, verify your WS URL and token, then try again.
            </Text>
            <Pressable
              onPress={() => {
                if (showClose) closeFiles();
                setSettingsOpen(true);
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed ? styles.primaryButtonPressed : null,
              ]}
            >
              <Text style={styles.primaryButtonText}>Open Settings</Text>
            </Pressable>
          </View>
        ) : selectedFileLoading || selectedFilePath ? (
          <View style={styles.filesBody}>
            <View style={styles.filesTopRow}>
              <Pressable
                onPress={() => {
                  setSelectedFilePath(null);
                  setSelectedFileContent('');
                  setSelectedFileLoading(false);
                  setSelectedFileTruncated(false);
                }}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>Back</Text>
              </Pressable>
              <Text style={styles.filesPathText} numberOfLines={1}>
                {selectedFilePath ?? ''}
              </Text>
            </View>

            {selectedFileTruncated ? (
              <Text style={styles.filesHint}>
                This file was truncated by the server. Only the first bytes are shown.
              </Text>
            ) : null}

            <View style={styles.filesContentCard}>
              {selectedFileLoading ? (
                <View style={styles.filesLoading}>
                  <ActivityIndicator color="#e5e7eb" />
                  <Text style={styles.filesHint}>Loading file…</Text>
                </View>
              ) : (
                <ScrollView>
                  <Text style={styles.fileText}>{selectedFileContent}</Text>
                </ScrollView>
              )}
            </View>

            <View style={styles.filesActionsRow}>
              <Pressable
                onPress={insertSelectedFileIntoComposer}
                disabled={selectedFileLoading || !selectedFileContent}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  selectedFileLoading || !selectedFileContent ? styles.sendButtonDisabled : null,
                  pressed ? styles.secondaryButtonPressed : null,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Insert</Text>
              </Pressable>
              <Pressable
                onPress={sendSelectedFileToChat}
                disabled={selectedFileLoading || !selectedFileContent}
                style={({ pressed }) => [
                  styles.primaryButtonSmall,
                  selectedFileLoading || !selectedFileContent ? styles.sendButtonDisabled : null,
                  pressed ? styles.primaryButtonPressed : null,
                ]}
              >
                <Text style={styles.primaryButtonText}>Send</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.filesBody}>
            <View style={styles.filesTabsRow}>
              <Pressable
                onPress={() => setFilesTab('browse')}
                style={[styles.filesTab, filesTab === 'browse' ? styles.filesTabActive : null]}
              >
                <Text
                  style={[
                    styles.filesTabText,
                    filesTab === 'browse' ? styles.filesTabTextActive : null,
                  ]}
                >
                  Browse
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setFilesTab('search')}
                style={[styles.filesTab, filesTab === 'search' ? styles.filesTabActive : null]}
              >
                <Text
                  style={[
                    styles.filesTabText,
                    filesTab === 'search' ? styles.filesTabTextActive : null,
                  ]}
                >
                  Search
                </Text>
              </Pressable>
            </View>

            {filesTab === 'browse' ? (
              <>
                <View style={styles.filesTopRow}>
                  <Pressable
                    onPress={() => requestListDir(parentDirPath(browsePath))}
                    disabled={!browsePath}
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      !browsePath ? styles.sendButtonDisabled : null,
                      pressed ? styles.secondaryButtonPressed : null,
                    ]}
                  >
                    <Text style={styles.secondaryButtonText}>Up</Text>
                  </Pressable>
                  <Text style={styles.filesPathText} numberOfLines={1}>
                    {browsePath || '.'}
                  </Text>
                  <Pressable
                    onPress={() => requestListDir(browsePath)}
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      pressed ? styles.secondaryButtonPressed : null,
                    ]}
                  >
                    <Text style={styles.secondaryButtonText}>
                      {browseLoading ? '…' : 'Refresh'}
                    </Text>
                  </Pressable>
                </View>

                {browseLoading ? (
                  <View style={styles.filesLoading}>
                    <ActivityIndicator color="#e5e7eb" />
                    <Text style={styles.filesHint}>Loading…</Text>
                  </View>
                ) : (
                  <FlatList
                    data={browseEntries}
                    keyExtractor={(e) => e.path || `${e.type}:${e.name}`}
                    contentContainerStyle={styles.filesList}
                    renderItem={({ item }) => (
                      <Pressable
                        onPress={() => {
                          if (item.type === 'dir') requestListDir(item.path);
                          else requestReadFile(item.path);
                        }}
                        style={({ pressed }) => [
                          styles.entryRow,
                          pressed ? styles.entryRowPressed : null,
                        ]}
                      >
                        <View style={styles.entryLeft}>
                          <Text style={styles.entryName} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={styles.entryMeta} numberOfLines={1}>
                            {item.type === 'dir'
                              ? 'dir'
                              : item.size
                                ? `${item.size} bytes`
                                : 'file'}
                          </Text>
                        </View>
                        <Text style={styles.entryChevron}>{item.type === 'dir' ? '›' : '↗'}</Text>
                      </Pressable>
                    )}
                  />
                )}
              </>
            ) : (
              <>
                <Text style={styles.label}>Search</Text>
                <View style={styles.filesSearchRow}>
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.modalInput, styles.filesSearchInput]}
                    placeholder="Search in workspace…"
                    placeholderTextColor="#6b7280"
                  />
                  <Pressable
                    onPress={() => requestSearch(searchQuery, browsePath)}
                    disabled={!searchQuery.trim()}
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      !searchQuery.trim() ? styles.sendButtonDisabled : null,
                      pressed ? styles.secondaryButtonPressed : null,
                    ]}
                  >
                    <Text style={styles.secondaryButtonText}>{searchLoading ? '…' : 'Go'}</Text>
                  </Pressable>
                </View>

                {searchTruncated ? (
                  <Text style={styles.filesHint}>
                    Results truncated (limit reached). Refine your query.
                  </Text>
                ) : null}

                {searchLoading ? (
                  <View style={styles.filesLoading}>
                    <ActivityIndicator color="#e5e7eb" />
                    <Text style={styles.filesHint}>Searching…</Text>
                  </View>
                ) : (
                  <FlatList
                    data={searchMatches}
                    keyExtractor={(m) => `${m.path}:${m.line}:${m.column}`}
                    contentContainerStyle={styles.filesList}
                    renderItem={({ item }) => (
                      <Pressable
                        onPress={() => requestReadFile(item.path)}
                        style={({ pressed }) => [
                          styles.entryRow,
                          pressed ? styles.entryRowPressed : null,
                        ]}
                      >
                        <View style={styles.entryLeft}>
                          <Text style={styles.entryName} numberOfLines={1}>
                            {item.path}:{item.line}:{item.column}
                          </Text>
                          <Text style={styles.entryMeta} numberOfLines={2}>
                            {item.text}
                          </Text>
                        </View>
                        <Text style={styles.entryChevron}>↗</Text>
                      </Pressable>
                    )}
                  />
                )}
              </>
            )}
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />

      <View style={styles.shell}>
        {showSidebars ? (
          <View style={styles.sidebarLeft}>
            <ProjectsSidebar showClose={false} />
          </View>
        ) : null}

        <View style={styles.mainPane}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              {!showSidebars ? (
                <Pressable onPress={openThreads} style={styles.headerIconButton} hitSlop={8}>
                  <Text style={styles.headerIconText}>≡</Text>
                </Pressable>
              ) : null}
              <View
                style={[
                  styles.statusDot,
                  connState === 'connected'
                    ? styles.dotOk
                    : connState === 'connecting'
                      ? styles.dotWarn
                      : styles.dotOff,
                ]}
              />
              <View>
                <Text style={styles.title}>Codex</Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  {connState}
                  {serverModel ? ` • ${serverModel}` : ''}
                  {activeCwd ? ` • ${basenameFromPath(activeCwd)}` : ''}
                  {activeBaseUrl || wsUrl
                    ? ` • ${hostLabel((activeBaseUrl || wsUrl).trim())}`
                    : ''}
                </Text>
              </View>
            </View>

            <View style={styles.headerRight}>
              {!showSidebars ? (
                <Pressable onPress={() => openFiles()} style={styles.headerButton} hitSlop={6}>
                  <Text style={styles.headerButtonText}>Files</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={openHeaderMenu} style={styles.headerButton} hitSlop={6}>
                <Text style={styles.headerMenuText}>⋯</Text>
              </Pressable>
            </View>
          </View>

          {errorBanner ? (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>{errorBanner}</Text>
            </View>
          ) : null}
          {updateBanner ? (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>{updateBanner}</Text>
            </View>
          ) : null}

          <FlatList
            ref={listRef}
            contentContainerStyle={styles.listContent}
            data={messages}
            keyExtractor={(m) => m.id}
            keyboardShouldPersistTaps="handled"
            onScroll={handleChatScroll}
            scrollEventThrottle={16}
            onContentSizeChange={() => {
              if (isNearBottomRef.current) scrollToBottom(false);
            }}
            onLayout={() => {
              if (isNearBottomRef.current) scrollToBottom(false);
            }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>Ready</Text>
                <Text style={styles.emptySubtitle}>
                  {connState === 'connected'
                    ? 'Send a message to start.'
                    : 'Open Settings to connect to your Mac.'}
                </Text>
                {connState !== 'connected' ? (
                  <Pressable
                    onPress={() => setSettingsOpen(true)}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      pressed ? styles.primaryButtonPressed : null,
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>Open Settings</Text>
                  </Pressable>
                ) : showSidebars ? (
                  <Text style={styles.emptyHint}>Tip: pick a project on the left.</Text>
                ) : (
                  <Text style={styles.emptyHint}>Tip: open Projects to switch threads.</Text>
                )}
              </View>
            }
            renderItem={({ item }) => {
              const blocks = parseMessageBlocks(item.text).filter(
                (block) => block.type !== 'code',
              );
              const hasRenderableText = blocks.some(
                (block) => block.type === 'text' && block.text.trim().length > 0,
              );

              return (
                <View
                  style={[
                    styles.bubbleRow,
                    item.role === 'user' ? styles.rowUser : styles.rowAssistant,
                  ]}
                >
                  <View
                    style={[
                      styles.bubble,
                      item.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
                    ]}
                  >
                    {hasRenderableText ? (
                      blocks.map((block, idx) =>
                        block.type === 'text' ? (
                          <View
                            key={`${item.id}:text:${idx}`}
                            style={idx > 0 ? styles.messageBlockSpacing : null}
                          >
                            <Markdown
                              style={MARKDOWN_STYLES as any}
                              onLinkPress={(url) => {
                                if (!url) return false;
                                if (!isSafeMarkdownUrl(url)) return false;
                                Linking.openURL(url).catch(() => {});
                                return false;
                              }}
                              {...({
                                allowedImageHandlers: [],
                                defaultImageHandler: null,
                              } as any)}
                            >
                              {block.text}
                            </Markdown>
                          </View>
                        ) : null,
                      )
                    ) : (
                      <Text
                        style={[
                          styles.codeOmittedText,
                          item.role === 'user' ? styles.codeOmittedTextUser : null,
                        ]}
                      >
                        Code omitted. Open Files to view.
                      </Text>
                    )}

                    <View style={styles.messageMetaRow}>
                      <Text
                        style={[
                          styles.messageMetaText,
                          item.role === 'user' ? styles.messageMetaTextUser : null,
                        ]}
                      >
                        {formatMessageTime(item.createdAt)}
                      </Text>
                      <View style={styles.messageMetaRight}>
                        {streamingAssistantIdRef.current === item.id ? (
                          <ActivityIndicator size="small" color="#9ca3af" />
                        ) : null}
                        <Pressable
                          onPress={() => showMessageActions(item)}
                          hitSlop={12}
                          style={({ pressed }) => [
                            styles.messageMetaButton,
                            item.role === 'user' ? styles.messageMetaButtonUser : null,
                            pressed ? styles.messageMetaButtonPressed : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.messageMetaButtonText,
                              item.role === 'user' ? styles.messageMetaButtonTextUser : null,
                            ]}
                          >
                            ⋯
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                </View>
              );
            }}
          />

          {showScrollToBottom ? (
            <View style={styles.scrollToBottomWrap}>
              <Pressable
                onPress={() => scrollToBottom(true)}
                style={({ pressed }) => [
                  styles.scrollToBottomButton,
                  pressed ? styles.scrollToBottomButtonPressed : null,
                ]}
              >
                <Text style={styles.scrollToBottomText}>↓</Text>
              </Pressable>
            </View>
          ) : null}

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
          >
            <View style={styles.composer}>
              <TextInput
                value={input}
                onChangeText={setInput}
                style={styles.input}
                placeholder="Message Codex…"
                placeholderTextColor="#6b7280"
                multiline
              />
              <Pressable
                onPress={stopMode ? abortAssistant : sendUserMessage}
                disabled={connState !== 'connected' || (!stopMode && input.trim().length === 0)}
                style={({ pressed }) => [
                  stopMode ? styles.stopButton : styles.sendButton,
                  connState !== 'connected' || (!stopMode && input.trim().length === 0)
                    ? styles.sendButtonDisabled
                    : pressed
                      ? stopMode
                        ? styles.stopButtonPressed
                        : styles.sendButtonPressed
                      : null,
                ]}
              >
                {connState === 'connecting' ? (
                  <ActivityIndicator color="#0b0f19" />
                ) : stopMode ? (
                  <Text style={styles.stopButtonText}>Stop</Text>
                ) : (
                  <Text style={styles.sendButtonText}>Send</Text>
                )}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>

        {showSidebars ? (
          <View style={styles.sidebarRight}>
            <FilesSidebar showClose={false} />
          </View>
        ) : null}
      </View>

      <Modal
        visible={Boolean(currentApproval)}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          if (currentApproval) sendApprovalDecision(currentApproval.requestId, 'cancel');
        }}
      >
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle} numberOfLines={1}>
              {currentApproval
                ? `${currentApproval.title} • ${currentApproval.kind} (${approvalQueue.length})`
                : 'Approval'}
            </Text>
            <Pressable
              onPress={() => {
                if (currentApproval) sendApprovalDecision(currentApproval.requestId, 'cancel');
              }}
              style={styles.headerButton}
            >
              <Text style={styles.headerButtonText}>Cancel</Text>
            </Pressable>
          </View>

          {currentApproval ? (
            <View style={styles.modalBody}>
              <Text style={styles.hint}>
                Codex is waiting for your approval before continuing this turn.
              </Text>

              <View style={styles.approvalCard}>
                <ScrollView>
                  <Text style={styles.approvalDetail} selectable>
                    {currentApproval.detail}
                  </Text>
                </ScrollView>
              </View>

              <View style={styles.approvalButtonsRow}>
                <Pressable
                  onPress={() => sendApprovalDecision(currentApproval.requestId, 'accept')}
                  style={({ pressed }) => [
                    styles.approvalApproveButton,
                    pressed ? styles.approvalButtonPressed : null,
                  ]}
                >
                  <Text style={styles.approvalApproveText}>Approve</Text>
                </Pressable>
                <Pressable
                  onPress={() => sendApprovalDecision(currentApproval.requestId, 'acceptForSession')}
                  style={({ pressed }) => [
                    styles.approvalSessionButton,
                    pressed ? styles.approvalButtonPressed : null,
                  ]}
                >
                  <Text style={styles.approvalSessionText}>Allow (Session)</Text>
                </Pressable>
              </View>

              <Pressable
                onPress={() => sendApprovalDecision(currentApproval.requestId, 'decline')}
                style={({ pressed }) => [
                  styles.approvalDenyButton,
                  pressed ? styles.approvalButtonPressed : null,
                ]}
              >
                <Text style={styles.approvalDenyText}>Deny</Text>
              </Pressable>
            </View>
          ) : null}
        </SafeAreaView>
      </Modal>

      {!showSidebars ? (
        <Modal visible={threadsOpen} animationType="slide" presentationStyle="pageSheet">
          <SafeAreaView style={styles.modalSafe}>
            <ProjectsSidebar showClose={true} />
          </SafeAreaView>
        </Modal>
      ) : null}

      <Modal visible={activityOpen} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {gitBranch ? `Activity • ${gitBranch}` : 'Activity'}
            </Text>
            <Pressable onPress={closeActivity} style={styles.headerButton}>
              <Text style={styles.headerButtonText}>Close</Text>
            </Pressable>
          </View>

          {connState !== 'connected' ? (
            <View style={styles.modalBody}>
              <Text style={styles.hint}>
                Not connected. Open Settings to connect, then come back here to view git status and
                diffs.
              </Text>
              <Pressable
                onPress={() => {
                  closeActivity();
                  setSettingsOpen(true);
                }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed ? styles.primaryButtonPressed : null,
                ]}
              >
                <Text style={styles.primaryButtonText}>Open Settings</Text>
              </Pressable>
            </View>
          ) : gitDiffPath ? (
            <View style={styles.activityBody}>
              <View style={styles.activityTopRow}>
                <Pressable onPress={closeGitDiff} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Back</Text>
                </Pressable>
                <Text style={styles.activityPathText} numberOfLines={1}>
                  {gitDiffPath}
                </Text>
                <Pressable
                  onPress={() => requestGitDiff(gitDiffPath)}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed ? styles.secondaryButtonPressed : null,
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>Refresh</Text>
                </Pressable>
              </View>

              {gitDiffTruncated ? (
                <Text style={styles.activityHint}>
                  This diff was truncated by the server. Only the first bytes are shown.
                </Text>
              ) : null}

              <View style={styles.activityContentCard}>
                {gitDiffLoading ? (
                  <View style={styles.filesLoading}>
                    <ActivityIndicator color="#e5e7eb" />
                    <Text style={styles.activityHint}>Loading diff…</Text>
                  </View>
                ) : (
                  <ScrollView>
                    <Text style={styles.activityCodeText}>
                      {gitDiffText.trim() ? gitDiffText : '(No diff)'}
                    </Text>
                  </ScrollView>
                )}
              </View>

              <View style={styles.filesActionsRow}>
                <Pressable
                  onPress={insertGitDiffIntoComposer}
                  disabled={gitDiffLoading}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    gitDiffLoading ? styles.sendButtonDisabled : null,
                    pressed ? styles.secondaryButtonPressed : null,
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>Insert</Text>
                </Pressable>
                <Pressable
                  onPress={sendGitDiffToChat}
                  disabled={gitDiffLoading}
                  style={({ pressed }) => [
                    styles.primaryButtonSmall,
                    gitDiffLoading ? styles.sendButtonDisabled : null,
                    pressed ? styles.primaryButtonPressed : null,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>Send</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.activityBody}>
              <View style={styles.activitySummaryRow}>
                <View style={styles.activitySummaryLeft}>
                  <Text style={styles.activityBranchText} numberOfLines={1}>
                    {gitBranch ?? '—'}
                  </Text>
                  <Text style={styles.activitySummaryMeta}>
                    {gitEntries.length ? `${gitEntries.length} changes` : 'Working tree clean'}
                    {gitHiddenCount ? ` • ${gitHiddenCount} hidden` : ''}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    requestGitStatus();
                    requestGitLog(25);
                  }}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed ? styles.secondaryButtonPressed : null,
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>
                    {gitStatusLoading || gitLogLoading ? '…' : 'Refresh'}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.filesTabsRow}>
                <Pressable
                  onPress={() => setActivityTab('status')}
                  style={[
                    styles.filesTab,
                    activityTab === 'status' ? styles.filesTabActive : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.filesTabText,
                      activityTab === 'status' ? styles.filesTabTextActive : null,
                    ]}
                  >
                    Status
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setActivityTab('log')}
                  style={[
                    styles.filesTab,
                    activityTab === 'log' ? styles.filesTabActive : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.filesTabText,
                      activityTab === 'log' ? styles.filesTabTextActive : null,
                    ]}
                  >
                    Log
                  </Text>
                </Pressable>
              </View>

              {activityTab === 'status' ? (
                gitStatusLoading ? (
                  <View style={styles.filesLoading}>
                    <ActivityIndicator color="#e5e7eb" />
                    <Text style={styles.activityHint}>Loading status…</Text>
                  </View>
                ) : gitEntries.length ? (
                  <FlatList
                    data={gitEntries}
                    keyExtractor={(e) => `${e.code}:${e.path}:${e.fromPath ?? ''}`}
                    contentContainerStyle={styles.filesList}
                    renderItem={({ item }) => (
                      <Pressable
                        onPress={() => requestGitDiff(item.path)}
                        style={({ pressed }) => [
                          styles.gitEntryRow,
                          pressed ? styles.entryRowPressed : null,
                        ]}
                      >
                        <View style={styles.gitEntryLeft}>
                          <View style={styles.gitCodePill}>
                            <Text style={styles.gitCodeText}>{item.code}</Text>
                          </View>
                          <View style={styles.gitPathWrap}>
                            <Text style={styles.gitPathText} numberOfLines={1}>
                              {item.path}
                            </Text>
                            {item.fromPath ? (
                              <Text style={styles.gitFromText} numberOfLines={1}>
                                {item.fromPath} → {item.path}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                        <Text style={styles.entryChevron}>›</Text>
                      </Pressable>
                    )}
                  />
                ) : (
                  <View style={styles.modalBody}>
                    <Text style={styles.hint}>No changes.</Text>
                  </View>
                )
              ) : gitLogLoading ? (
                <View style={styles.filesLoading}>
                  <ActivityIndicator color="#e5e7eb" />
                  <Text style={styles.activityHint}>Loading log…</Text>
                </View>
              ) : (
                <FlatList
                  data={gitCommits}
                  keyExtractor={(c) => c.hash}
                  contentContainerStyle={styles.filesList}
                  renderItem={({ item }) => (
                    <View style={styles.commitRow}>
                      <Text style={styles.commitHash}>{item.hash}</Text>
                      <Text style={styles.commitSubject} numberOfLines={2}>
                        {item.subject}
                      </Text>
                    </View>
                  )}
                />
              )}
            </View>
          )}
        </SafeAreaView>
      </Modal>

      {!showSidebars ? (
        <Modal visible={filesOpen} animationType="slide" presentationStyle="pageSheet">
          <SafeAreaView style={styles.modalSafe}>
            <FilesSidebar showClose={true} />
          </SafeAreaView>
        </Modal>
      ) : null}

      <Modal visible={settingsOpen} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Connection Settings</Text>
            <Pressable onPress={() => setSettingsOpen(false)} style={styles.headerButton}>
              <Text style={styles.headerButtonText}>Close</Text>
            </Pressable>
          </View>

          <View style={styles.modalBody}>
            <Text style={styles.label}>WS URL</Text>
            <TextInput
              value={wsUrl}
              onChangeText={setWsUrl}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.modalInput}
              placeholder="wss://your-codex.example"
              placeholderTextColor="#6b7280"
            />

            <Text style={styles.label}>Token</Text>
            <TextInput
              value={token}
              onChangeText={setToken}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.modalInput}
              placeholder="changeme"
              placeholderTextColor="#6b7280"
            />

	            <Text style={styles.label}>Client ID</Text>
	            <View style={styles.filesSearchRow}>
              <TextInput
                value={clientId}
                onChangeText={(next) => setClientId(normalizeClientIdInput(next))}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.modalInput, styles.filesSearchInput]}
                placeholder="client_…"
                placeholderTextColor="#6b7280"
              />
              <Pressable
                onPress={() => setClientId(makeId('client'))}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed ? styles.secondaryButtonPressed : null,
                ]}
              >
                <Text style={styles.secondaryButtonText}>New</Text>
              </Pressable>
	            </View>

	            <Text style={styles.label}>Approvals</Text>
	            <View style={styles.toggleRow}>
	              <View style={styles.toggleTextWrap}>
	                <Text style={styles.toggleTitle}>Auto‑approve commands</Text>
	                <Text style={styles.toggleSubtitle}>
	                  Runs shell commands on your Mac without prompting.
	                </Text>
	              </View>
	              <Switch
	                value={autoApproveCommands}
	                onValueChange={(next) => {
	                  setAutoApproveCommands(next);
	                  AsyncStorage.setItem(
	                    STORAGE_KEYS.autoApproveCommands,
	                    next ? '1' : '0',
	                  ).catch(() => {});
	                }}
	              />
	            </View>

	            <Text style={styles.hint}>
	              Tip: use your Cloudflare URL (wss://your-codex.example) from anywhere, or your Mac’s Tailscale
	              IP (ws://100.x.y.z:8787) when you’re on your tailnet. If your server set
	              CODEX_REMOTE_TOKEN, the token must match. Use the same Client ID on every device to
              sync the “last active” Codex thread + history.
            </Text>

            <View style={styles.diagRow}>
              <Pressable
                onPress={() => useRecommendedDefaults().catch(() => {})}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed ? styles.secondaryButtonPressed : null,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Use Recommended Defaults</Text>
              </Pressable>
              <Text style={styles.diagText} numberOfLines={1}>
                {defaultWsUrl() ? hostLabel(defaultWsUrl().trim()) : ''}
              </Text>
            </View>

            <Text style={styles.label}>Diagnostics</Text>
            <View style={styles.diagRow}>
              <Text style={styles.diagText} selectable>
                {clientId ? `Client: ${clientId}` : 'Client: (none)'}
              </Text>
              <Text style={styles.diagText}>{token.trim() ? 'Token: set' : 'Token: not set'}</Text>
            </View>

            {effectiveUrlPreview ? (
              <View style={styles.diagRow}>
                <Text style={styles.diagText} selectable>
                  {`Effective: ${effectiveUrlPreview}`}
                </Text>
              </View>
            ) : null}

            <View style={styles.diagRow}>
              <Text style={styles.diagText} numberOfLines={1}>
                {lastOpenAt ? `Open: ${lastOpenAt.slice(11, 19)}` : 'Open: —'}
              </Text>
              <Text style={styles.diagText} numberOfLines={1}>
                {lastClose ? `Close: ${lastClose.code ?? 'unknown'}` : 'Close: —'}
              </Text>
            </View>

            <View style={styles.diagRow}>
              <Text style={styles.diagText} numberOfLines={1}>
                {`Retry: ${reconnectAttempt}/6`}
              </Text>
              <Text style={styles.diagText} numberOfLines={1}>
                {lastErrorAt ? `Error: ${lastErrorAt.slice(11, 19)}` : 'Error: —'}
              </Text>
            </View>

            <View style={styles.diagRow}>
              <Text style={styles.diagText} numberOfLines={1}>
                {Updates.channel ? `Channel: ${Updates.channel}` : 'Channel: (none)'}
              </Text>
              <Text style={styles.diagText} numberOfLines={1}>
                {Updates.updateId
                  ? `Update: ${Updates.updateId.slice(0, 8)}…`
                  : Updates.isEmbeddedLaunch
                    ? 'Update: embedded'
                    : 'Update: (none)'}
              </Text>
            </View>

            <View style={styles.diagRow}>
              <Pressable
                onPress={() => checkHealth().catch(() => {})}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed ? styles.secondaryButtonPressed : null,
                ]}
              >
                <Text style={styles.secondaryButtonText}>
                  {healthCheck.status === 'checking' ? 'Checking…' : 'Check /health'}
                </Text>
              </Pressable>
              <Text style={styles.diagText} numberOfLines={1}>
                {healthCheck.status === 'idle'
                  ? ''
                  : healthCheck.status === 'checking'
                    ? '…'
                    : healthCheck.status === 'ok'
                      ? `OK (${healthCheck.latencyMs}ms)`
                      : `Fail: ${healthCheck.message}`}
              </Text>
            </View>

            <View style={styles.diagRow}>
              <Pressable
                onPress={() => checkForUpdates().catch(() => {})}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed ? styles.secondaryButtonPressed : null,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Check & Reload Update</Text>
              </Pressable>
              <Text style={styles.diagText} numberOfLines={1}>
                {Updates.runtimeVersion ? `Runtime: ${Updates.runtimeVersion}` : ''}
              </Text>
            </View>

            <Pressable
              onPress={() => saveSettings().catch(() => {})}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed ? styles.primaryButtonPressed : null,
              ]}
            >
              <Text style={styles.primaryButtonText}>Save & Reconnect</Text>
            </Pressable>

            <Text style={styles.sessionHint} numberOfLines={1}>
              {serverSessionId ? `Session: ${serverSessionId}` : ''}
            </Text>
          </View>
        </SafeAreaView>
      </Modal>

      <Modal visible={menuOpen} transparent animationType="fade">
        <View style={styles.menuOverlay}>
          <Pressable onPress={() => setMenuOpen(false)} style={styles.menuBackdrop} />
          <View style={styles.menuSheet}>
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                confirmStartThread();
              }}
              style={({ pressed }) => [styles.menuItem, pressed ? styles.menuItemPressed : null]}
            >
              <Text style={styles.menuItemText}>New chat</Text>
            </Pressable>
            {!showSidebars ? (
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  openThreads();
                }}
                style={({ pressed }) => [styles.menuItem, pressed ? styles.menuItemPressed : null]}
              >
                <Text style={styles.menuItemText}>Projects</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                openActivity();
              }}
              style={({ pressed }) => [styles.menuItem, pressed ? styles.menuItemPressed : null]}
            >
              <Text style={styles.menuItemText}>Activity</Text>
            </Pressable>
            {!showSidebars ? (
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  openFiles();
                }}
                style={({ pressed }) => [styles.menuItem, pressed ? styles.menuItemPressed : null]}
              >
                <Text style={styles.menuItemText}>Files</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                setSettingsOpen(true);
              }}
              style={({ pressed }) => [styles.menuItem, pressed ? styles.menuItemPressed : null]}
            >
              <Text style={styles.menuItemText}>Settings</Text>
            </Pressable>

            <View style={styles.menuDivider} />

            <Pressable
              onPress={() => {
                setMenuOpen(false);
                confirmResetChat();
              }}
              style={({ pressed }) => [
                styles.menuItem,
                pressed ? styles.menuItemPressed : null,
              ]}
            >
              <Text style={[styles.menuItemText, styles.menuItemTextDestructive]}>Reset Chat</Text>
            </Pressable>
            <Pressable
              onPress={() => setMenuOpen(false)}
              style={({ pressed }) => [styles.menuItem, pressed ? styles.menuItemPressed : null]}
            >
              <Text style={styles.menuItemText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0b0f19',
  },
  shell: {
    flex: 1,
    flexDirection: 'row',
  },
  mainPane: {
    flex: 1,
    minWidth: 0,
  },
  sidebarLeft: {
    width: 320,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#1f2937',
    backgroundColor: '#0b0f19',
  },
  sidebarRight: {
    width: 360,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: '#1f2937',
    backgroundColor: '#0b0f19',
  },
  sidebarPane: {
    flex: 1,
    backgroundColor: '#0b0f19',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1f2937',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    borderRadius: 10,
    backgroundColor: '#0f1524',
  },
  headerIconButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    borderRadius: 10,
    backgroundColor: '#0f1524',
  },
  headerIconText: {
    color: '#e5e7eb',
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 18,
    marginTop: -1,
  },
  headerButtonText: {
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '600',
  },
  headerMenuText: {
    color: '#e5e7eb',
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 18,
    marginTop: -2,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  dotOk: { backgroundColor: '#22c55e' },
  dotWarn: { backgroundColor: '#f59e0b' },
  dotOff: { backgroundColor: '#6b7280' },
  title: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '700',
  },
  subtitle: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 2,
    maxWidth: 220,
  },
  banner: {
    backgroundColor: '#3b1d1d',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#5b2b2b',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bannerText: {
    color: '#fecaca',
    fontSize: 12,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 10,
  },
  emptyState: {
    flex: 1,
    paddingTop: 56,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 10,
  },
  emptyTitle: {
    color: '#f9fafb',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  emptySubtitle: {
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  emptyHint: {
    color: '#6b7280',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
  },
  bubbleRow: {
    flexDirection: 'row',
    width: '100%',
  },
  rowUser: { justifyContent: 'flex-end' },
  rowAssistant: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '86%',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bubbleUser: {
    backgroundColor: '#007AFF',
    borderColor: 'rgba(255,255,255,0.18)',
  },
  bubbleAssistant: {
    backgroundColor: '#0f1524',
    borderColor: '#273244',
  },
  bubbleText: {
    color: '#f9fafb',
    fontSize: 15,
    lineHeight: 20,
  },
  messageBlockSpacing: {
    marginTop: 8,
  },
  codeBlock: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    backgroundColor: '#0b0f19',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  codeBlockUser: {
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  codeLang: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '900',
    marginBottom: 6,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  codeLangUser: {
    color: 'rgba(255,255,255,0.85)',
  },
  codeText: {
    color: '#e5e7eb',
    fontSize: 12,
    lineHeight: 16,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  codeTextUser: {
    color: '#f8fafc',
  },
  codeOmittedText: {
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 18,
  },
  codeOmittedTextUser: {
    color: 'rgba(255,255,255,0.85)',
  },
  toggleRow: {
    marginTop: 8,
    marginBottom: 14,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    backgroundColor: 'rgba(255,255,255,0.03)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  toggleTextWrap: {
    flex: 1,
    paddingRight: 6,
  },
  toggleTitle: {
    color: '#f9fafb',
    fontSize: 14,
    fontWeight: '800',
  },
  toggleSubtitle: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  messageMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 10,
  },
  messageMetaText: {
    color: '#6b7280',
    fontSize: 11,
  },
  messageMetaTextUser: {
    color: 'rgba(255,255,255,0.78)',
  },
  messageMetaRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  messageMetaButton: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  messageMetaButtonUser: {
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  messageMetaButtonPressed: {
    opacity: 0.85,
  },
  messageMetaButtonText: {
    color: '#9ca3af',
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 16,
    marginTop: -2,
  },
  messageMetaButtonTextUser: {
    color: 'rgba(255,255,255,0.9)',
  },
  scrollToBottomWrap: {
    position: 'absolute',
    right: 14,
    bottom: 84,
  },
  scrollToBottomButton: {
    width: 42,
    height: 42,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    backgroundColor: '#0f1524',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  scrollToBottomButtonPressed: {
    opacity: 0.9,
  },
  scrollToBottomText: {
    color: '#e5e7eb',
    fontSize: 18,
    fontWeight: '900',
    marginTop: -1,
  },
  composer: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1f2937',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-end',
    backgroundColor: '#0b0f19',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    backgroundColor: '#0f1524',
    color: '#f9fafb',
    fontSize: 15,
  },
  sendButton: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopButton: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonPressed: {
    opacity: 0.85,
  },
  stopButtonPressed: {
    opacity: 0.9,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#0b0f19',
    fontSize: 14,
    fontWeight: '800',
  },
  stopButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  modalSafe: {
    flex: 1,
    backgroundColor: '#0b0f19',
  },
  modalHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1f2937',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '800',
  },
  modalBody: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10,
  },
  approvalCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    backgroundColor: '#0f1524',
    overflow: 'hidden',
    maxHeight: 380,
  },
  approvalDetail: {
    color: '#e5e7eb',
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  approvalButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  approvalApproveButton: {
    flex: 1,
    backgroundColor: '#22c55e',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approvalApproveText: {
    color: '#052e16',
    fontSize: 14,
    fontWeight: '900',
  },
  approvalSessionButton: {
    flex: 1,
    backgroundColor: '#2563eb',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approvalSessionText: {
    color: '#f9fafb',
    fontSize: 12,
    fontWeight: '900',
  },
  approvalDenyButton: {
    marginTop: 10,
    backgroundColor: '#ef4444',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approvalDenyText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  approvalButtonPressed: {
    opacity: 0.9,
  },
  diagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  diagText: {
    color: '#9ca3af',
    fontSize: 12,
    flex: 1,
  },
  label: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10,
  },
  modalInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    backgroundColor: '#0f1524',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f9fafb',
  },
  hint: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  primaryButton: {
    marginTop: 14,
    backgroundColor: '#2563eb',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonPressed: {
    opacity: 0.9,
  },
  primaryButtonText: {
    color: '#f9fafb',
    fontSize: 14,
    fontWeight: '900',
  },
  secondaryButton: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    borderRadius: 12,
    backgroundColor: '#0f1524',
  },
  secondaryButtonPressed: {
    opacity: 0.9,
  },
  secondaryButtonText: {
    color: '#e5e7eb',
    fontSize: 12,
    fontWeight: '700',
  },
  sessionHint: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 12,
  },
  filesBody: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  filesTabsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
  },
  filesTab: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    backgroundColor: '#0f1524',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  filesTabActive: {
    borderColor: '#2563eb',
  },
  filesTabText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '800',
  },
  filesTabTextActive: {
    color: '#e5e7eb',
  },
  filesTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  filesPathText: {
    color: '#9ca3af',
    fontSize: 12,
    flex: 1,
  },
  filesHint: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 16,
  },
  filesLoading: {
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  filesList: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 8,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    backgroundColor: '#0f1524',
  },
  entryRowPressed: {
    opacity: 0.9,
  },
  entryLeft: {
    flex: 1,
    gap: 4,
  },
  entryName: {
    color: '#f9fafb',
    fontSize: 13,
    fontWeight: '800',
  },
  entryMeta: {
    color: '#9ca3af',
    fontSize: 12,
  },
  entryChevron: {
    color: '#9ca3af',
    fontSize: 18,
    paddingLeft: 6,
  },
  projectHeaderWrap: {
    marginTop: 10,
  },
  projectHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    backgroundColor: '#0b0f19',
  },
  projectHeaderRowActive: {
    borderColor: '#3353a8',
  },
  projectHeaderLeftPressable: {
    flex: 1,
    minWidth: 0,
  },
  projectHeaderLeft: {
    flex: 1,
    gap: 4,
  },
  projectHeaderTitle: {
    color: '#f9fafb',
    fontSize: 13,
    fontWeight: '900',
  },
  projectHeaderMeta: {
    color: '#9ca3af',
    fontSize: 12,
  },
  projectHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  projectHeaderNewButton: {
    width: 34,
    height: 28,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    backgroundColor: '#0f1524',
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectHeaderNewText: {
    color: '#e5e7eb',
    fontSize: 16,
    fontWeight: '900',
    marginTop: -2,
  },
  projectHeaderChevron: {
    color: '#9ca3af',
    fontSize: 16,
    paddingLeft: 4,
  },
  projectHeaderChevronButton: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  projectPreviewList: {
    width: '100%',
    marginTop: 10,
    gap: 6,
  },
  projectPreviewPressable: {
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(15, 21, 36, 0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(39, 50, 68, 0.9)',
  },
  projectPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  projectPreviewBullet: {
    width: 14,
    textAlign: 'center',
    color: '#6b7280',
    fontSize: 14,
    marginTop: -1,
  },
  projectPreviewBulletActive: {
    color: '#22c55e',
  },
  projectPreviewText: {
    flex: 1,
    minWidth: 0,
    color: '#9ca3af',
    fontSize: 12,
  },
  projectPreviewTextActive: {
    color: '#e5e7eb',
    fontWeight: '700',
  },
  projectPreviewMore: {
    flex: 1,
    minWidth: 0,
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '700',
  },
  projectCollapsedHintWrap: {
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  threadsActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 4,
  },
  threadsActionsLeft: {
    flex: 1,
    gap: 4,
  },
  threadsActionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  threadRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  threadRowActive: {
    borderColor: '#3353a8',
  },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingLeft: 18,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    backgroundColor: '#0f1524',
  },
  threadRowLeft: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  threadRowTitle: {
    color: '#f9fafb',
    fontSize: 13,
    fontWeight: '800',
  },
  threadRowMeta: {
    color: '#6b7280',
    fontSize: 12,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  threadActivePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    backgroundColor: '#0b0f19',
    alignItems: 'center',
    justifyContent: 'center',
  },
  threadActivePillText: {
    color: '#22c55e',
    fontSize: 11,
    fontWeight: '900',
  },
  filesContentCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    backgroundColor: '#0f1524',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fileText: {
    color: '#e5e7eb',
    fontSize: 12,
    lineHeight: 16,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  filesActionsRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  primaryButtonSmall: {
    flex: 1,
    backgroundColor: '#2563eb',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filesSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  filesSearchInput: {
    flex: 1,
  },
  activityBody: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  activityTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  activityPathText: {
    color: '#9ca3af',
    fontSize: 12,
    flex: 1,
  },
  activityHint: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 16,
  },
  activityContentCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    backgroundColor: '#0f1524',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  activityCodeText: {
    color: '#e5e7eb',
    fontSize: 12,
    lineHeight: 16,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  activitySummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 4,
  },
  activitySummaryLeft: {
    flex: 1,
    gap: 4,
  },
  activityBranchText: {
    color: '#f9fafb',
    fontSize: 13,
    fontWeight: '900',
  },
  activitySummaryMeta: {
    color: '#9ca3af',
    fontSize: 12,
  },
  gitEntryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    backgroundColor: '#0f1524',
  },
  gitEntryLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  gitCodePill: {
    minWidth: 44,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    backgroundColor: '#0b0f19',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gitCodeText: {
    color: '#e5e7eb',
    fontSize: 12,
    fontWeight: '900',
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  gitPathWrap: {
    flex: 1,
    gap: 4,
  },
  gitPathText: {
    color: '#f9fafb',
    fontSize: 13,
    fontWeight: '800',
  },
  gitFromText: {
    color: '#9ca3af',
    fontSize: 12,
  },
  commitRow: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    backgroundColor: '#0f1524',
  },
  commitHash: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '900',
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  commitSubject: {
    color: '#f9fafb',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 4,
  },
  menuOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  menuSheet: {
    marginHorizontal: 12,
    marginBottom: 14,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#273244',
    backgroundColor: '#0f1524',
    overflow: 'hidden',
  },
  menuItem: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuItemPressed: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  menuItemText: {
    color: '#f9fafb',
    fontSize: 15,
    fontWeight: '800',
  },
  menuItemTextDestructive: {
    color: '#f87171',
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#273244',
  },
});
