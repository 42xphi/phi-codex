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
                `absolute top-0 right-0 bottom-0 flex flex-col w-[22.5rem] bg-n-1 rounded-r-[1.25rem] border-l border-n-3 shadow-[inset_0_1.5rem_3.75rem_rgba(0,0,0,0.1)] 2xl:w-80 lg:rounded-[1.25rem] lg:invisible lg:opacity-0 lg:transition-opacity lg:z-20 lg:border-l-0 lg:shadow-2xl md:fixed md:w-[calc(100%-4rem)] md:border-l md:rounded-none dark:bg-n-6 dark:border-n-5 ${
                    visible && "lg:visible lg:opacity-100"
                } ${className}`,
            )}
        >
            <div className="flex items-center h-18 px-9 border-b border-n-3 lg:pr-18 md:px-6 dark:border-n-5">
                <div className="min-w-0">
                    <div className="base2 text-n-7 dark:text-n-1">
                        {workspaceRootName || "Workspace"}
                    </div>
                    <div className="caption1 text-n-4/75 truncate">
                        {connectionState === "connected"
                            ? "Connected"
                            : connectionState}
                    </div>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <button
                        className="btn-stroke-light btn-medium h-9 px-3"
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

            <div className="px-9 md:px-6 py-4 border-b border-n-3 dark:border-n-5">
                <div className="flex gap-2">
                    {tabs.map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            className={twMerge(
                                "h-10 px-4 rounded-xl base2 font-semibold transition-colors",
                                tab === t.id
                                    ? "bg-primary-1 text-n-1"
                                    : "bg-n-2 text-n-4 hover:text-n-7 dark:bg-n-7 dark:text-n-3 dark:hover:text-n-1",
                            )}
                            onClick={() => setTab(t.id)}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            {errorBanner ? (
                <div className="px-9 md:px-6 pt-4">
                    <div className="p-3 rounded-xl border border-accent-1/50 bg-accent-1/10 text-accent-1">
                        {errorBanner}
                    </div>
                </div>
            ) : null}

            <div className="grow overflow-y-auto scroll-smooth px-9 md:px-6 py-6 space-y-6">
                {tab === "files" ? (
                    selectedFileLoading || selectedFilePath ? (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2">
                                <button
                                    className="btn-stroke-light btn-medium h-9 px-3"
                                    type="button"
                                    onClick={clearSelectedFile}
                                >
                                    Back
                                </button>
                                <div className="min-w-0 caption1 text-n-4 truncate">
                                    {selectedFilePath ?? ""}
                                </div>
                                <button
                                    className="btn-stroke-light btn-medium h-9 px-3 ml-auto"
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
                                <div className="caption1 text-n-4/75">
                                    Truncated by the server (only the first
                                    bytes are shown).
                                </div>
                            ) : null}

                            <div className="rounded-xl border border-n-3 dark:border-n-5 overflow-hidden">
                                <div className="max-h-[50vh] overflow-auto bg-n-2 dark:bg-n-7">
                                    <pre className="p-4 caption1 whitespace-pre-wrap break-words text-n-7 dark:text-n-1">
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
                                    className="btn-stroke-light btn-medium h-9 px-3"
                                    type="button"
                                    onClick={() => listDir(parentDirPath(browsePath))}
                                    disabled={!browsePath}
                                >
                                    Up
                                </button>
                                <div className="min-w-0 caption1 text-n-4 truncate">
                                    {browsePath ? `./${browsePath}` : "."}
                                </div>
                                <button
                                    className="btn-stroke-light btn-medium h-9 px-3 ml-auto"
                                    type="button"
                                    onClick={() => listDir(browsePath)}
                                >
                                    {browseLoading ? "…" : "Refresh"}
                                </button>
                            </div>

                            <div className="rounded-xl border border-n-3 dark:border-n-5 overflow-hidden">
                                <div className="divide-y divide-n-3 dark:divide-n-5">
                                    {browseEntries.map((e) => (
                                        <button
                                            key={e.path || `${e.type}:${e.name}`}
                                            type="button"
                                            className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-n-2 dark:hover:bg-n-7"
                                            onClick={() => {
                                                if (e.type === "dir")
                                                    listDir(e.path);
                                                else readFile(e.path);
                                            }}
                                        >
                                            <Icon
                                                className="fill-n-4"
                                                name={e.type === "dir" ? "box" : "chat-1"}
                                            />
                                            <div className="min-w-0">
                                                <div className="base2 font-semibold text-n-7 dark:text-n-1 truncate">
                                                    {e.name}
                                                </div>
                                                <div className="caption1 text-n-4/75 truncate">
                                                    {e.type === "dir"
                                                        ? "folder"
                                                        : e.path}
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                    {browseEntries.length === 0 && !browseLoading ? (
                                        <div className="px-4 py-4 caption1 text-n-4/75">
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
                                className="w-full h-10 px-4 bg-transparent shadow-[inset_0_0_0_0.0625rem_#DADBDC] rounded-xl outline-none caption1 text-n-7 transition-shadow focus:shadow-[inset_0_0_0_0.125rem_#0084FF] placeholder:text-n-4 dark:shadow-[inset_0_0_0_0.0625rem_#2A2E2F] dark:text-n-1 dark:focus:shadow-[inset_0_0_0_0.125rem_#0084FF]"
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
                                className="btn-blue btn-medium h-10 px-4"
                                type="button"
                                onClick={() => searchWorkspace(searchQuery)}
                                disabled={!searchQuery.trim()}
                            >
                                {searchLoading ? "…" : "Go"}
                            </button>
                        </div>

                        <div className="rounded-xl border border-n-3 dark:border-n-5 overflow-hidden">
                            <div className="divide-y divide-n-3 dark:divide-n-5">
                                {searchMatches.map((m, idx) => (
                                    <button
                                        key={`${m.path}:${m.line}:${m.column}:${idx}`}
                                        type="button"
                                        className="w-full px-4 py-3 text-left transition-colors hover:bg-n-2 dark:hover:bg-n-7"
                                        onClick={() => {
                                            readFile(m.path);
                                            setTab("files");
                                        }}
                                    >
                                        <div className="base2 font-semibold text-n-7 dark:text-n-1 truncate">
                                            {m.path}:{m.line}:{m.column}
                                        </div>
                                        <div className="caption1 text-n-4/75 whitespace-pre-wrap break-words">
                                            {m.text}
                                        </div>
                                    </button>
                                ))}
                                {searchTruncated ? (
                                    <div className="px-4 py-3 caption1 text-n-4/75">
                                        Results truncated.
                                    </div>
                                ) : null}
                                {searchMatches.length === 0 && !searchLoading ? (
                                    <div className="px-4 py-4 caption1 text-n-4/75">
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
                            <div className="base2 text-n-4/75">
                                Branch:
                            </div>
                            <div className="base2 font-semibold text-n-7 dark:text-n-1 truncate">
                                {gitBranch || "—"}
                            </div>
                            <button
                                className="btn-stroke-light btn-medium h-9 px-3 ml-auto"
                                type="button"
                                onClick={refreshGitStatus}
                            >
                                {gitStatusLoading ? "…" : "Refresh"}
                            </button>
                        </div>

                        <div className="rounded-xl border border-n-3 dark:border-n-5 overflow-hidden">
                            <div className="divide-y divide-n-3 dark:divide-n-5">
                                {gitEntries.map((e) => (
                                    <button
                                        key={`${e.code}:${e.path}`}
                                        type="button"
                                        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-n-2 dark:hover:bg-n-7"
                                        onClick={() => {
                                            clearGitDiff();
                                            gitDiffFile(e.path);
                                        }}
                                    >
                                        <div className="shrink-0 px-2 py-1 rounded-lg bg-n-3 caption1 font-semibold text-n-4 dark:bg-n-7 dark:text-n-3">
                                            {e.code}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="base2 font-semibold text-n-7 dark:text-n-1 truncate">
                                                {e.path}
                                            </div>
                                            {e.fromPath ? (
                                                <div className="caption1 text-n-4/75 truncate">
                                                    from {e.fromPath}
                                                </div>
                                            ) : null}
                                        </div>
                                    </button>
                                ))}
                                {gitHiddenCount > 0 ? (
                                    <div className="px-4 py-3 caption1 text-n-4/75">
                                        {gitHiddenCount} entries hidden.
                                    </div>
                                ) : null}
                                {gitEntries.length === 0 && !gitStatusLoading ? (
                                    <div className="px-4 py-4 caption1 text-n-4/75">
                                        Working tree clean.
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <div className="base2 text-n-4/75">
                                Recent commits
                            </div>
                            <button
                                className="btn-stroke-light btn-medium h-9 px-3 ml-auto"
                                type="button"
                                onClick={() => refreshGitLog({ limit: 20 })}
                            >
                                {gitLogLoading ? "…" : "Load"}
                            </button>
                        </div>

                        {gitCommits.length > 0 ? (
                            <div className="rounded-xl border border-n-3 dark:border-n-5 overflow-hidden">
                                <div className="divide-y divide-n-3 dark:divide-n-5">
                                    {gitCommits.map((c) => (
                                        <div
                                            key={c.hash}
                                            className="px-4 py-3"
                                        >
                                            <div className="caption1 text-n-4/75">
                                                {c.hash}
                                            </div>
                                            <div className="base2 font-semibold text-n-7 dark:text-n-1">
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
                                    <div className="base2 text-n-4/75">
                                        Diff
                                    </div>
                                    <div className="base2 font-semibold text-n-7 dark:text-n-1 truncate">
                                        {gitDiffPath ?? ""}
                                    </div>
                                    <button
                                        className="btn-stroke-light btn-medium h-9 px-3 ml-auto"
                                        type="button"
                                        onClick={clearGitDiff}
                                    >
                                        Close
                                    </button>
                                </div>
                                {gitDiffTruncated ? (
                                    <div className="caption1 text-n-4/75">
                                        Truncated.
                                    </div>
                                ) : null}
                                <div className="rounded-xl border border-n-3 dark:border-n-5 overflow-hidden">
                                    <div className="max-h-[40vh] overflow-auto bg-n-2 dark:bg-n-7">
                                        <pre className="p-4 caption1 whitespace-pre-wrap break-words text-n-7 dark:text-n-1">
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

