"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

type MessageBubbleProps = {
  role: "user" | "assistant";
  text: string;
  time?: string;
  streaming?: boolean;
};

type MarkdownTone = "default" | "inverse";

function Markdown({ text, tone }: { text: string; tone: MarkdownTone }) {
  return (
    <div className="codex-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          // Remove fenced code blocks in chat (keep inline code).
          pre: () => null,
          code: ({ className, children, ...props }) => {
            // If this is a fenced code block, react-markdown usually provides
            // `language-*` and wraps in <pre>. We drop both.
            if (typeof className === "string" && className.includes("language-")) {
              return null;
            }

            return (
              <code
                className={cn(
                  "rounded-md px-1.5 py-0.5 font-mono text-[0.85em]",
                  tone === "inverse"
                    ? "bg-white/20 text-primary-foreground"
                    : "bg-muted text-foreground",
                  className,
                )}
                {...props}
              >
                {children}
              </code>
            );
          },
          a: ({ className, ...props }) => {
            return (
              <a
                className={cn(
                  "underline underline-offset-4 hover:opacity-90",
                  tone === "inverse" ? "text-primary-foreground" : "text-primary",
                  className,
                )}
                target="_blank"
                rel="noreferrer"
                {...props}
              />
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function MessageBubble({ role, text, time, streaming }: MessageBubbleProps) {
  const isUser = role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[92%] rounded-2xl border px-4 py-3 shadow-sm",
          isUser
            ? "border-primary/30 bg-primary text-primary-foreground"
            : "border-border bg-card text-foreground",
        )}
      >
        <Markdown text={text} tone={isUser ? "inverse" : "default"} />
        <div
          className={cn(
            "mt-2 flex items-center gap-2 text-[0.72rem]",
            isUser ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          {time ? <span>{time}</span> : null}
          {streaming ? (
            <span className="inline-flex items-center gap-1">· typing…</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
