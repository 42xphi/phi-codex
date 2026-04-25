"use client";

import { CodexProvider } from "@/lib/codex";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <CodexProvider>{children}</CodexProvider>
            <Toaster richColors closeButton />
        </ThemeProvider>
    );
}
