"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Layout from "@/components/Layout";
import Chat from "@/components/Chat";
import Question from "@/components/Question";
import Answer from "@/components/Answer";
import Message from "@/components/Message";
import MessageContent from "@/components/Codex/MessageContent";
import { useCodex } from "@/lib/codex";

function formatTime(iso: string) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function basenameFromPath(rawPath: string | null) {
    const value = (rawPath ?? "").trim();
    if (!value) return "";
    const trimmed = value.replace(/\/+$/, "");
    const parts = trimmed.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : trimmed;
}

const CodexChatPage = () => {
    const {
        connectionState,
        model,
        activeThreadId,
        pendingThreadId,
        activeCwd,
        messages,
        sendUserMessage,
        abort,
    } = useCodex();

    const [draft, setDraft] = useState<string>("");
    const endRef = useRef<HTMLDivElement | null>(null);

    const title = useMemo(() => {
        const wsName = basenameFromPath(activeCwd) || "Codex";
        const suffix = model ? ` · ${model}` : "";
        const status =
            connectionState !== "connected"
                ? connectionState
                : pendingThreadId
                  ? pendingThreadId === "starting"
                        ? "starting"
                        : "switching"
                  : activeThreadId
                    ? "connected"
                    : "starting";
        const threadShort = activeThreadId ? ` · ${activeThreadId.slice(0, 8)}` : "";
        return `${wsName} · ${status}${suffix}${threadShort}`;
    }, [activeCwd, activeThreadId, connectionState, model, pendingThreadId]);

    const canSend = connectionState === "connected" && Boolean(activeThreadId) && !pendingThreadId;

    function handleSend() {
        if (!canSend) return;
        const text = draft.trim();
        if (!text) return;
        sendUserMessage(text);
        setDraft("");
    }

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [messages.length]);

    return (
        <Layout>
            <Chat title={title}>
                {connectionState === "connected" && !activeThreadId ? (
                    <div className="mb-4 p-4 rounded-xl border border-n-3 text-n-4 dark:border-n-5">
                        Starting Codex…
                    </div>
                ) : null}
                {pendingThreadId ? (
                    <div className="mb-4 p-4 rounded-xl border border-n-3 text-n-4 dark:border-n-5">
                        {pendingThreadId === "starting"
                            ? "Starting a new thread…"
                            : "Switching threads…"}
                    </div>
                ) : null}
                {messages.length === 0 ? (
                    <div className="max-w-[50rem]">
                        <div className="h6 text-n-7 dark:text-n-1">
                            Remote Codex chat
                        </div>
                        <div className="mt-2 body2 text-n-4">
                            Select a thread in the left sidebar, or click{" "}
                            <span className="font-semibold">New</span> to start one.
                        </div>
                        {!canSend ? (
                            <div className="mt-4 p-4 rounded-xl border border-n-3 text-n-4 dark:border-n-5">
                                Status:{" "}
                                <span className="font-semibold text-n-7 dark:text-n-1">
                                    {connectionState}
                                </span>
                                . Open Settings in the left sidebar to connect.
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {messages.map((m) =>
                    m.role === "user" ? (
                        <Question
                            key={m.id}
                            content={<MessageContent text={m.text} />}
                            time={formatTime(m.createdAt)}
                        />
                    ) : (
                        <Answer
                            key={m.id}
                            time={formatTime(m.createdAt)}
                            streaming={Boolean(m.streaming)}
                            onAbort={abort}
                        >
                            <MessageContent text={m.text} />
                        </Answer>
                    )
                )}
                <div ref={endRef} />
            </Chat>
            <Message
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onSend={handleSend}
                disabled={!canSend}
                placeholder={
                    canSend
                        ? "Message Codex…"
                        : connectionState === "connected"
                          ? "Starting Codex…"
                          : "Connect to start chatting…"
                }
            />
        </Layout>
    );
};

export default CodexChatPage;
