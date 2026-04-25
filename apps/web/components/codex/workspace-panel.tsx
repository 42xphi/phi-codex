"use client";

import * as React from "react";
import {
  FileText,
  Folder,
  GitBranch,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { useCodex } from "@/lib/codex";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeViewer } from "@/components/codex/code-viewer";

type WorkspacePanelProps = {
  onRequestClose?: () => void;
};

function parentDirPath(raw: string) {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  if (!value) return "";
  const parts = value.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function WorkspacePanel({ onRequestClose }: WorkspacePanelProps) {
  const {
    connectionState,
    errorBanner,
    workspaceRootName,
    browsePath,
    browseEntries,
    browseLoading,
    listDir,
    selectedFilePath,
    selectedFileContent,
    selectedFileLoading,
    selectedFileTruncated,
    readFile,
    clearSelectedFile,
    searchQuery,
    setSearchQuery,
    searchMatches,
    searchLoading,
    searchTruncated,
    searchWorkspace,
    gitBranch,
    gitHiddenCount,
    gitEntries,
    gitStatusLoading,
    refreshGitStatus,
    gitDiffPath,
    gitDiffText,
    gitDiffLoading,
    gitDiffTruncated,
    gitDiffFile,
    clearGitDiff,
    gitCommits,
    gitLogLoading,
    refreshGitLog,
  } = useCodex();

  React.useEffect(() => {
    if (connectionState !== "connected") return;
    listDir("");
    refreshGitStatus();
  }, [connectionState, listDir, refreshGitStatus]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {workspaceRootName || "Workspace"}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {connectionState === "connected" ? "Connected" : connectionState}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            refreshGitStatus();
            listDir(browsePath);
          }}
          aria-label="Refresh"
        >
          <RefreshCw
            className={cn(
              "h-4 w-4",
              browseLoading || gitStatusLoading ? "animate-spin" : "",
            )}
          />
        </Button>
        {onRequestClose ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onRequestClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      <Separator />

      {errorBanner ? (
        <div className="px-3 py-3">
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {errorBanner}
          </div>
        </div>
      ) : null}

      <div className="flex-1 p-3">
        <Tabs defaultValue="files" className="flex h-full flex-col">
          <TabsList className="w-full">
            <TabsTrigger className="flex-1" value="files">
              Files
            </TabsTrigger>
            <TabsTrigger className="flex-1" value="search">
              Search
            </TabsTrigger>
            <TabsTrigger className="flex-1" value="git">
              Git
            </TabsTrigger>
          </TabsList>

          <TabsContent value="files" className="flex-1">
            {selectedFilePath ? (
              <div className="flex h-full flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={clearSelectedFile}>
                    Back
                  </Button>
                  <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {selectedFilePath}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => selectedFilePath && readFile(selectedFilePath)}
                    disabled={!selectedFilePath}
                  >
                    Refresh
                  </Button>
                </div>
                {selectedFileTruncated ? (
                  <div className="text-xs text-muted-foreground">
                    Truncated by the server (only the first bytes are shown).
                  </div>
                ) : null}
                <div className="flex-1 overflow-hidden rounded-lg border border-border">
                  <ScrollArea className="h-full">
                    <CodeViewer
                      path={selectedFilePath}
                      content={selectedFileContent}
                      loading={selectedFileLoading}
                    />
                  </ScrollArea>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => listDir(parentDirPath(browsePath))}
                    disabled={!browsePath}
                  >
                    Up
                  </Button>
                  <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {browsePath ? `./${browsePath}` : "."}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => listDir(browsePath)}>
                    {browseLoading ? "…" : "Refresh"}
                  </Button>
                </div>

                <div className="flex-1 overflow-hidden rounded-lg border border-border bg-background">
                  <ScrollArea className="h-full">
                    <div className="divide-y divide-border">
                      {browseEntries.map((e) => (
                        <button
                          key={e.path || `${e.type}:${e.name}`}
                          type="button"
                          className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                          onClick={() => {
                            if (e.type === "dir") listDir(e.path);
                            else readFile(e.path);
                          }}
                        >
                          {e.type === "dir" ? (
                            <Folder className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          )}
                          <div className="min-w-0 flex-1 truncate">{e.name}</div>
                          {typeof e.size === "number" && e.type === "file" ? (
                            <div className="text-xs text-muted-foreground">
                              {Math.max(1, Math.round(e.size / 1024))}kb
                            </div>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="search" className="flex-1">
            <div className="flex h-full flex-col gap-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search workspace…"
                    className="pl-9"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        searchWorkspace(searchQuery.trim());
                      }
                    }}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => searchWorkspace(searchQuery.trim())}
                  disabled={!searchQuery.trim()}
                >
                  {searchLoading ? "…" : "Go"}
                </Button>
              </div>

              {searchTruncated ? (
                <div className="text-xs text-muted-foreground">
                  Results truncated. Refine your query.
                </div>
              ) : null}

              <div className="flex-1 overflow-hidden rounded-lg border border-border bg-background">
                <ScrollArea className="h-full">
                  <div className="divide-y divide-border">
                    {searchMatches.length === 0 ? (
                      <div className="p-4 text-sm text-muted-foreground">
                        {searchLoading ? "Searching…" : "No matches yet."}
                      </div>
                    ) : null}
                    {searchMatches.map((m, idx) => (
                      <button
                        key={`${m.path}:${m.line}:${m.column}:${idx}`}
                        type="button"
                        className="w-full px-3 py-2 text-left transition-colors hover:bg-muted"
                        onClick={() => readFile(m.path)}
                      >
                        <div className="truncate text-sm font-medium">
                          {m.path}:{m.line}:{m.column}
                        </div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {m.text}
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="git" className="flex-1">
            <div className="flex h-full flex-col gap-3">
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                  <GitBranch className="h-4 w-4" />
                  <span className="truncate">{gitBranch || "(no repo)"}</span>
                  {gitHiddenCount ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[0.7rem] text-foreground">
                      +{gitHiddenCount}
                    </span>
                  ) : null}
                </div>
                <Button variant="outline" size="sm" onClick={() => refreshGitStatus()}>
                  {gitStatusLoading ? "…" : "Refresh"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => refreshGitLog({ limit: 20 })}>
                  {gitLogLoading ? "…" : "Log"}
                </Button>
              </div>

              {gitDiffPath ? (
                <div className="flex-1 overflow-hidden rounded-lg border border-border bg-background">
                  <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                    <Button variant="outline" size="sm" onClick={clearGitDiff}>
                      Back
                    </Button>
                    <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {gitDiffPath}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => gitDiffPath && gitDiffFile(gitDiffPath)}
                    >
                      Refresh
                    </Button>
                  </div>
                  {gitDiffTruncated ? (
                    <div className="px-3 pt-2 text-xs text-muted-foreground">
                      Diff truncated by the server.
                    </div>
                  ) : null}
                  <ScrollArea className="h-full">
                    <pre className="whitespace-pre-wrap break-words p-4 text-xs leading-5">
                      {gitDiffLoading ? "Loading…" : gitDiffText}
                    </pre>
                  </ScrollArea>
                </div>
              ) : (
                <div className="flex-1 overflow-hidden rounded-lg border border-border bg-background">
                  <ScrollArea className="h-full">
                    <div className="divide-y divide-border">
                      {gitEntries.length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground">
                          {gitStatusLoading ? "Loading…" : "Working tree clean."}
                        </div>
                      ) : null}
                      {gitEntries.map((e) => (
                        <button
                          key={`${e.code}:${e.path}`}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted"
                          type="button"
                          onClick={() => gitDiffFile(e.path)}
                        >
                          <div className="w-10 shrink-0 text-xs font-semibold text-muted-foreground">
                            {e.code}
                          </div>
                          <div className="min-w-0 flex-1 truncate text-sm">{e.path}</div>
                        </button>
                      ))}
                      {gitCommits.length ? (
                        <div className="p-3">
                          <div className="text-xs font-semibold text-muted-foreground">
                            Recent commits
                          </div>
                          <div className="mt-2 space-y-1">
                            {gitCommits.slice(0, 8).map((c) => (
                              <div key={c.hash} className="text-xs text-muted-foreground">
                                <span className="font-mono">{c.hash.slice(0, 7)}</span> · {c.subject}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
