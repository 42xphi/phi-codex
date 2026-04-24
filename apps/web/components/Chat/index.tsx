type ChatProps = {
    title: string;
    subtitle?: string;
    children: React.ReactNode;
};

const Chat = ({ title, subtitle, children }: ChatProps) => {
    return (
        <>
            <div
                className="flex items-center min-h-14 px-10 py-3 border-b border-ios-separator/60 bg-ios-surface/80 backdrop-blur supports-[backdrop-filter]:bg-ios-surface/60 2xl:px-6 md:px-4"
                style={{ paddingTop: "env(safe-area-inset-top)" }}
            >
                <div className="mr-auto min-w-0">
                    <div className="text-[0.95rem] font-semibold text-ios-label truncate">
                        {title}
                    </div>
                    {subtitle ? (
                        <div className="mt-0.5 text-[0.75rem] leading-4 text-ios-secondary/60 truncate">
                            {subtitle}
                        </div>
                    ) : null}
                </div>
            </div>
            <div className="relative z-2 grow px-10 py-8 space-y-6 overflow-y-auto scroll-smooth scrollbar-none bg-ios-bg 2xl:px-6 md:px-4 md:py-6">
                {children}
            </div>
        </>
    );
};

export default Chat;
