import { z } from "zod";

export const TranscriptMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  createdAt: z.string().min(1),
});

export const WorkspaceEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string(),
  type: z.enum(["file", "dir"]),
  size: z.number().int().nonnegative().optional(),
  mtimeMs: z.number().nonnegative().optional(),
});

export const SearchMatchSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  text: z.string(),
});

export const GitStatusEntrySchema = z.object({
  path: z.string().min(1),
  code: z.string().min(1),
  fromPath: z.string().min(1).optional(),
});

export const GitCommitSchema = z.object({
  hash: z.string().min(1),
  subject: z.string().min(1),
});

export const ThreadSummarySchema = z.object({
  id: z.string().min(1),
  preview: z.string(),
  cwd: z.string(),
  createdAt: z.number().int().nullable(),
  updatedAt: z.number().int().nullable(),
  statusType: z.string().nullable(),
  name: z.string().nullable(),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ping"),
  }),
  z.object({
    type: z.literal("abort"),
  }),
  z.object({
    type: z.literal("reset"),
  }),
  z.object({
    type: z.literal("approval_response"),
    requestId: z.string().min(1),
    decision: z.enum(["accept", "acceptForSession", "decline", "cancel"]),
  }),
  z.object({
    type: z.literal("user_message"),
    id: z.string().min(1).optional(),
    createdAt: z.string().min(1).optional(),
    text: z.string().min(1).max(20_000),
  }),
  z.object({
    type: z.literal("git_status"),
    requestId: z.string().min(1),
  }),
  z.object({
    type: z.literal("git_diff"),
    requestId: z.string().min(1),
    path: z.string().min(1),
    maxBytes: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("git_log"),
    requestId: z.string().min(1),
    limit: z.number().int().positive().max(100).optional(),
  }),
  z.object({
    type: z.literal("list_dir"),
    requestId: z.string().min(1),
    path: z.string().optional(),
  }),
  z.object({
    type: z.literal("read_file"),
    requestId: z.string().min(1),
    path: z.string().min(1),
    maxBytes: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("search"),
    requestId: z.string().min(1),
    query: z.string().min(1).max(200),
    path: z.string().optional(),
    limit: z.number().int().positive().max(500).optional(),
  }),
  z.object({
    type: z.literal("threads_list"),
    requestId: z.string().min(1),
    limit: z.number().int().positive().max(200).optional(),
    searchTerm: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal("thread_select"),
    threadId: z.string().min(1),
  }),
  z.object({
    type: z.literal("thread_start"),
    cwd: z.string().min(1).optional(),
  }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerMessage =
  | {
      type: "ready";
      sessionId: string;
      model: string;
      clientId: string;
    }
  | {
      type: "thread_active";
      threadId: string;
      cwd: string;
      model: string;
    }
  | {
      type: "threads";
      requestId: string;
      threads: z.infer<typeof ThreadSummarySchema>[];
      nextCursor?: string;
    }
  | {
      type: "approval_request";
      requestId: string;
      kind: "command" | "fileChange" | "permissions" | "unknown";
      title: string;
      detail: string;
      data?: unknown;
    }
  | {
      type: "workspace_info";
      rootName: string;
      maxFileBytes: number;
    }
  | {
      type: "history";
      messages: z.infer<typeof TranscriptMessageSchema>[];
    }
  | {
      type: "git_status";
      requestId: string;
      branch: string;
      entries: z.infer<typeof GitStatusEntrySchema>[];
      hiddenCount?: number;
    }
  | {
      type: "git_diff";
      requestId: string;
      path: string;
      diff: string;
      truncated?: boolean;
    }
  | {
      type: "git_log";
      requestId: string;
      commits: z.infer<typeof GitCommitSchema>[];
    }
  | {
      type: "dir_list";
      requestId: string;
      path: string;
      entries: z.infer<typeof WorkspaceEntrySchema>[];
    }
  | {
      type: "file_content";
      requestId: string;
      path: string;
      content: string;
      truncated?: boolean;
    }
  | {
      type: "search_results";
      requestId: string;
      query: string;
      matches: z.infer<typeof SearchMatchSchema>[];
      truncated?: boolean;
    }
  | {
      type: "pong";
    }
  | {
      type: "reset_ok";
    }
  | {
      type: "assistant_start";
      messageId: string;
    }
  | {
      type: "assistant_delta";
      messageId: string;
      delta: string;
    }
  | {
      type: "assistant_end";
      messageId: string;
      text: string;
      aborted?: boolean;
    }
  | {
      type: "error";
      requestId?: string;
      code: string;
      message: string;
    };
