import { ChangeEventHandler } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { twMerge } from "tailwind-merge";
import Icon from "@/components/Icon";

type MessageProps = {
    value: any;
    onChange: ChangeEventHandler<HTMLTextAreaElement>;
    onSend?: () => void;
    disabled?: boolean;
    placeholder?: string;
    image?: string;
    document?: any;
};

const Message = ({
    value,
    onChange,
    onSend,
    disabled,
    placeholder,
    image,
    document,
}: MessageProps) => {
    const canSend = !disabled && String(value ?? "").trim().length > 0;

    return (
        <div
            className="shrink-0 border-t border-ios-separator/60 bg-ios-surface/80 backdrop-blur supports-[backdrop-filter]:bg-ios-surface/60"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
            <div className="flex items-end gap-3 px-10 2xl:px-6 md:px-4 py-3">
                <div className="flex-1 rounded-[1.25rem] border border-ios-separator/60 bg-ios-surface2 px-4 py-2">
                    <TextareaAutosize
                        className="w-full bg-transparent text-[0.95rem] leading-6 text-ios-label outline-none resize-none placeholder:text-ios-secondary/60"
                        maxRows={5}
                        value={value}
                        onChange={onChange}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                if (canSend) onSend?.();
                            }
                        }}
                        placeholder={placeholder || "Message Codex…"}
                        disabled={Boolean(disabled)}
                    />
                </div>

                <button
                    className={twMerge(
                        "inline-flex h-10 w-10 items-center justify-center rounded-full bg-ios-blue text-white shadow-[0_0.5rem_1.5rem_-1rem_rgba(0,0,0,0.35)] transition-opacity",
                        !canSend && "opacity-30 pointer-events-none",
                    )}
                    type="button"
                    onClick={() => {
                        if (canSend) onSend?.();
                    }}
                    aria-label="Send"
                >
                    <Icon className="w-5 h-5 fill-current" name="arrow-up" />
                </button>
            </div>
        </div>
    );
};

export default Message;
