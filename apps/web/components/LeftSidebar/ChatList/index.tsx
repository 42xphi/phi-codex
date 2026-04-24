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

    function toggleProject(cwd: string) {
        setCollapsed((prev) => ({ ...prev, [cwd]: !prev[cwd] }));
    }

    return (
        <>
            <div className="mb-auto pb-6">
                <div
                    className={`flex items-center w-full h-12 text-left base2 text-n-4/75 ${
                        visible ? "justify-center px-3" : "px-5"
                    }`}
                >
                    <div className="flex items-center">
                        <Icon className="fill-n-4" name="container" />
                        {!visible && <div className="ml-5">Projects</div>}
                    </div>
                    {!visible ? (
                        <div className="ml-auto flex items-center gap-2">
                            <button
                                className="btn-stroke-light btn-medium h-9 px-3"
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
                                className="btn-blue btn-medium h-9 px-3"
                                type="button"
                                onClick={() => {
                                    startThread({
                                        cwd: activeCwd ?? undefined,
                                    });
                                    onCloseSidebar?.();
                                }}
                            >
                                <Icon name="plus" />
                                <span>New</span>
                            </button>
                        </div>
                    ) : null}
                </div>

                {!visible ? (
                    <div className="px-5 pb-3">
                        <input
                            className="w-full h-10 px-4 bg-transparent shadow-[inset_0_0_0_0.0625rem_#2A2E2F] rounded-xl outline-none caption1 text-n-1 transition-shadow focus:shadow-[inset_0_0_0_0.125rem_#0084FF] placeholder:text-n-4"
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
                    <div className="px-5 pb-3">
                        <div className="p-3 rounded-xl border border-accent-1/50 bg-accent-1/10 text-accent-1 break-words">
                            {errorBanner}
                        </div>
                    </div>
                ) : null}

                {connectionState !== "connected" ? (
                    <div className={`${visible ? "px-3" : "px-5"} pb-4`}>
                        {!visible ? (
                            <>
                                <div className="mt-2 caption1 text-n-4/75">
                                    {errorBanner
                                        ? errorBanner
                                        : "Not connected."}
                                </div>
                                <button
                                    className="btn-blue btn-medium mt-4"
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
                            return (
                                <div key={group.cwd}>
                                    <button
                                        className={twMerge(
                                            `group flex items-center w-full h-11 rounded-lg text-n-3/75 base2 font-semibold transition-colors hover:text-n-1 ${
                                                visible ? "px-3" : "px-5"
                                            } ${
                                                activeCwd === group.cwd &&
                                                !isCollapsed &&
                                                "text-n-1 bg-gradient-to-l from-[#323337] to-[rgba(70,79,111,0.25)]"
                                            }`
                                        )}
                                        onClick={() => toggleProject(group.cwd)}
                                        type="button"
                                    >
                                        <Icon
                                            className={twMerge(
                                                "fill-n-4 transition-transform",
                                                isCollapsed ? "-rotate-90" : ""
                                            )}
                                            name="arrow-down"
                                        />
                                        {!visible ? (
                                            <>
                                                <div className="ml-5 truncate">
                                                    {label}
                                                </div>
                                                <div className="ml-auto px-2 bg-n-6 rounded-lg base2 font-semibold text-n-4">
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
                                        <div className={`${visible ? "px-2" : "px-5"} mt-1 space-y-1`}>
                                            {group.threads.slice(0, 30).map((t) => {
                                                const isPending = pendingThreadId === t.id;
                                                return (
                                                    <button
                                                        key={t.id}
                                                        className={twMerge(
                                                            `group flex items-center w-full h-10 rounded-lg text-n-3/75 base2 font-semibold transition-colors hover:text-n-1 disabled:opacity-60 disabled:cursor-not-allowed ${
                                                                visible ? "px-3" : "px-4"
                                                            } ${
                                                                activeThreadId === t.id &&
                                                                "text-n-1 bg-gradient-to-l from-[#323337] to-[rgba(80,62,110,0.29)]"
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
                                                            className="fill-n-4 transition-colors group-hover:fill-primary-1"
                                                            name="chat"
                                                        />
                                                        {!visible ? (
                                                            <>
                                                                <div className="ml-4 min-w-0 flex-1 truncate">
                                                                    {t.name ||
                                                                        t.preview ||
                                                                        t.id}
                                                                </div>
                                                                {isPending ? (
                                                                    <div className="ml-3 caption1 text-n-4/75">
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
                            <div className={`${visible ? "px-3" : "px-5"} caption1 text-n-4/75`}>
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
