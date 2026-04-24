import WebSocket from "ws";

export type CodexTranscriptRole = "user" | "assistant";

export type CodexTranscriptMessage = {
  id: string;
  role: CodexTranscriptRole;
  text: string;
  createdAt: string;
};

export type ApprovalKind = "command" | "fileChange" | "permissions" | "unknown";

export type ApprovalRequest = {
  requestId: string;
  kind: ApprovalKind;
  method: string;
  threadId: string;
  turnId: string;
  itemId: string | null;
  title: string;
  detail: string;
  data?: unknown;
};

export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

type RequestId = string | number;

type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

type JsonRpcResponse = { id: RequestId; result: unknown } | { id: RequestId; error: JsonRpcError };

type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

type JsonRpcRequest = {
  id: RequestId;
  method: string;
  params?: unknown;
};

type JsonRpcMessage = JsonRpcResponse | JsonRpcRequest | JsonRpcNotification;

type UserInput =
  | {
      type: "text";
      text: string;
      text_elements?: unknown[];
    }
  | {
      type: string;
      [key: string]: unknown;
    };

type ThreadItem =
  | {
      type: "userMessage";
      id: string;
      content: UserInput[];
    }
  | {
      type: "agentMessage";
      id: string;
      text: string;
      phase?: string | null;
      memoryCitation?: unknown | null;
    }
  | {
      type: string;
      id: string;
      [key: string]: unknown;
    };

type Turn = {
  id: string;
  startedAt?: number | null;
  completedAt?: number | null;
  status: unknown;
  items: ThreadItem[];
};

type Thread = {
  id: string;
  preview?: string;
  cwd?: string;
  createdAt?: number;
  updatedAt?: number;
  status?: unknown;
  name?: string | null;
  turns: Turn[];
  [key: string]: unknown;
};

export type CodexThreadSummary = {
  id: string;
  preview: string;
  cwd: string;
  createdAt: number | null;
  updatedAt: number | null;
  statusType: string | null;
  name: string | null;
};

type ItemStartedNotificationParams = {
  threadId: string;
  turnId: string;
  item: ThreadItem;
};

type ItemCompletedNotificationParams = {
  threadId: string;
  turnId: string;
  item: ThreadItem;
};

type AgentMessageDeltaNotificationParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
};

type PatchChangeKind =
  | { type: "add" }
  | { type: "delete" }
  | { type: "update"; move_path?: string | null };

type FileUpdateChange = {
  path: string;
  diff: string;
  kind: PatchChangeKind;
};

type FileChangePatchUpdatedNotificationParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  changes: FileUpdateChange[];
};

type CommandExecutionRequestApprovalParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  approvalId?: string | null;
  command?: string | null;
  cwd?: string | null;
  reason?: string | null;
  commandActions?: unknown[] | null;
  proposedExecpolicyAmendment?: string[] | null;
  proposedNetworkPolicyAmendments?: unknown[] | null;
  networkApprovalContext?: unknown | null;
};

type FileChangeRequestApprovalParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string | null;
  grantRoot?: string | null;
};

type PermissionsRequestApprovalParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  cwd: string;
  permissions: unknown;
  reason?: string | null;
};

type PendingOutboundRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type PendingServerRequest = {
  id: RequestId;
  method: string;
  params?: unknown;
};

export type CodexSessionOptions = {
  url: string;
  cwd: string;
  approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never";
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  threadId?: string | null;
  clientName?: string;
  clientVersion?: string;
  onAssistantStart?: (messageId: string) => void;
  onAssistantDelta?: (messageId: string, delta: string) => void;
  onAssistantEnd?: (messageId: string, text: string, aborted: boolean) => void;
  onApprovalRequest?: (request: ApprovalRequest) => void;
  onUnhandledServerRequest?: (request: PendingServerRequest) => void;
  onError?: (error: Error) => void;
};

export type CodexSessionStartResult = {
  threadId: string;
  model: string;
  cwd: string;
  history: CodexTranscriptMessage[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toIsoFromSeconds(seconds: number | null | undefined): string {
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    return new Date(seconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

function textFromUserInput(input: UserInput[]): string {
  const parts: string[] = [];
  for (const item of input) {
    if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
  }
  return parts.join("\n");
}

function transcriptFromThread(thread: Thread): CodexTranscriptMessage[] {
  const out: CodexTranscriptMessage[] = [];
  for (const turn of thread.turns ?? []) {
    const userCreatedAt = toIsoFromSeconds(turn.startedAt ?? thread.createdAt ?? null);
    const assistantCreatedAt = toIsoFromSeconds(
      turn.completedAt ?? turn.startedAt ?? thread.updatedAt ?? null,
    );
    for (const item of turn.items ?? []) {
      if (item.type === "userMessage" && Array.isArray((item as any).content)) {
        const content = (item as any).content as UserInput[];
        out.push({
          id: item.id,
          role: "user",
          text: textFromUserInput(content),
          createdAt: userCreatedAt,
        });
      }
      if (item.type === "agentMessage") {
        const text = typeof (item as any).text === "string" ? ((item as any).text as string) : "";
        out.push({
          id: item.id,
          role: "assistant",
          text,
          createdAt: assistantCreatedAt,
        });
      }
    }
  }
  return out;
}

function sanitizeDetail(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 20_000) return trimmed;
  return `${trimmed.slice(0, 20_000)}\n…(truncated)`;
}

export class CodexSession {
  readonly url: string;
  readonly cwd: string;
  readonly approvalPolicy: CodexSessionOptions["approvalPolicy"];
  readonly sandbox: CodexSessionOptions["sandbox"];
  readonly clientName: string;
  readonly clientVersion: string;

  private ws: WebSocket | null = null;
  private nextId = 1;
  private pendingOutbound = new Map<RequestId, PendingOutboundRequest>();
  private pendingServerRequests = new Map<string, PendingServerRequest>();

  private threadId: string | null;
  private currentTurnId: string | null = null;

  private agentTextByItemId = new Map<string, string>();
  private patchByItemId = new Map<string, FileUpdateChange[]>();

  private onAssistantStart?: CodexSessionOptions["onAssistantStart"];
  private onAssistantDelta?: CodexSessionOptions["onAssistantDelta"];
  private onAssistantEnd?: CodexSessionOptions["onAssistantEnd"];
  private onApprovalRequest?: CodexSessionOptions["onApprovalRequest"];
  private onUnhandledServerRequest?: CodexSessionOptions["onUnhandledServerRequest"];
  private onError?: CodexSessionOptions["onError"];

  constructor(options: CodexSessionOptions) {
    this.url = options.url;
    this.cwd = options.cwd;
    this.approvalPolicy = options.approvalPolicy;
    this.sandbox = options.sandbox;
    this.threadId = options.threadId ?? null;
    this.clientName = options.clientName ?? "codex-remote-chat";
    this.clientVersion = options.clientVersion ?? "0.0.0";
    this.onAssistantStart = options.onAssistantStart;
    this.onAssistantDelta = options.onAssistantDelta;
    this.onAssistantEnd = options.onAssistantEnd;
    this.onApprovalRequest = options.onApprovalRequest;
    this.onUnhandledServerRequest = options.onUnhandledServerRequest;
    this.onError = options.onError;
  }

  getThreadId(): string | null {
    return this.threadId;
  }

  getCurrentTurnId(): string | null {
    return this.currentTurnId;
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.url);

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error("WebSocket missing"));

      const ws = this.ws;
      const onOpen = () => {
        ws.off("error", onErr);
        resolve();
      };
      const onErr = (err: Error) => {
        ws.off("open", onOpen);
        reject(err);
      };

      ws.once("open", onOpen);
      ws.once("error", onErr);
    });

    this.ws.on("message", (data) => {
      try {
        const raw = data.toString();
        const parsed = JSON.parse(raw) as JsonRpcMessage;
        void this.handleIncoming(parsed);
      } catch (err) {
        this.onError?.(
          err instanceof Error ? err : new Error("Failed to parse Codex message"),
        );
      }
    });

    this.ws.on("close", () => {
      this.rejectAllPending(new Error("Codex app-server connection closed"));
    });

    await this.request("initialize", {
      clientInfo: { name: this.clientName, version: this.clientVersion },
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized");
  }

  async startOrResumeThread(): Promise<CodexSessionStartResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Codex session is not connected");
    }

    if (this.threadId) {
      try {
        return await this.resumeThread(this.threadId);
      } catch {
        this.threadId = null;
      }
    }

    return await this.startThread(this.cwd);
  }

  async resetThread(): Promise<CodexSessionStartResult> {
    this.threadId = null;
    this.currentTurnId = null;
    this.agentTextByItemId.clear();
    this.patchByItemId.clear();
    return this.startOrResumeThread();
  }

  async listThreads(options?: {
    cursor?: string | null;
    limit?: number | null;
    searchTerm?: string | null;
    archived?: boolean | null;
    cwd?: string | string[] | null;
  }): Promise<{
    threads: CodexThreadSummary[];
    nextCursor: string | null;
  }> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Codex session is not connected");
    }

    const params: Record<string, unknown> = {};
    if (options?.cursor !== undefined) params.cursor = options.cursor;
    if (options?.limit !== undefined) params.limit = options.limit;
    if (options?.searchTerm !== undefined) params.searchTerm = options.searchTerm;
    if (options?.archived !== undefined) params.archived = options.archived;
    if (options?.cwd !== undefined) params.cwd = options.cwd;

    const result = await this.request("thread/list", params);
    if (!isObject(result)) throw new Error("Codex thread/list returned no result");
    const rawData = result.data;
    const nextCursor = typeof result.nextCursor === "string" ? result.nextCursor : null;

    const threads: CodexThreadSummary[] = [];
    if (Array.isArray(rawData)) {
      for (const item of rawData) {
        if (!isObject(item) || typeof item.id !== "string") continue;
        const preview = typeof item.preview === "string" ? item.preview : "";
        const cwd = typeof item.cwd === "string" ? item.cwd : "";
        const createdAt = typeof item.createdAt === "number" ? item.createdAt : null;
        const updatedAt = typeof item.updatedAt === "number" ? item.updatedAt : null;
        const name = typeof item.name === "string" ? item.name : null;
        const statusType =
          isObject(item.status) && typeof item.status.type === "string"
            ? (item.status.type as string)
            : null;
        threads.push({
          id: item.id,
          preview,
          cwd,
          createdAt,
          updatedAt,
          statusType,
          name,
        });
      }
    }

    return { threads, nextCursor };
  }

  async resumeThread(threadId: string): Promise<CodexSessionStartResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Codex session is not connected");
    }

    this.threadId = threadId;
    this.currentTurnId = null;
    this.agentTextByItemId.clear();
    this.patchByItemId.clear();

    const result = await this.request("thread/resume", {
      threadId,
      approvalPolicy: this.approvalPolicy ?? null,
      approvalsReviewer: "user",
      cwd: null,
      sandbox: this.sandbox ?? null,
    });

    if (!isObject(result)) throw new Error("Codex thread/resume returned no result");
    const thread = result.thread;
    if (!isObject(thread) || typeof thread.id !== "string") {
      throw new Error("Codex thread/resume returned invalid thread");
    }
    this.threadId = thread.id;

    const model = typeof result.model === "string" ? result.model : "codex";
    const cwd = typeof (thread as any).cwd === "string" ? ((thread as any).cwd as string) : this.cwd;
    const parsedThread = thread as unknown as Thread;
    const history = transcriptFromThread(parsedThread);

    return { threadId: thread.id, model, cwd, history };
  }

  async startThread(cwd: string): Promise<CodexSessionStartResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Codex session is not connected");
    }

    this.threadId = null;
    this.currentTurnId = null;
    this.agentTextByItemId.clear();
    this.patchByItemId.clear();

    const result = await this.request("thread/start", {
      cwd,
      approvalPolicy: this.approvalPolicy ?? null,
      approvalsReviewer: "user",
      sandbox: this.sandbox ?? null,
    });

    if (!isObject(result)) throw new Error("Codex thread/start returned no result");
    const thread = result.thread;
    if (!isObject(thread) || typeof thread.id !== "string") {
      throw new Error("Codex thread/start returned invalid thread");
    }
    this.threadId = thread.id;

    const model = typeof result.model === "string" ? result.model : "codex";
    const resolvedCwd = typeof result.cwd === "string" ? result.cwd : cwd;
    const parsedThread = thread as unknown as Thread;
    const history = transcriptFromThread(parsedThread);

    return { threadId: thread.id, model, cwd: resolvedCwd, history };
  }

  async sendUserMessage(text: string): Promise<{ turnId: string }> {
    if (!this.threadId) throw new Error("No active Codex thread");
    const result = await this.request("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text }],
    });
    if (!isObject(result) || !isObject(result.turn) || typeof result.turn.id !== "string") {
      throw new Error("Codex turn/start returned invalid response");
    }
    this.currentTurnId = result.turn.id;
    return { turnId: result.turn.id };
  }

  async interruptTurn(): Promise<void> {
    if (!this.threadId || !this.currentTurnId) return;
    try {
      await this.request("turn/interrupt", {
        threadId: this.threadId,
        turnId: this.currentTurnId,
      });
    } catch (err) {
      this.onError?.(err instanceof Error ? err : new Error("Failed to interrupt turn"));
    } finally {
      this.currentTurnId = null;
    }
  }

  respondToApproval(requestId: string, decision: ApprovalDecision): void {
    const pending = this.pendingServerRequests.get(requestId);
    if (!pending || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const { id, method, params } = pending;
    this.pendingServerRequests.delete(requestId);

    let result: unknown = null;
    if (method === "item/commandExecution/requestApproval") {
      result = {
        decision,
      };
    } else if (method === "item/fileChange/requestApproval") {
      result = {
        decision,
      };
    } else if (method === "item/permissions/requestApproval") {
      const grantedPermissions =
        decision === "accept" || decision === "acceptForSession"
          ? (isObject(params) ? (params as PermissionsRequestApprovalParams).permissions : {})
          : { fileSystem: null, network: null };
      result = {
        permissions: grantedPermissions,
        scope: decision === "acceptForSession" ? "thread" : "turn",
      };
    } else {
      result = { decision };
    }

    this.sendRaw({ id, result });
  }

  close(): void {
    this.rejectAllPending(new Error("Codex session closed"));
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
    }
    this.ws = null;
  }

  private rejectAllPending(error: Error) {
    for (const pending of this.pendingOutbound.values()) {
      pending.reject(error);
    }
    this.pendingOutbound.clear();
  }

  private sendRaw(message: unknown) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Codex session is not connected");
    }
    this.ws.send(JSON.stringify(message));
  }

  private respondError(id: RequestId, code: number, message: string, data?: unknown) {
    const error: JsonRpcError = { code, message };
    if (data !== undefined) error.data = data;
    this.sendRaw({ id, error });
  }

  private notify(method: string, params?: unknown) {
    const payload: JsonRpcNotification = params === undefined ? { method } : { method, params };
    this.sendRaw(payload);
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const payload: JsonRpcRequest = params === undefined ? { id, method } : { id, method, params };
    this.sendRaw(payload);
    return new Promise((resolve, reject) => {
      this.pendingOutbound.set(id, { resolve, reject });
    });
  }

  private async handleIncoming(message: JsonRpcMessage): Promise<void> {
    if (isObject(message) && "id" in message && ("result" in message || "error" in message)) {
      const response = message as JsonRpcResponse;
      const pending = this.pendingOutbound.get(response.id);
      if (!pending) return;
      this.pendingOutbound.delete(response.id);
      if ("error" in response) {
        const err = response.error;
        pending.reject(new Error(`Codex error (${err.code}): ${err.message}`));
      } else {
        pending.resolve(response.result);
      }
      return;
    }

    if (isObject(message) && "id" in message && "method" in message) {
      const request = message as JsonRpcRequest;
      this.handleServerRequest(request);
      return;
    }

    if (isObject(message) && "method" in message) {
      const notification = message as JsonRpcNotification;
      this.handleNotification(notification.method, notification.params);
    }
  }

  private handleServerRequest(request: JsonRpcRequest) {
    const requestId = String(request.id);

    if (
      request.method === "item/commandExecution/requestApproval" ||
      request.method === "item/fileChange/requestApproval" ||
      request.method === "item/permissions/requestApproval"
    ) {
      this.pendingServerRequests.set(requestId, {
        id: request.id,
        method: request.method,
        params: request.params,
      });
      const approval = this.toApprovalRequest(request);
      if (approval) {
        this.onApprovalRequest?.(approval);
        return;
      }

      // Fallback: deny if we couldn't parse the params.
      this.pendingServerRequests.delete(requestId);
      if (request.method === "item/permissions/requestApproval") {
        this.sendRaw({
          id: request.id,
          result: { permissions: { fileSystem: null, network: null }, scope: "turn" },
        });
      } else {
        this.sendRaw({ id: request.id, result: { decision: "decline" } });
      }
      return;
    }

    if (request.method === "item/tool/call") {
      this.onUnhandledServerRequest?.({
        id: request.id,
        method: request.method,
        params: request.params,
      });
      this.sendRaw({
        id: request.id,
        result: {
          success: false,
          contentItems: [
            {
              type: "inputText",
              text: "Dynamic tool calls are not supported by codex-remote-chat yet.",
            },
          ],
        },
      });
      return;
    }

    if (request.method === "item/tool/requestUserInput") {
      this.onUnhandledServerRequest?.({
        id: request.id,
        method: request.method,
        params: request.params,
      });
      this.sendRaw({ id: request.id, result: { answers: {} } });
      return;
    }

    if (request.method === "mcpServer/elicitation/request") {
      this.onUnhandledServerRequest?.({
        id: request.id,
        method: request.method,
        params: request.params,
      });
      this.sendRaw({ id: request.id, result: { action: "decline" } });
      return;
    }

    this.onUnhandledServerRequest?.({
      id: request.id,
      method: request.method,
      params: request.params,
    });
    this.respondError(request.id, -32601, `Unsupported server request: ${request.method}`);
  }

  private toApprovalRequest(request: JsonRpcRequest): ApprovalRequest | null {
    const requestId = String(request.id);
    if (!isObject(request.params)) return null;

    if (request.method === "item/commandExecution/requestApproval") {
      const params = request.params as CommandExecutionRequestApprovalParams;
      const command = typeof params.command === "string" ? params.command : "(command unavailable)";
      const cwd = typeof params.cwd === "string" ? params.cwd : "";
      const reason = typeof params.reason === "string" ? params.reason : "";
      return {
        requestId,
        kind: "command",
        method: request.method,
        threadId: params.threadId,
        turnId: params.turnId,
        itemId: params.itemId,
        title: "Approve command?",
        detail: sanitizeDetail([reason, cwd ? `cwd: ${cwd}` : "", command].filter(Boolean).join("\n")),
        data: {
          command: params.command ?? null,
          cwd: params.cwd ?? null,
          reason: params.reason ?? null,
          commandActions: params.commandActions ?? null,
          proposedExecpolicyAmendment: params.proposedExecpolicyAmendment ?? null,
          proposedNetworkPolicyAmendments: params.proposedNetworkPolicyAmendments ?? null,
          networkApprovalContext: params.networkApprovalContext ?? null,
        },
      };
    }

    if (request.method === "item/fileChange/requestApproval") {
      const params = request.params as FileChangeRequestApprovalParams;
      const changes = this.patchByItemId.get(params.itemId) ?? [];
      const reason = typeof params.reason === "string" ? params.reason : "";
      const diffPreview = changes
        .map((c) => `--- ${c.path}\n${c.diff}`.trim())
        .join("\n\n")
        .trim();
      return {
        requestId,
        kind: "fileChange",
        method: request.method,
        threadId: params.threadId,
        turnId: params.turnId,
        itemId: params.itemId,
        title: "Approve file changes?",
        detail: sanitizeDetail([reason, diffPreview].filter(Boolean).join("\n\n")),
        data: {
          reason: params.reason ?? null,
          grantRoot: params.grantRoot ?? null,
          changes,
        },
      };
    }

    if (request.method === "item/permissions/requestApproval") {
      const params = request.params as PermissionsRequestApprovalParams;
      const reason = typeof params.reason === "string" ? params.reason : "";
      return {
        requestId,
        kind: "permissions",
        method: request.method,
        threadId: params.threadId,
        turnId: params.turnId,
        itemId: params.itemId,
        title: "Grant permissions?",
        detail: sanitizeDetail(
          [reason, `cwd: ${params.cwd}`, JSON.stringify(params.permissions, null, 2)]
            .filter(Boolean)
            .join("\n\n"),
        ),
        data: {
          cwd: params.cwd,
          permissions: params.permissions,
          reason: params.reason ?? null,
        },
      };
    }

    return null;
  }

  private handleNotification(method: string, params: unknown) {
    if (method === "item/started" && isObject(params)) {
      const payload = params as ItemStartedNotificationParams;
      if (payload.item?.type === "agentMessage") {
        this.agentTextByItemId.set(payload.item.id, "");
        this.onAssistantStart?.(payload.item.id);
      }
      return;
    }

    if (method === "item/agentMessage/delta" && isObject(params)) {
      const payload = params as AgentMessageDeltaNotificationParams;
      const existing = this.agentTextByItemId.get(payload.itemId) ?? "";
      const delta = typeof payload.delta === "string" ? payload.delta : "";
      this.agentTextByItemId.set(payload.itemId, existing + delta);
      if (delta) this.onAssistantDelta?.(payload.itemId, delta);
      return;
    }

    if (method === "item/completed" && isObject(params)) {
      const payload = params as ItemCompletedNotificationParams;
      if (payload.item?.type === "agentMessage") {
        const fullText =
          typeof payload.item.text === "string"
            ? payload.item.text
            : this.agentTextByItemId.get(payload.item.id) ?? "";
        this.onAssistantEnd?.(payload.item.id, fullText, false);
        this.agentTextByItemId.delete(payload.item.id);
      }
      return;
    }

    if (method === "item/fileChange/patchUpdated" && isObject(params)) {
      const payload = params as FileChangePatchUpdatedNotificationParams;
      if (Array.isArray(payload.changes)) {
        this.patchByItemId.set(payload.itemId, payload.changes);
      }
      return;
    }

    if (method === "turn/completed") {
      this.currentTurnId = null;
    }
  }
}
