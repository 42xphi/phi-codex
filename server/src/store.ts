import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type TranscriptRole = "user" | "assistant";

export type TranscriptMessage = {
  id: string;
  role: TranscriptRole;
  text: string;
  createdAt: string;
};

export type Conversation = {
  clientId: string;
  createdAt: string;
  updatedAt: string;
  transcript: TranscriptMessage[];
};

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.CODEX_DATA_DIR ?? path.join(moduleDir, "..", "data");
const conversationsDir = path.join(dataDir, "conversations");

const conversations = new Map<string, Conversation>();
let dirReady: Promise<void> | null = null;

function nowIso() {
  return new Date().toISOString();
}

async function ensureDir() {
  if (!dirReady) {
    dirReady = fs.mkdir(conversationsDir, { recursive: true }).then(() => {});
  }
  await dirReady;
}

export function normalizeClientId(raw: string): string {
  const trimmed = raw.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9_-]/g, "");
  return safe.slice(0, 80);
}

function conversationPath(clientId: string) {
  return path.join(conversationsDir, `${clientId}.json`);
}

export async function getOrCreateConversation(
  clientId: string,
): Promise<Conversation> {
  const normalized = normalizeClientId(clientId);
  if (!normalized) {
    throw new Error("clientId is missing/invalid");
  }

  const existing = conversations.get(normalized);
  if (existing) return existing;

  await ensureDir();

  const filePath = conversationPath(normalized);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<Conversation> | null;
    const convo: Conversation = {
      clientId: normalized,
      createdAt:
        typeof parsed?.createdAt === "string" ? parsed.createdAt : nowIso(),
      updatedAt:
        typeof parsed?.updatedAt === "string" ? parsed.updatedAt : nowIso(),
      transcript: Array.isArray(parsed?.transcript)
        ? (parsed?.transcript as TranscriptMessage[]).filter(
            (m) =>
              m &&
              typeof m.id === "string" &&
              (m.role === "user" || m.role === "assistant") &&
              typeof m.text === "string" &&
              typeof m.createdAt === "string",
          )
        : [],
    };
    conversations.set(normalized, convo);
    return convo;
  } catch (err) {
    const code = (err as any)?.code;
    if (code !== "ENOENT") {
      console.warn(`[store] Failed to read conversation ${normalized}:`, err);
    }
  }

  const convo: Conversation = {
    clientId: normalized,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    transcript: [],
  };
  conversations.set(normalized, convo);
  await saveConversation(convo);
  return convo;
}

export async function saveConversation(convo: Conversation): Promise<void> {
  await ensureDir();
  convo.updatedAt = nowIso();
  const filePath = conversationPath(convo.clientId);
  await fs.writeFile(filePath, JSON.stringify(convo, null, 2), "utf-8");
}

