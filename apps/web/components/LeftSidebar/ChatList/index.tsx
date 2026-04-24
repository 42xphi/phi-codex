import { Transition } from "@headlessui/react";
import { useEffect, useMemo, useState } from "react";
import { twMerge } from "tailwind-merge";
import Icon from "@/components/Icon";
import { useCodex } from "@/lib/codex";

type ChatListProps = {
    visible?: boolean;
    onOpenSettings: () => void;
    onCloseSidebar?: () => void;
};

const COLLAPSE_STORAGE_KEY = "codex_remote_projects_collapsed_v1";

function basenameFromPath(rawPath: string) {
    const value = (rawPath ?? "").trim();
    if (!value) return "";
    const trimmed = value.replace(/\/+$/, "");
    const parts = trimmed.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : trimmed;
}

const ChatList = ({ visible, onOpenSettings, onCloseSidebar }: ChatListProps) => {
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

    const [search, setSearch] = useState("");
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
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
    });

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            window.localStorage.setItem(
                COLLAPSE_STORAGE_KEY,
                JSON.stringify(collapsed)
            );
        } catch {}
    }, [collapsed]);

    const groups = useMemo(() => {
        const byCwd = new Map<string, typeof threads>();
        for (const t of threads) {
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
    }, [threads]);

    const selectedCwd = projectCwd ?? activeCwd;

    function handleProjectClick(cwd: string) {
        setProjectCwd(cwd);
        setCollapsed((prev) => {
            const isSame = selectedCwd === cwd;
            const nextCollapsed = isSame ? !Boolean(prev[cwd]) : false;
            return { ...prev, [cwd]: nextCollapsed };
        });
    }

    return (
        <>
            <div className="mb-auto pb-6">
                <div
                    className={twMerge(
                        "flex items-center w-full h-12 text-left text-ios-secondary/70",
                        visible ? "justify-center px-3" : "px-4"
                    )}
                >
                    <div className="flex items-center">
                        <Icon
                            className="fill-current text-ios-secondary/70"
                            name="container"
                        />
                        {!visible && (
                            <div className="ml-3 text-[0.85rem] font-semibold">
                                Projects
                            </div>
                        )}
                    </div>
                    {!visible ? (
                        <div className="ml-auto flex items-center gap-2">
                            <button
                                className="inline-flex h-9 items-center justify-center rounded-xl border border-ios-separator/60 bg-ios-surface2 px-3 text-[0.85rem] font-semibold text-ios-label transition-colors hover:bg-ios-surface"
                                type="button"
                                onClick={() =>
                                    refreshThreads({
                                        searchTerm: search.trim() || undefined,
                                    })
                                }
                            >
                                {threadsLoading ? "…" : "Refresh"}
                            </button>
                            <button
                                className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-ios-blue px-3 text-[0.85rem] font-semibold text-white shadow-[0_0.5rem_1.5rem_-1rem_rgba(0,0,0,0.35)] transition-opacity hover:opacity-90"
                                type="button"
                                onClick={() => {
                                    startThread();
                                    onCloseSidebar?.();
                                }}
                            >
                                <Icon className="w-5 h-5 fill-current" name="plus" />
                                <span>New</span>
                            </button>
                        </div>
                    ) : null}
                </div>

                {!visible ? (
                    <div className="px-4 pb-3">
                        <input
                            className="w-full h-10 px-4 rounded-xl border border-ios-separator/60 bg-ios-surface2 text-[0.9rem] text-ios-label outline-none transition-shadow placeholder:text-ios-secondary/60 focus:shadow-[0_0_0_0.125rem_rgba(0,122,255,0.35)]"
                            type="text"
                            value={search}
                            placeholder="Search threads…"
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    refreshThreads({
                                        searchTerm: search.trim() || undefined,
                                    });
                                }
                            }}
                        />
                    </div>
                ) : null}

                {errorBanner && connectionState === "connected" && !visible ? (
                    <div className="px-4 pb-3">
                        <div className="p-3 rounded-xl border border-ios-red/30 bg-ios-red/10 text-ios-red break-words">
                            {errorBanner}
                        </div>
                    </div>
                ) : null}

                {connectionState !== "connected" ? (
                    <div className={`${visible ? "px-3" : "px-4"} pb-4`}>
                        {!visible ? (
                            <>
                                <div className="mt-2 text-[0.8rem] leading-5 text-ios-secondary/60">
                                    {errorBanner
                                        ? errorBanner
                                        : "Not connected."}
                                </div>
                                <button
                                    className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-ios-blue px-4 text-[0.9rem] font-semibold text-white shadow-[0_0.5rem_1.5rem_-1rem_rgba(0,0,0,0.35)] transition-opacity hover:opacity-90"
                                    type="button"
                                    onClick={onOpenSettings}
                                >
                                    Open settings
                                </button>
                            </>
                        ) : null}
                    </div>
                ) : (
                    <div className={`${visible && "px-2"} space-y-2`}>
                        {groups.map((group) => {
                            const isCollapsed = Boolean(collapsed[group.cwd]);
                            const label =
                                basenameFromPath(group.cwd) ||
                                group.cwd ||
                                "(unknown)";
                            const isSelected = selectedCwd === group.cwd;
                            return (
                                <div key={group.cwd}>
                                    <button
                                        className={twMerge(
                                            `group flex items-center w-full h-11 rounded-xl transition-colors ${
                                                visible ? "px-3 justify-center" : "px-4"
                                            } ${
                                                isSelected
                                                    ? "bg-ios-surface2 text-ios-label"
                                                    : "text-ios-secondary/80 hover:bg-ios-surface2 hover:text-ios-label"
                                            }`
                                        )}
                                        onClick={() => handleProjectClick(group.cwd)}
                                        type="button"
                                    >
                                        <Icon
                                            className={twMerge(
                                                "fill-current text-ios-secondary/70 transition-transform",
                                                isCollapsed ? "-rotate-90" : ""
                                            )}
                                            name="arrow-down"
                                        />
                                        {!visible ? (
                                            <>
                                                <div className="ml-3 min-w-0 flex-1 truncate text-[0.9rem] font-semibold">
                                                    {label}
                                                </div>
                                                <div className="ml-auto shrink-0 rounded-lg bg-ios-surface px-2 text-[0.8rem] font-semibold text-ios-secondary/70">
                                                    {group.threads.length}
                                                </div>
                                            </>
                                        ) : null}
                                    </button>
                                    <Transition
                                        show={!isCollapsed}
                                        enter="transition duration-100 ease-out"
                                        enterFrom="transform scale-95 opacity-0"
                                        enterTo="transform scale-100 opacity-100"
                                        leave="transition duration-75 ease-out"
                                        leaveFrom="transform scale-100 opacity-100"
                                        leaveTo="transform scale-95 opacity-0"
                                    >
                                        <div className={`${visible ? "px-2" : "px-4"} mt-1 space-y-1`}>
                                            {group.threads.slice(0, 30).map((t) => {
                                                const isPending = pendingThreadId === t.id;
                                                return (
                                                    <button
                                                        key={t.id}
                                                        className={twMerge(
                                                            `group flex items-center w-full h-10 rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                                                                visible ? "px-3 justify-center" : "px-4"
                                                            } ${
                                                                activeThreadId === t.id
                                                                    ? "bg-ios-surface2 text-ios-label"
                                                                    : "text-ios-secondary/80 hover:bg-ios-surface2 hover:text-ios-label"
                                                            }`
                                                        )}
                                                        onClick={() => {
                                                            selectThread(t.id);
                                                            onCloseSidebar?.();
                                                        }}
                                                        type="button"
                                                        disabled={Boolean(pendingThreadId)}
                                                    >
                                                        <Icon
                                                            className="fill-current text-ios-secondary/70 transition-colors group-hover:text-ios-blue"
                                                            name="chat"
                                                        />
                                                        {!visible ? (
                                                            <>
                                                                <div className="ml-3 min-w-0 flex-1 truncate text-[0.9rem] font-semibold">
                                                                    {t.name ||
                                                                        t.preview ||
                                                                        t.id}
                                                                </div>
                                                                {isPending ? (
                                                                    <div className="ml-3 text-[0.75rem] text-ios-secondary/60">
                                                                        Switching…
                                                                    </div>
                                                                ) : null}
                                                            </>
                                                        ) : null}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </Transition>
                                </div>
                            );
                        })}
                        {groups.length === 0 && !threadsLoading ? (
                            <div className={`${visible ? "px-3" : "px-4"} text-[0.8rem] leading-5 text-ios-secondary/60`}>
                                No threads yet. Click <span className="font-semibold">New</span> to start one.
                            </div>
                        ) : null}
                    </div>
                )}
            </div>
        </>
    );
};

export default ChatList;
