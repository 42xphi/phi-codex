import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

const fontVars = {
    "--font-inter":
        'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    "--font-karla":
        'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
} as any;

export const metadata: Metadata = {
    title: "Codex Remote",
    description: "Chat with your local Codex from anywhere (threads + files + git).",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <head>
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1, maximum-scale=1"
                />
                <meta name="theme-color" content="#0b0d0f" />
            </head>
            <body
                style={fontVars}
                className="bg-n-7 font-sans text-[1rem] leading-6 -tracking-[.01em] text-n-7 antialiased md:bg-n-1 dark:text-n-1 dark:md:bg-n-6"
            >
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
