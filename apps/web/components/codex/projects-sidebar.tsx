"use client";

import * as React from "react";
import {
  ChevronDown,
  Folder,
  Plus,
  RefreshCw,
  Search,
  Settings2,
} from "lucide-react";

import { useCodex } from "@/lib/codex";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

const COLLAPSE_STORAGE_KEY = "codex_remote_projects_collapsed_v2";

function basenameFromPath(rawPath: string) {
  const value = (rawPath ?? "").trim();
  if (!value) return "";
  const trimmed = value.replace(/\/+$/, "");
  const parts = trimmed.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : trimmed;
}

type ProjectsSidebarProps = {
  onOpenSettings: () => void;
  onRequestClose?: () => void;
};

export function ProjectsSidebar({
  onOpenSettings,
  onRequestClose,
}: ProjectsSidebarProps) {
  const {
    connectionState,
    errorBanner,
    threads,
    threadsLoading,
    activeThreadId,
    pendingThreadId,
    activeCwd,
    projectCwd,
    setProjectCwd,
    refreshThreads,
    selectThread,
    startThread,
  } = useCodex();

  const [search, setSearch] = React.useState("");
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>(
    () => {
      if (typeof window === "undefined") return {};
      try {
        const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return {};
        return parsed as Record<string, boolean>;
      } catch {
        return {};
      }
    },
  );

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        COLLAPSE_STORAGE_KEY,
        JSON.stringify(collapsed),
      );
    } catch {}
  }, [collapsed]);

  const groups = React.useMemo(() => {
    const filtered = search.trim()
      ? threads.filter((t) => {
          const s = search.trim().toLowerCase();
          return (
            t.preview.toLowerCase().includes(s) ||
            (t.cwd ?? "").toLowerCase().includes(s) ||
            (t.name ?? "").toLowerCase().includes(s)
          );
        })
      : threads;

    const byCwd = new Map<string, typeof filtered>();
    for (const t of filtered) {
      const cwd = (t.cwd ?? "").trim() || "(unknown)";
      const list = byCwd.get(cwd) ?? [];
      list.push(t);
      byCwd.set(cwd, list);
    }

    const withSort = Array.from(byCwd.entries()).map(([cwd, list]) => {
      const sorted = [...list].sort((a, b) => {
        const aT = a.updatedAt ?? a.createdAt ?? 0;
        const bT = b.updatedAt ?? b.createdAt ?? 0;
        return bT - aT;
      });
      const key = sorted[0]?.updatedAt ?? sorted[0]?.createdAt ?? 0;
      return { cwd, threads: sorted, sortKey: key };
    });

    withSort.sort((a, b) => b.sortKey - a.sortKey);
    return withSort;
  }, [threads, search]);

  const selectedCwd = projectCwd ?? activeCwd;

  function handleProjectClick(cwd: string) {
    setProjectCwd(cwd);
    setCollapsed((prev) => {
      const isSame = selectedCwd === cwd;
      const nextCollapsed = isSame ? !Boolean(prev[cwd]) : false;
      return { ...prev, [cwd]: nextCollapsed };
    });
  }

  const statusLabel =
    connectionState === "connected"
      ? "Connected"
      : connectionState === "connecting"
        ? "Connecting"
        : connectionState === "error"
          ? "Error"
          : "Disconnected";

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={cn(
              "h-2.5 w-2.5 rounded-full",
              connectionState === "connected"
                ? "bg-emerald-500"
                : connectionState === "connecting"
                  ? "bg-amber-400"
                  : connectionState === "error"
                    ? "bg-red-500"
                    : "bg-muted-foreground/40",
            )}
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Codex Remote</div>
            <div className="truncate text-xs text-muted-foreground">
              {statusLabel}
            </div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => startThread()}
            aria-label="New chat"
          >
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSettings}
            aria-label="Settings"
          >
            <Settings2 />
          </Button>
          {onRequestClose ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onRequestClose}
              aria-label="Close"
            >
              <ChevronDown className="rotate-90" />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="px-3 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search threads…"
            className="pl-9"
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshThreads({ searchTerm: search.trim() || undefined })}
          >
            <RefreshCw
              className={cn("h-4 w-4", threadsLoading ? "animate-spin" : "")}
            />
            Refresh
          </Button>
          <div className="text-xs text-muted-foreground">
            {threads.length} threads
          </div>
        </div>
      </div>
      <Separator />

      {errorBanner ? (
        <div className="px-3 py-3">
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {errorBanner}
          </div>
        </div>
      ) : null}

      <ScrollArea className="flex-1">
        <div className="space-y-3 p-3">
          {groups.length === 0 ? (
            <div className="rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground">
              No threads yet. Start a new chat to create one.
            </div>
          ) : null}

          {groups.map((group) => {
            const isCollapsed = Boolean(collapsed[group.cwd]);
            const label = basenameFromPath(group.cwd) || group.cwd || "(unknown)";
            const isSelected = selectedCwd === group.cwd;
            return (
              <div
                key={group.cwd}
                className="w-full overflow-hidden rounded-xl border border-border bg-background shadow-sm"
              >
                <button
                  className={cn(
                    "flex w-full min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isSelected ? "bg-muted" : "",
                  )}
                  onClick={() => handleProjectClick(group.cwd)}
                  type="button"
                >
                  <Folder className="h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {label}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {group.threads.length}
                  </div>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform",
                      isCollapsed ? "-rotate-90" : "rotate-0",
                    )}
                  />
                </button>
                {!isCollapsed ? (
                  <div className="min-w-0 space-y-1 px-2 pb-2">
                    {group.threads.slice(0, 50).map((t) => {
                      const isActive = activeThreadId === t.id;
                      const isPending = pendingThreadId === t.id;
                      const title =
                        t.preview?.trim() || t.name?.trim() || "(empty)";
                      return (
                        <button
                          key={t.id}
                          className={cn(
                            "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                            isActive ? "bg-muted" : "",
                          )}
                          onClick={() => {
                            selectThread(t.id);
                            onRequestClose?.();
                          }}
                          disabled={Boolean(pendingThreadId)}
                          type="button"
                        >
                          <div
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              isPending
                                ? "bg-amber-400"
                                : isActive
                                  ? "bg-primary"
                                  : "bg-muted-foreground/30",
                            )}
                          />
                          <div className="min-w-0 flex-1 truncate">{title}</div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
