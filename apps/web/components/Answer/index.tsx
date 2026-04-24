import Icon from "@/components/Icon";
import Loading from "./Loading";

type AnswerProps = {
    children?: React.ReactNode;
    loading?: boolean;
    streaming?: boolean;
    time?: string;
    onAbort?: () => void;
};

const Answer = ({ children, loading, streaming, time, onAbort }: AnswerProps) => {
    return (
        <div className="flex justify-start">
            <div className="w-full max-w-[50rem]">
                <div className="w-fit max-w-full rounded-[1.25rem] bg-ios-bubbleAssistant px-4 py-3 text-ios-label shadow-[0_0.5rem_1.5rem_-1rem_rgba(0,0,0,0.25)]">
                    <div className="text-[0.95rem] leading-6 whitespace-pre-wrap break-words">
                        {loading ? <Loading /> : children}
                    </div>
                    {streaming && !loading ? (
                        <div className="pt-1">
                            <Loading />
                        </div>
                    ) : null}
                </div>
            </div>
            <div className="mt-1 flex items-center gap-2 pl-1 text-[0.7rem] leading-4 text-ios-secondary/60">
                {time ? <div>{time}</div> : null}
                {loading || streaming ? (
                    <button
                        className="group inline-flex items-center gap-1 rounded-md px-2 py-1 text-ios-red hover:bg-ios-surface/60"
                        type="button"
                        onClick={onAbort}
                    >
                        <Icon
                            className="w-4 h-4 fill-current"
                            name="close"
                        />
                        Stop
                    </button>
                ) : null}
            </div>
        </div>
    );
};

export default Answer;
