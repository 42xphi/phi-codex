import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  NativeModules,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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

type ServerMessage =
  | { type: 'ready'; sessionId: string; model: string; clientId: string }
  | { type: 'workspace_info'; rootName: string; maxFileBytes: number }
  | { type: 'history'; messages: ChatMessage[] }
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
  clientId: 'codex_remote_client_id',
  messages: 'codex_remote_messages_v1',
} as const;

const MAX_FILE_CONTEXT_CHARS = 16_000;

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

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [connState, setConnState] = useState<ConnectionState>('disconnected');
  const [serverModel, setServerModel] = useState<string | null>(null);
  const [serverSessionId, setServerSessionId] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [clientId, setClientId] = useState('');
  const [healthCheck, setHealthCheck] = useState<HealthCheckState>({ status: 'idle' });
  const [updateBanner, setUpdateBanner] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [lastOpenAt, setLastOpenAt] = useState<string | null>(null);
  const [lastErrorAt, setLastErrorAt] = useState<string | null>(null);
  const [lastClose, setLastClose] = useState<WsCloseInfo | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(() => defaultWsUrl().length === 0);
  const [wsUrl, setWsUrl] = useState(defaultWsUrl);
  const [token, setToken] = useState(process.env.EXPO_PUBLIC_CODEX_TOKEN ?? '');
  const [activeBaseUrl, setActiveBaseUrl] = useState('');

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
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shouldReconnectRef = useRef(true);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const candidateIndexRef = useRef(0);
  const browseRequestIdRef = useRef<string | null>(null);
  const fileRequestIdRef = useRef<string | null>(null);
  const searchRequestIdRef = useRef<string | null>(null);

  const candidateBaseUrls = useMemo(() => {
    const envList = parseWsUrlList(process.env.EXPO_PUBLIC_WS_URLS);
    const envUrl = process.env.EXPO_PUBLIC_WS_URL?.trim();
    return uniqStrings([wsUrl.trim(), ...(envUrl ? [envUrl] : []), ...envList]);
  }, [wsUrl]);

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
      try {
        wsRef.current?.close();
      } catch {}
      wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    (async () => {
      const storedUrl = await AsyncStorage.getItem(STORAGE_KEYS.wsUrl);
      const storedUrlOverride = await AsyncStorage.getItem(STORAGE_KEYS.wsUrlOverride);
      const storedToken = await AsyncStorage.getItem(STORAGE_KEYS.token);
      const storedClientId = await AsyncStorage.getItem(STORAGE_KEYS.clientId);
      const storedMessages = await AsyncStorage.getItem(STORAGE_KEYS.messages);
      const urlOverrideEnabled = storedUrlOverride === '1';
      const envDefault = defaultWsUrl();

      if (urlOverrideEnabled) {
        if (storedUrl) setWsUrl(storedUrl);
      } else {
        if (envDefault) setWsUrl(envDefault);
        else if (storedUrl) setWsUrl(storedUrl);
      }
      if (storedToken) setToken(storedToken);
      if (storedClientId) {
        setClientId(storedClientId);
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

      if ((!storedUrl || !urlOverrideEnabled) && defaultWsUrl().length === 0) {
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
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEYS.messages, JSON.stringify(messages)).catch(() => {});
    }, 600);
  }, [messages]);

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
      setErrorBanner('Set a valid WebSocket URL (ws://...) in Settings.');
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

      if (msg.type === 'workspace_info') {
        setWorkspaceName(msg.rootName);
        setWorkspaceMaxFileBytes(msg.maxFileBytes);
        return;
      }

      if (msg.type === 'history') {
        if (Array.isArray(msg.messages)) setMessages(msg.messages);
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
          { id: msg.messageId, role: 'assistant', text: '' },
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

  function openFiles() {
    setFilesTab('browse');
    setFilesOpen(true);
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
    await AsyncStorage.setItem(STORAGE_KEYS.wsUrl, url);
    await AsyncStorage.setItem(STORAGE_KEYS.wsUrlOverride, '1');
    await AsyncStorage.setItem(STORAGE_KEYS.token, tok);
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
    setWsUrl(envDefault);
    await AsyncStorage.setItem(STORAGE_KEYS.wsUrl, envDefault);
    await AsyncStorage.removeItem(STORAGE_KEYS.wsUrlOverride);
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

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View style={styles.headerLeft}>
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
              {activeBaseUrl || wsUrl ? ` • ${hostLabel((activeBaseUrl || wsUrl).trim())}` : ''}
            </Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <Pressable onPress={openFiles} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>Files</Text>
          </Pressable>
          <Pressable onPress={resetChat} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>Reset</Text>
          </Pressable>
          <Pressable onPress={() => setSettingsOpen(true)} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>Settings</Text>
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
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => (
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
              <Text style={styles.bubbleText}>{item.text}</Text>
            </View>
          </View>
        )}
      />

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
            onPress={sendUserMessage}
            disabled={connState !== 'connected' || input.trim().length === 0}
            style={({ pressed }) => [
              styles.sendButton,
              connState !== 'connected' || input.trim().length === 0
                ? styles.sendButtonDisabled
                : pressed
                  ? styles.sendButtonPressed
                  : null,
            ]}
          >
            {connState === 'connecting' ? (
              <ActivityIndicator color="#0b0f19" />
            ) : (
              <Text style={styles.sendButtonText}>Send</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={filesOpen} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {workspaceName ? `Workspace • ${workspaceName}` : 'Workspace'}
            </Text>
            <Pressable onPress={closeFiles} style={styles.headerButton}>
              <Text style={styles.headerButtonText}>Close</Text>
            </Pressable>
          </View>

          {connState !== 'connected' ? (
            <View style={styles.modalBody}>
              <Text style={styles.hint}>
                Not connected. Open Settings, verify your WS URL and token, then try again.
              </Text>
              <Pressable
                onPress={() => {
                  closeFiles();
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
                  style={[
                    styles.filesTab,
                    filesTab === 'browse' ? styles.filesTabActive : null,
                  ]}
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
                  style={[
                    styles.filesTab,
                    filesTab === 'search' ? styles.filesTabActive : null,
                  ]}
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
                      {browsePath ? `/${browsePath}` : '/'}
                    </Text>
                    <Pressable
                      onPress={() => requestListDir(browsePath)}
                      style={({ pressed }) => [
                        styles.secondaryButton,
                        pressed ? styles.secondaryButtonPressed : null,
                      ]}
                    >
                      <Text style={styles.secondaryButtonText}>Refresh</Text>
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
                      <Text style={styles.secondaryButtonText}>
                        {searchLoading ? '…' : 'Go'}
                      </Text>
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
        </SafeAreaView>
      </Modal>

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
              placeholder="ws://100.x.y.z:8787"
              placeholderTextColor="#6b7280"
            />

            <Text style={styles.label}>Token (optional)</Text>
            <TextInput
              value={token}
              onChangeText={setToken}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.modalInput}
              placeholder="changeme"
              placeholderTextColor="#6b7280"
            />

            <Text style={styles.hint}>
              Tip: use your Mac’s Tailscale IP (100.x.y.z). If your server set
              CODEX_REMOTE_TOKEN, the token must match.
            </Text>

            <View style={styles.diagRow}>
              <Pressable
                onPress={() => useRecommendedDefaults().catch(() => {})}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed ? styles.secondaryButtonPressed : null,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Use Recommended URL</Text>
              </Pressable>
              <Text style={styles.diagText} numberOfLines={1}>
                {defaultWsUrl() ? hostLabel(defaultWsUrl().trim()) : ''}
              </Text>
            </View>

            <Text style={styles.label}>Diagnostics</Text>
            <View style={styles.diagRow}>
              <Text style={styles.diagText} numberOfLines={1}>
                {clientId ? `Client: ${clientId}` : 'Client: (none)'}
              </Text>
              <Text style={styles.diagText}>{token.trim() ? 'Token: set' : 'Token: not set'}</Text>
            </View>

            {effectiveUrlPreview ? (
              <View style={styles.diagRow}>
                <Text style={styles.diagText} numberOfLines={1}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
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
  headerButtonText: {
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '600',
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
    backgroundColor: '#2563eb',
    borderColor: '#1d4ed8',
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
  sendButtonPressed: {
    opacity: 0.85,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#0b0f19',
    fontSize: 14,
    fontWeight: '800',
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
});
