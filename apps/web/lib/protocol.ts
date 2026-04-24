export type TranscriptMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

export type WorkspaceEntry = {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  mtimeMs?: number;
};

export type SearchMatch = {
  path: string;
  line: number;
  column: number;
  text: string;
};

export type GitStatusEntry = {
  path: string;
  code: string;
  fromPath?: string;
};

export type GitCommit = {
  hash: string;
  subject: string;
};

export type ThreadSummary = {
  id: string;
  preview: string;
  cwd: string;
  createdAt: number | null;
  updatedAt: number | null;
  statusType: string | null;
  name: string | null;
};

export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export type ClientMessage =
  | { type: "ping" }
  | { type: "abort" }
  | { type: "reset" }
  | { type: "approval_response"; requestId: string; decision: ApprovalDecision }
  | { type: "user_message"; id?: string; createdAt?: string; text: string }
  | { type: "git_status"; requestId: string }
  | { type: "git_diff"; requestId: string; path: string; maxBytes?: number }
  | { type: "git_log"; requestId: string; limit?: number }
  | { type: "list_dir"; requestId: string; path?: string }
  | { type: "read_file"; requestId: string; path: string; maxBytes?: number }
  | { type: "search"; requestId: string; query: string; path?: string; limit?: number }
  | { type: "threads_list"; requestId: string; limit?: number; searchTerm?: string }
  | { type: "thread_select"; threadId: string }
  | { type: "thread_start"; cwd?: string };

export type ServerMessage =
  | { type: "ready"; sessionId: string; model: string; clientId: string }
  | { type: "thread_active"; threadId: string; cwd: string; model: string }
  | { type: "threads"; requestId: string; threads: ThreadSummary[]; nextCursor?: string }
  | {
      type: "approval_request";
      requestId: string;
      kind: "command" | "fileChange" | "permissions" | "unknown";
      title: string;
      detail: string;
      data?: unknown;
    }
  | { type: "workspace_info"; rootName: string; maxFileBytes: number }
  | { type: "history"; messages: TranscriptMessage[] }
  | {
      type: "git_status";
      requestId: string;
      branch: string;
      entries: GitStatusEntry[];
      hiddenCount?: number;
    }
  | { type: "git_diff"; requestId: string; path: string; diff: string; truncated?: boolean }
  | { type: "git_log"; requestId: string; commits: GitCommit[] }
  | { type: "dir_list"; requestId: string; path: string; entries: WorkspaceEntry[] }
  | { type: "file_content"; requestId: string; path: string; content: string; truncated?: boolean }
  | {
      type: "search_results";
      requestId: string;
      query: string;
      matches: SearchMatch[];
      truncated?: boolean;
    }
  | { type: "pong" }
  | { type: "reset_ok" }
  | { type: "assistant_start"; messageId: string }
  | { type: "assistant_delta"; messageId: string; delta: string }
  | { type: "assistant_end"; messageId: string; text: string; aborted?: boolean }
  | { type: "error"; requestId?: string; code: string; message: string };

