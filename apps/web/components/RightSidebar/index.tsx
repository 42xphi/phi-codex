import { useMemo, useState } from "react";
import { twMerge } from "tailwind-merge";
import Icon from "@/components/Icon";
import { useCodex } from "@/lib/codex";

type RightSidebarProps = {
    className?: string;
    visible?: boolean;
};

type TabId = "files" | "search" | "git";

function parentDirPath(raw: string) {
    const value = (raw ?? "").trim().replace(/\/+$/, "");
    if (!value) return "";
    const parts = value.split("/").filter(Boolean);
    parts.pop();
    return parts.join("/");
}

const RightSidebar = ({ className, visible }: RightSidebarProps) => {
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

    const [tab, setTab] = useState<TabId>("files");

    const tabs = useMemo(
        () =>
            [
                { id: "files" as const, label: "Files" },
                { id: "search" as const, label: "Search" },
                { id: "git" as const, label: "Git" },
            ] satisfies { id: TabId; label: string }[],
        []
    );

        return (
            <div
                className={twMerge(
                `absolute top-0 right-0 bottom-0 flex flex-col w-[22.5rem] bg-ios-surface rounded-r-[1.25rem] border-l border-ios-separator/60 2xl:w-80 lg:rounded-[1.25rem] lg:invisible lg:opacity-0 lg:transition-opacity lg:z-20 lg:border-l-0 lg:shadow-2xl md:fixed md:w-[calc(100%-4rem)] md:rounded-none ${
                    visible && "lg:visible lg:opacity-100"
                } ${className}`,
                )}
            >
            <div
                className="flex items-center h-16 px-6 border-b border-ios-separator/60 lg:pr-18 md:px-4"
                style={{ paddingTop: "env(safe-area-inset-top)" }}
            >
                <div className="min-w-0">
                    <div className="text-[0.9rem] font-semibold text-ios-label truncate">
                        {workspaceRootName || "Workspace"}
                    </div>
                    <div className="mt-0.5 text-[0.75rem] leading-4 text-ios-secondary/60 truncate">
                        {connectionState === "connected"
                            ? "Connected"
                            : connectionState}
                    </div>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <button
                        className="inline-flex h-9 items-center justify-center rounded-xl border border-ios-separator/60 bg-ios-surface2 px-3 text-[0.85rem] font-semibold text-ios-label transition-colors hover:bg-ios-surface"
                        type="button"
                        onClick={() => {
                            if (tab === "git") refreshGitStatus();
                            if (tab === "files") listDir(browsePath);
                        }}
                    >
                        Refresh
                    </button>
                </div>
            </div>

            <div className="px-6 md:px-4 py-4 border-b border-ios-separator/60">
                <div className="flex rounded-xl border border-ios-separator/60 bg-ios-surface2 p-1">
                    {tabs.map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            className={twMerge(
                                "flex-1 h-9 rounded-lg text-[0.85rem] font-semibold transition-colors",
                                tab === t.id
                                    ? "bg-ios-surface text-ios-label shadow-[0_0.5rem_1.5rem_-1rem_rgba(0,0,0,0.25)]"
                                    : "text-ios-secondary/70 hover:text-ios-label",
                            )}
                            onClick={() => setTab(t.id)}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            {errorBanner ? (
                <div className="px-6 md:px-4 pt-4">
                    <div className="p-3 rounded-xl border border-ios-red/30 bg-ios-red/10 text-ios-red break-words">
                        {errorBanner}
                    </div>
                </div>
            ) : null}

            <div className="grow overflow-y-auto scroll-smooth px-6 md:px-4 py-6 space-y-6">
                {tab === "files" ? (
                    selectedFileLoading || selectedFilePath ? (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2">
                                <button
                                    className="inline-flex h-9 items-center justify-center rounded-xl border border-ios-separator/60 bg-ios-surface2 px-3 text-[0.85rem] font-semibold text-ios-label transition-colors hover:bg-ios-surface"
                                    type="button"
                                    onClick={clearSelectedFile}
                                >
                                    Back
                                </button>
                                <div className="min-w-0 text-[0.75rem] leading-4 text-ios-secondary/60 truncate">
                                    {selectedFilePath ?? ""}
                                </div>
                                <button
                                    className="inline-flex h-9 items-center justify-center rounded-xl border border-ios-separator/60 bg-ios-surface2 px-3 text-[0.85rem] font-semibold text-ios-label transition-colors hover:bg-ios-surface ml-auto"
                                    type="button"
                                    onClick={() => {
                                        if (selectedFilePath)
                                            readFile(selectedFilePath);
                                    }}
                                    disabled={!selectedFilePath}
                                >
                                    Refresh
                                </button>
                            </div>

                            {selectedFileTruncated ? (
                                <div className="text-[0.8rem] leading-5 text-ios-secondary/60">
                                    Truncated by the server (only the first
                                    bytes are shown).
                                </div>
                            ) : null}

                            <div className="rounded-xl border border-ios-separator/60 overflow-hidden">
                                <div className="max-h-[50vh] overflow-auto bg-ios-surface2">
                                    <pre className="p-4 text-[0.75rem] leading-5 whitespace-pre-wrap break-words text-ios-label">
                                        {selectedFileLoading
                                            ? "Loading…"
                                            : selectedFileContent}
                                    </pre>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2">
                                <button
                                    className="inline-flex h-9 items-center justify-center rounded-xl border border-ios-separator/60 bg-ios-surface2 px-3 text-[0.85rem] font-semibold text-ios-label transition-colors hover:bg-ios-surface"
                                    type="button"
                                    onClick={() => listDir(parentDirPath(browsePath))}
                                    disabled={!browsePath}
                                >
                                    Up
                                </button>
                                <div className="min-w-0 text-[0.75rem] leading-4 text-ios-secondary/60 truncate">
                                    {browsePath ? `./${browsePath}` : "."}
                                </div>
                                <button
                                    className="inline-flex h-9 items-center justify-center rounded-xl border border-ios-separator/60 bg-ios-surface2 px-3 text-[0.85rem] font-semibold text-ios-label transition-colors hover:bg-ios-surface ml-auto"
                                    type="button"
                                    onClick={() => listDir(browsePath)}
                                >
                                    {browseLoading ? "…" : "Refresh"}
                                </button>
                            </div>

                            <div className="rounded-xl border border-ios-separator/60 overflow-hidden">
                                <div className="divide-y divide-ios-separator/60">
                                    {browseEntries.map((e) => (
                                        <button
                                            key={e.path || `${e.type}:${e.name}`}
                                            type="button"
                                            className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ios-surface2"
                                            onClick={() => {
                                                if (e.type === "dir")
                                                    listDir(e.path);
                                                else readFile(e.path);
                                            }}
                                        >
                                            <Icon
                                                className="fill-current text-ios-secondary/70"
                                                name={e.type === "dir" ? "folder" : "file"}
                                            />
                                            <div className="min-w-0">
                                                <div className="text-[0.9rem] font-semibold text-ios-label truncate">
                                                    {e.name}
                                                </div>
                                                <div className="text-[0.75rem] leading-4 text-ios-secondary/60 truncate">
                                                    {e.type === "dir"
                                                        ? "folder"
                                                        : e.path}
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                    {browseEntries.length === 0 && !browseLoading ? (
                                        <div className="px-4 py-4 text-[0.8rem] leading-5 text-ios-secondary/60">
                                            No files here.
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    )
                ) : null}

                {tab === "search" ? (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <input
                                className="w-full h-10 px-4 rounded-xl border border-ios-separator/60 bg-ios-surface2 text-[0.9rem] text-ios-label outline-none transition-shadow placeholder:text-ios-secondary/60 focus:shadow-[0_0_0_0.125rem_rgba(0,122,255,0.35)]"
                                placeholder="Search workspace…"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        searchWorkspace(searchQuery);
                                    }
                                }}
                            />
                            <button
                                className="inline-flex h-10 items-center justify-center rounded-xl bg-ios-blue px-4 text-[0.9rem] font-semibold text-white shadow-[0_0.5rem_1.5rem_-1rem_rgba(0,0,0,0.35)] transition-opacity hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none"
                                type="button"
                                onClick={() => searchWorkspace(searchQuery)}
                                disabled={!searchQuery.trim()}
                            >
                                {searchLoading ? "…" : "Go"}
                            </button>
                        </div>

                        <div className="rounded-xl border border-ios-separator/60 overflow-hidden">
                            <div className="divide-y divide-ios-separator/60">
                                {searchMatches.map((m, idx) => (
                                    <button
                                        key={`${m.path}:${m.line}:${m.column}:${idx}`}
                                        type="button"
                                        className="w-full px-4 py-3 text-left transition-colors hover:bg-ios-surface2"
                                        onClick={() => {
                                            readFile(m.path);
                                            setTab("files");
                                        }}
                                    >
                                        <div className="text-[0.9rem] font-semibold text-ios-label truncate">
                                            {m.path}:{m.line}:{m.column}
                                        </div>
                                        <div className="mt-0.5 text-[0.75rem] leading-5 text-ios-secondary/60 whitespace-pre-wrap break-words">
                                            {m.text}
                                        </div>
                                    </button>
                                ))}
                                {searchTruncated ? (
                                    <div className="px-4 py-3 text-[0.75rem] leading-5 text-ios-secondary/60">
                                        Results truncated.
                                    </div>
                                ) : null}
                                {searchMatches.length === 0 && !searchLoading ? (
                                    <div className="px-4 py-4 text-[0.8rem] leading-5 text-ios-secondary/60">
                                        No matches.
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                ) : null}

                {tab === "git" ? (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="text-[0.85rem] font-semibold text-ios-secondary/70">
                                Branch
                            </div>
                            <div className="min-w-0 text-[0.9rem] font-semibold text-ios-label truncate">
                                {gitBranch || "—"}
                            </div>
                            <button
                                className="inline-flex h-9 items-center justify-center rounded-xl border border-ios-separator/60 bg-ios-surface2 px-3 text-[0.85rem] font-semibold text-ios-label transition-colors hover:bg-ios-surface ml-auto"
                                type="button"
                                onClick={refreshGitStatus}
                            >
                                {gitStatusLoading ? "…" : "Refresh"}
                            </button>
                        </div>

                        <div className="rounded-xl border border-ios-separator/60 overflow-hidden">
                            <div className="divide-y divide-ios-separator/60">
                                {gitEntries.map((e) => (
                                    <button
                                        key={`${e.code}:${e.path}`}
                                        type="button"
                                        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ios-surface2"
                                        onClick={() => {
                                            clearGitDiff();
                                            gitDiffFile(e.path);
                                        }}
                                    >
                                        <div className="shrink-0 px-2 py-1 rounded-lg bg-ios-surface2 text-[0.75rem] font-semibold text-ios-secondary/70">
                                            {e.code}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="text-[0.9rem] font-semibold text-ios-label truncate">
                                                {e.path}
                                            </div>
                                            {e.fromPath ? (
                                                <div className="text-[0.75rem] leading-4 text-ios-secondary/60 truncate">
                                                    from {e.fromPath}
                                                </div>
                                            ) : null}
                                        </div>
                                    </button>
                                ))}
                                {gitHiddenCount > 0 ? (
                                    <div className="px-4 py-3 text-[0.75rem] leading-5 text-ios-secondary/60">
                                        {gitHiddenCount} entries hidden.
                                    </div>
                                ) : null}
                                {gitEntries.length === 0 && !gitStatusLoading ? (
                                    <div className="px-4 py-4 text-[0.8rem] leading-5 text-ios-secondary/60">
                                        Working tree clean.
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="text-[0.85rem] font-semibold text-ios-secondary/70">
                                Recent commits
                            </div>
                            <button
                                className="inline-flex h-9 items-center justify-center rounded-xl border border-ios-separator/60 bg-ios-surface2 px-3 text-[0.85rem] font-semibold text-ios-label transition-colors hover:bg-ios-surface ml-auto"
                                type="button"
                                onClick={() => refreshGitLog({ limit: 20 })}
                            >
                                {gitLogLoading ? "…" : "Load"}
                            </button>
                        </div>

                        {gitCommits.length > 0 ? (
                            <div className="rounded-xl border border-ios-separator/60 overflow-hidden">
                                <div className="divide-y divide-ios-separator/60">
                                    {gitCommits.map((c) => (
                                        <div
                                            key={c.hash}
                                            className="px-4 py-3"
                                        >
                                            <div className="text-[0.75rem] leading-4 text-ios-secondary/60">
                                                {c.hash}
                                            </div>
                                            <div className="mt-0.5 text-[0.9rem] font-semibold text-ios-label">
                                                {c.subject}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {gitDiffLoading || gitDiffPath ? (
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <div className="text-[0.85rem] font-semibold text-ios-secondary/70">
                                        Diff
                                    </div>
                                    <div className="min-w-0 text-[0.85rem] font-semibold text-ios-label truncate">
                                        {gitDiffPath ?? ""}
                                    </div>
                                    <button
                                        className="inline-flex h-9 items-center justify-center rounded-xl border border-ios-separator/60 bg-ios-surface2 px-3 text-[0.85rem] font-semibold text-ios-label transition-colors hover:bg-ios-surface ml-auto"
                                        type="button"
                                        onClick={clearGitDiff}
                                    >
                                        Close
                                    </button>
                                </div>
                                {gitDiffTruncated ? (
                                    <div className="text-[0.75rem] leading-5 text-ios-secondary/60">
                                        Truncated.
                                    </div>
                                ) : null}
                                <div className="rounded-xl border border-ios-separator/60 overflow-hidden">
                                    <div className="max-h-[40vh] overflow-auto bg-ios-surface2">
                                        <pre className="p-4 text-[0.75rem] leading-5 whitespace-pre-wrap break-words text-ios-label">
                                            {gitDiffLoading
                                                ? "Loading…"
                                                : gitDiffText || "(no diff)"}
                                        </pre>
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
};

export default RightSidebar;
