import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
    title: "Pi",
    description: "Chat with your local Codex from anywhere (threads + files + git).",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1, maximum-scale=1"
                />
                <meta
                    name="theme-color"
                    media="(prefers-color-scheme: light)"
                    content="#f4f4f5"
                />
                <meta
                    name="theme-color"
                    media="(prefers-color-scheme: dark)"
                    content="#111111"
                />
            </head>
            <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
