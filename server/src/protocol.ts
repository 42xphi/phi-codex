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

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ping"),
  }),
  z.object({
    type: z.literal("reset"),
  }),
  z.object({
    type: z.literal("user_message"),
    id: z.string().min(1).optional(),
    createdAt: z.string().min(1).optional(),
    text: z.string().min(1).max(20_000),
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
      type: "workspace_info";
      rootName: string;
      maxFileBytes: number;
    }
  | {
      type: "history";
      messages: z.infer<typeof TranscriptMessageSchema>[];
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
