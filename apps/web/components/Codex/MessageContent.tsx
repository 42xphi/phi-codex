import SyntaxHighlighter from "react-syntax-highlighter";
import { srcery } from "react-syntax-highlighter/dist/cjs/styles/hljs";

type MessageBlock =
    | { type: "text"; text: string }
    | { type: "code"; lang?: string; code: string };

function parseMessageBlocks(rawText: string): MessageBlock[] {
    const text = rawText ?? "";
    if (!text.includes("```")) return [{ type: "text", text }];

    const blocks: MessageBlock[] = [];
    let rest = text;

    while (rest.length > 0) {
        const fenceStart = rest.indexOf("```");
        if (fenceStart === -1) {
            blocks.push({ type: "text", text: rest });
            break;
        }

        if (fenceStart > 0) {
            blocks.push({ type: "text", text: rest.slice(0, fenceStart) });
        }

        const afterStart = rest.slice(fenceStart + 3);
        const fenceEnd = afterStart.indexOf("```");
        if (fenceEnd === -1) {
            blocks.push({ type: "text", text: rest.slice(fenceStart) });
            break;
        }

        const fenceBody = afterStart.slice(0, fenceEnd);
        rest = afterStart.slice(fenceEnd + 3);

        const firstNewline = fenceBody.indexOf("\n");
        let lang: string | undefined;
        let code = fenceBody;
        if (firstNewline !== -1) {
            const firstLine = fenceBody.slice(0, firstNewline).trim();
            const remaining = fenceBody.slice(firstNewline + 1);
            if (firstLine && !firstLine.includes(" ")) {
                lang = firstLine;
                code = remaining;
            }
        }
        code = code.replace(/\n$/, "");

        blocks.push({ type: "code", lang, code });
    }

    return blocks;
}

type MessageContentProps = {
    text: string;
};

const MessageContent = ({ text }: MessageContentProps) => {
    const blocks = parseMessageBlocks(text);
    if (blocks.length === 1 && blocks[0]?.type === "text") {
        return (
            <div className="whitespace-pre-wrap break-words">
                {blocks[0].text}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {blocks.map((b, idx) =>
                b.type === "text" ? (
                    <div
                        key={`t:${idx}`}
                        className="whitespace-pre-wrap break-words"
                    >
                        {b.text}
                    </div>
                ) : (
                    <div
                        key={`c:${idx}`}
                        className="rounded-xl overflow-hidden border border-n-3 dark:border-n-5"
                    >
                        <div className="px-4 py-2 bg-n-3/70 caption1 text-n-4 dark:bg-n-6">
                            {b.lang ? b.lang : "code"}
                        </div>
                        <SyntaxHighlighter
                            language={b.lang}
                            style={srcery}
                            customStyle={{
                                margin: 0,
                                maxWidth: "100%",
                                padding: "0.9rem 1rem 1rem",
                                background: "transparent",
                            }}
                            codeTagProps={{
                                style: { whiteSpace: "pre-wrap" },
                            }}
                        >
                            {b.code}
                        </SyntaxHighlighter>
                    </div>
                )
            )}
        </div>
    );
};

export default MessageContent;

