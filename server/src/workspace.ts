import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

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

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(moduleDir, "..", "..");
export const workspaceRoot = path.resolve(
  process.env.CODEX_WORKSPACE_ROOT ?? defaultRoot,
);

export const DEFAULT_MAX_FILE_BYTES = 120_000;

const blockedPathSegments = new Set([
  ".git",
  ".expo",
  ".expo-shared",
  "node_modules",
  "dist",
  "build",
  "web-build",
  ".turbo",
  ".next",
]);

const blockedBasenames = new Set([
  ".env",
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".pnpmrc",
  ".netrc",
]);

const blockedExtensions = new Set([
  ".pem",
  ".key",
  ".p12",
  ".p8",
  ".mobileprovision",
  ".cer",
  ".der",
]);

function toPosixPath(rel: string) {
  return rel.replaceAll(path.sep, "/");
}

export function workspaceRootName() {
  return path.basename(workspaceRoot) || "workspace";
}

export function isBlockedRelPath(relPath: string) {
  const relPosix = toPosixPath(relPath);
  const parts = relPosix.split("/").filter(Boolean);

  for (const part of parts) {
    if (blockedPathSegments.has(part)) return true;
    if (part === ".env" || part.startsWith(".env.")) return true;
  }

  const base = parts.length > 0 ? parts[parts.length - 1] : "";
  if (blockedBasenames.has(base)) return true;

  const ext = path.extname(base);
  if (ext && blockedExtensions.has(ext)) return true;

  return false;
}

export function resolveWorkspacePath(relPath: string) {
  const trimmed = relPath.trim();
  const rel = trimmed === "" ? "." : trimmed;
  if (path.isAbsolute(rel)) return null;
  const abs = path.resolve(workspaceRoot, rel);
  const relative = path.relative(workspaceRoot, abs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  if (isBlockedRelPath(relative)) return null;
  return { abs, rel: relative === "" ? "." : relative };
}

export async function listDir(relPath: string) {
  const resolved = resolveWorkspacePath(relPath);
  if (!resolved) throw new Error("path_not_allowed");

  const dirents = await fs.readdir(resolved.abs, { withFileTypes: true });
  const entries: WorkspaceEntry[] = [];
  for (const d of dirents) {
    const name = d.name;
    if (!name || name === "." || name === "..") continue;
    if (blockedPathSegments.has(name)) continue;
    if (name === ".env" || name.startsWith(".env.")) continue;

    const relChild = toPosixPath(path.join(resolved.rel, name));
    if (isBlockedRelPath(relChild)) continue;

    const type: WorkspaceEntry["type"] = d.isDirectory() ? "dir" : "file";
    const entry: WorkspaceEntry = { name, path: relChild, type };
    try {
      const st = await fs.stat(path.join(resolved.abs, name));
      entry.mtimeMs = st.mtimeMs;
      if (type === "file") entry.size = st.size;
    } catch {}
    entries.push(entry);
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { path: resolved.rel === "." ? "" : toPosixPath(resolved.rel), entries };
}

export async function readTextFile(relPath: string, maxBytes: number) {
  const resolved = resolveWorkspacePath(relPath);
  if (!resolved) throw new Error("path_not_allowed");

  const st = await fs.stat(resolved.abs);
  if (!st.isFile()) throw new Error("not_a_file");

  const byteLimit = Math.max(1024, Math.min(maxBytes, 500_000));
  const truncated = st.size > byteLimit;

  const handle = await fs.open(resolved.abs, "r");
  try {
    const buf = Buffer.alloc(Math.min(byteLimit, st.size));
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const slice = buf.subarray(0, bytesRead);
    if (slice.includes(0)) throw new Error("binary_file");
    return {
      path: toPosixPath(resolved.rel),
      content: slice.toString("utf8"),
      truncated,
    };
  } finally {
    await handle.close();
  }
}

function runRg(args: string[], cwd: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn("rg", args, { cwd });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", (err) => resolve({ code: 127, stdout: "", stderr: String(err) }));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    },
  );
}

export async function searchWorkspace(
  query: string,
  relPath: string | undefined,
  limit: number,
) {
  const searchRoot = resolveWorkspacePath(relPath ?? ".");
  if (!searchRoot) throw new Error("path_not_allowed");

  const capped = Math.max(1, Math.min(limit, 500));
  const args = [
    "--line-number",
    "--column",
    "--no-heading",
    "--color",
    "never",
    "--max-count",
    String(capped),
    query,
    ".",
  ];

  const { code, stdout, stderr } = await runRg(args, searchRoot.abs);
  if (code === 127) throw new Error("rg_missing");
  if (code !== 0 && code !== 1) {
    throw new Error(stderr || "rg_failed");
  }

  const matches: SearchMatch[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const first = line.indexOf(":");
    const second = first === -1 ? -1 : line.indexOf(":", first + 1);
    const third = second === -1 ? -1 : line.indexOf(":", second + 1);
    if (first === -1 || second === -1 || third === -1) continue;

    const file = line.slice(0, first);
    const lineNo = Number(line.slice(first + 1, second));
    const colNo = Number(line.slice(second + 1, third));
    const text = line.slice(third + 1);
    if (!file || !Number.isFinite(lineNo) || !Number.isFinite(colNo)) continue;

    const relFile = toPosixPath(
      path.relative(workspaceRoot, path.resolve(searchRoot.abs, file)),
    );
    if (isBlockedRelPath(relFile)) continue;

    matches.push({
      path: relFile,
      line: Math.max(1, Math.trunc(lineNo)),
      column: Math.max(1, Math.trunc(colNo)),
      text,
    });
    if (matches.length >= capped) break;
  }

  return { matches, truncated: matches.length >= capped };
}

