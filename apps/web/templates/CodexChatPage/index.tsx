"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Layout from "@/components/Layout";
import Chat from "@/components/Chat";
import Question from "@/components/Question";
import Answer from "@/components/Answer";
import Message from "@/components/Message";
import MessageContent from "@/components/Codex/MessageContent";
import Approvals from "@/components/Codex/Approvals";
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

    const headerTitle = useMemo(() => basenameFromPath(activeCwd) || "Codex", [activeCwd]);

    const headerSubtitle = useMemo(() => {
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
        const parts = [status];
        if (model) parts.push(model);
        if (activeThreadId) parts.push(activeThreadId.slice(0, 8));
        return parts.join(" · ");
    }, [activeThreadId, connectionState, model, pendingThreadId]);

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
        <>
            <Layout>
                <Chat title={headerTitle} subtitle={headerSubtitle}>
                    {connectionState === "connected" && !activeThreadId ? (
                        <div className="mb-4 rounded-[1.25rem] border border-ios-separator/60 bg-ios-surface px-4 py-3 text-ios-secondary/70">
                            Starting Codex…
                        </div>
                    ) : null}
                    {pendingThreadId ? (
                        <div className="mb-4 rounded-[1.25rem] border border-ios-separator/60 bg-ios-surface px-4 py-3 text-ios-secondary/70">
                            {pendingThreadId === "starting"
                                ? "Starting a new thread…"
                                : "Switching threads…"}
                        </div>
                    ) : null}
                    {messages.length === 0 ? (
                        <div className="max-w-[50rem]">
                            <div className="text-[1.05rem] font-semibold text-ios-label">
                                Remote Codex chat
                            </div>
                            <div className="mt-2 text-[0.95rem] leading-6 text-ios-secondary/60">
                                Select a thread in the left sidebar, or click{" "}
                                <span className="font-semibold text-ios-label">
                                    New
                                </span>{" "}
                                to start one.
                            </div>
                            {!canSend ? (
                                <div className="mt-4 rounded-[1.25rem] border border-ios-separator/60 bg-ios-surface px-4 py-3 text-ios-secondary/70">
                                    Status:{" "}
                                    <span className="font-semibold text-ios-label">
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
            <Approvals />
        </>
    );
};

export default CodexChatPage;
