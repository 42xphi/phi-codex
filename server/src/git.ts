import { spawn } from "node:child_process";
import path from "node:path";
import { isBlockedRelPath, resolveWorkspacePath } from "./workspace.js";

export type GitStatusEntry = {
  path: string;
  code: string;
  fromPath?: string;
};

export type GitCommit = {
  hash: string;
  subject: string;
};

const DEFAULT_MAX_STDOUT_BYTES = 120_000;
export const DEFAULT_MAX_DIFF_BYTES = 220_000;

function toPosixPath(rel: string) {
  return rel.replaceAll(path.sep, "/");
}

function runGit(root: string, args: string[], maxStdoutBytes: number) {
  const capped = Math.max(4_000, Math.min(maxStdoutBytes, 800_000));

  return new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
    truncated: boolean;
  }>((resolve) => {
    const child = spawn("git", args, { cwd: root });
    let stdout = "";
    let stderr = "";
    let truncated = false;

    child.stdout.on("data", (d) => {
      if (truncated) return;
      const chunk = d.toString();
      if (stdout.length + chunk.length > capped) {
        stdout += chunk.slice(0, Math.max(0, capped - stdout.length));
        truncated = true;
        try {
          child.kill("SIGKILL");
        } catch {}
        return;
      }
      stdout += chunk;
    });

    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) =>
      resolve({ code: 127, stdout: "", stderr: String(err), truncated: false }),
    );
    child.on("close", (code) => resolve({ code, stdout, stderr, truncated }));
  });
}

function normalizeStatusCode(code: string) {
  // Replace spaces with a visible dot so clients don't trim information away.
  return code.replaceAll(" ", "·");
}

export async function gitStatus(root: string) {
  const { code, stdout, stderr } = await runGit(
    root,
    ["--no-pager", "status", "--porcelain=v1", "-b"],
    DEFAULT_MAX_STDOUT_BYTES,
  );
  if (code === 127) throw new Error("git_missing");
  if (code !== 0) throw new Error(stderr || "git_status_failed");

  const lines = stdout.split(/\r?\n/).filter(Boolean);
  let branch = "";
  const entries: GitStatusEntry[] = [];
  let hiddenCount = 0;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      branch = line.slice(3).trim();
      continue;
    }

    if (line.length < 4) continue;
    const codePart = line.slice(0, 2);
    const rest = line.slice(3).trim();
    if (!rest) continue;

    let fromPath: string | undefined;
    let filePath = rest;
    const renameArrow = rest.indexOf(" -> ");
    if (renameArrow !== -1) {
      fromPath = rest.slice(0, renameArrow).trim();
      filePath = rest.slice(renameArrow + 4).trim();
    }

    filePath = toPosixPath(filePath);
    if (fromPath) fromPath = toPosixPath(fromPath);

    if (isBlockedRelPath(filePath) || (fromPath && isBlockedRelPath(fromPath))) {
      hiddenCount += 1;
      continue;
    }

    entries.push({
      path: filePath,
      code: normalizeStatusCode(codePart),
      fromPath,
    });
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));

  return { branch: branch || "(no branch)", entries, hiddenCount };
}

export async function gitDiffFile(
  root: string,
  relPath: string,
  maxBytes: number | undefined,
) {
  const resolved = resolveWorkspacePath(root, relPath);
  if (!resolved) throw new Error("path_not_allowed");
  const safeRel = toPosixPath(resolved.rel);
  if (isBlockedRelPath(safeRel)) throw new Error("path_not_allowed");

  const byteLimit = maxBytes ?? DEFAULT_MAX_DIFF_BYTES;
  const { code, stdout, stderr, truncated } = await runGit(
    root,
    [
      "--no-pager",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--",
      safeRel,
    ],
    byteLimit,
  );

  if (code === 127) throw new Error("git_missing");
  // git diff: 0 = no diff, 1 = diff exists.
  if (code !== 0 && code !== 1) throw new Error(stderr || "git_diff_failed");

  return { path: safeRel, diff: stdout, truncated };
}

export async function gitLog(root: string, limit: number | undefined) {
  const capped = Math.max(1, Math.min(limit ?? 20, 100));
  const { code, stdout, stderr } = await runGit(
    root,
    ["--no-pager", "log", `-n${capped}`, "--pretty=format:%h\t%s"],
    DEFAULT_MAX_STDOUT_BYTES,
  );
  if (code === 127) throw new Error("git_missing");
  if (code !== 0) throw new Error(stderr || "git_log_failed");

  const commits: GitCommit[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const hash = line.slice(0, tab).trim();
    const subject = line.slice(tab + 1).trim();
    if (!hash || !subject) continue;
    commits.push({ hash, subject });
  }

  return { commits };
}
