"use client";

import * as React from "react";
import { ArrowUp, Loader2, StopCircle } from "lucide-react";

import { useCodex } from "@/lib/codex";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { MessageBubble } from "@/components/codex/message-bubble";

function basenameFromPath(rawPath: string | null) {
  const value = (rawPath ?? "").trim();
  if (!value) return "";
  const trimmed = value.replace(/\/+$/, "");
  const parts = trimmed.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : trimmed;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

type ChatPanelProps = {
  onOpenSettings: () => void;
};

export function ChatPanel({ onOpenSettings }: ChatPanelProps) {
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

  const [draft, setDraft] = React.useState("");
  const endRef = React.useRef<HTMLDivElement | null>(null);

  const headerTitle = React.useMemo(
    () => basenameFromPath(activeCwd) || "Codex",
    [activeCwd],
  );

  const headerSubtitle = React.useMemo(() => {
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

  const canSend =
    connectionState === "connected" && Boolean(activeThreadId) && !pendingThreadId;

  function handleSend() {
    if (!canSend) return;
    const text = draft.trim();
    if (!text) return;
    sendUserMessage(text);
    setDraft("");
  }

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-3 border-b border-border px-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{headerTitle}</div>
          <div className="truncate text-xs text-muted-foreground">
            {headerSubtitle}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {messages.some((m) => m.streaming) ? (
            <Button variant="outline" size="sm" onClick={abort}>
              <StopCircle className="h-4 w-4" />
              Stop
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onOpenSettings}>
            Settings
          </Button>
        </div>
      </div>

      {pendingThreadId ? (
        <div className="px-4 pt-3">
          <div className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
            {pendingThreadId === "starting"
              ? "Starting a new thread…"
              : "Switching threads…"}
          </div>
        </div>
      ) : null}

      <ScrollArea className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {messages.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="text-base font-semibold">Remote Codex chat</div>
              <div className="mt-2 text-sm leading-6 text-muted-foreground">
                Pick a thread from the Projects sidebar, or start a new chat.
                The workspace panel on the right lets you browse files, search,
                and inspect git changes.
              </div>
              {!canSend ? (
                <div className="mt-4 rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground">
                  {connectionState === "connected"
                    ? "Starting Codex…"
                    : "Not connected. Open Settings to connect."}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 space-y-4">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                role={m.role}
                time={formatTime(m.createdAt)}
                streaming={Boolean(m.streaming)}
                text={m.text}
              />
            ))}
            <div ref={endRef} />
          </div>
        </div>
      </ScrollArea>

      <Separator />

      <div className="mx-auto w-full max-w-3xl px-4 py-4">
        <div className="flex items-end gap-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              canSend
                ? "Message Codex…"
                : connectionState === "connected"
                  ? "Starting Codex…"
                  : "Connect to start chatting…"
            }
            className="min-h-[44px] resize-none"
            disabled={!canSend}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button
            onClick={handleSend}
            disabled={!canSend || !draft.trim()}
            className="h-11"
          >
            {pendingThreadId ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
            Send
          </Button>
        </div>
        <div
          className={cn(
            "mt-2 text-xs text-muted-foreground",
            canSend ? "" : "opacity-70",
          )}
        >
          Enter to send · Shift+Enter for newline
        </div>
      </div>
    </div>
  );
}

