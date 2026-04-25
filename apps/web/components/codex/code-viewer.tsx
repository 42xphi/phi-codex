"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

import { cn } from "@/lib/utils";

const EXT_TO_LANGUAGE: Record<string, string> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  graphql: "graphql",
  h: "c",
  hpp: "cpp",
  html: "markup",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  kt: "kotlin",
  lua: "lua",
  md: "markdown",
  mjs: "javascript",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  xml: "markup",
  yml: "yaml",
  yaml: "yaml",
  zsh: "bash",
};

function languageFromPath(filePath: string) {
  const base = (filePath ?? "").split("/").pop() ?? "";
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  return EXT_TO_LANGUAGE[ext] ?? "";
}

type CodeViewerProps = {
  path: string;
  content: string;
  loading?: boolean;
  className?: string;
};

export function CodeViewer({ path, content, loading, className }: CodeViewerProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const style = isDark ? oneDark : oneLight;
  const language = languageFromPath(path);

  if (loading) {
    return (
      <pre className={cn("p-4 text-xs leading-5 text-muted-foreground", className)}>
        Loading…
      </pre>
    );
  }

  const backgroundColor = isDark ? "#282C34" : "#FAFAFA";

  return (
    <div className={cn("h-full w-full", className)} style={{ backgroundColor }}>
      <SyntaxHighlighter
        language={language}
        style={style as any}
        showLineNumbers={false}
        wrapLongLines
        customStyle={{
          margin: 0,
          background: "transparent",
          padding: "1rem",
        }}
        codeTagProps={{
          style: {
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: "0.75rem",
            lineHeight: "1.25rem",
          },
        }}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
}
