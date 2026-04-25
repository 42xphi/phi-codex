import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeSanitize from "rehype-sanitize";

function isSafeHref(href: unknown) {
    if (typeof href !== "string") return false;
    const value = href.trim();
    if (!value) return false;
    if (value.startsWith("#")) return true;
    try {
        const url = new URL(value, "https://example.com");
        const protocol = url.protocol.toLowerCase();
        return (
            protocol === "http:" ||
            protocol === "https:" ||
            protocol === "mailto:" ||
            protocol === "tel:"
        );
    } catch {
        return false;
    }
}

type MessageContentProps = {
    text: string;
};

const MessageContent = ({ text }: MessageContentProps) => {
    const markdown = text ?? "";

    return (
        <div className="whitespace-normal break-words">
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                rehypePlugins={[rehypeSanitize]}
                components={{
                    a: ({ href, children, ...props }: any) => {
                        const safeHref = isSafeHref(href) ? String(href) : undefined;
                        return (
                            <a
                                href={safeHref}
                                target={safeHref ? "_blank" : undefined}
                                rel={safeHref ? "noopener noreferrer" : undefined}
                                className="underline underline-offset-2 decoration-current/40 hover:decoration-current/80"
                                {...props}
                            >
                                {children}
                            </a>
                        );
                    },
                    img: () => null,
                    pre: ({ children, ...props }: any) => (
                        <pre
                            className="my-3 max-w-full overflow-auto rounded-xl border border-ios-separator/40 bg-ios-surface2 px-4 py-3 text-[0.85em] leading-5 text-ios-label"
                            {...props}
                        >
                            {children}
                        </pre>
                    ),
                    code: ({ inline, children, ...props }: any) => {
                        const raw = String(children ?? "");
                        const code = raw.replace(/\n$/, "");
                        if (inline) {
                            return (
                                <code
                                    className="rounded-md bg-ios-surface/70 px-1.5 py-0.5 font-mono text-[0.85em] text-current"
                                    {...props}
                                >
                                    {children}
                                </code>
                            );
                        }

                        return (
                            <code className="font-mono whitespace-pre" {...props}>
                                {code}
                            </code>
                        );
                    },
                    p: ({ children, ...props }: any) => (
                        <p
                            className="my-2 leading-6 first:mt-0 last:mb-0"
                            {...props}
                        >
                            {children}
                        </p>
                    ),
                    ul: ({ children, ...props }: any) => (
                        <ul className="my-2 list-disc pl-5 space-y-1" {...props}>
                            {children}
                        </ul>
                    ),
                    ol: ({ children, ...props }: any) => (
                        <ol
                            className="my-2 list-decimal pl-5 space-y-1"
                            {...props}
                        >
                            {children}
                        </ol>
                    ),
                    li: ({ children, ...props }: any) => (
                        <li className="leading-6" {...props}>
                            {children}
                        </li>
                    ),
                    blockquote: ({ children, ...props }: any) => (
                        <blockquote
                            className="my-3 border-l-2 border-ios-separator/60 pl-4 text-current/80 italic"
                            {...props}
                        >
                            {children}
                        </blockquote>
                    ),
                    h1: ({ children, ...props }: any) => (
                        <h1
                            className="mt-4 mb-2 text-[1.15rem] font-semibold leading-snug"
                            {...props}
                        >
                            {children}
                        </h1>
                    ),
                    h2: ({ children, ...props }: any) => (
                        <h2
                            className="mt-4 mb-2 text-[1.05rem] font-semibold leading-snug"
                            {...props}
                        >
                            {children}
                        </h2>
                    ),
                    h3: ({ children, ...props }: any) => (
                        <h3 className="mt-3 mb-1 font-semibold" {...props}>
                            {children}
                        </h3>
                    ),
                    hr: ({ ...props }: any) => (
                        <hr className="my-4 border-ios-separator/60" {...props} />
                    ),
                    table: ({ children, ...props }: any) => (
                        <div className="my-3 overflow-x-auto">
                            <table
                                className="min-w-full border-collapse text-[0.9em]"
                                {...props}
                            >
                                {children}
                            </table>
                        </div>
                    ),
                    th: ({ children, ...props }: any) => (
                        <th
                            className="border border-ios-separator/60 bg-ios-surface2 px-3 py-2 text-left font-semibold"
                            {...props}
                        >
                            {children}
                        </th>
                    ),
                    td: ({ children, ...props }: any) => (
                        <td
                            className="border border-ios-separator/60 px-3 py-2 align-top"
                            {...props}
                        >
                            {children}
                        </td>
                    ),
                }}
            >
                {markdown}
            </ReactMarkdown>
        </div>
    );
};

export default MessageContent;
