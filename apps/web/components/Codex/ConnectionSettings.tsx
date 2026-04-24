import { useCodex } from "@/lib/codex";

type ConnectionSettingsProps = {
    onClose?: () => void;
};

const ConnectionSettings = ({ onClose }: ConnectionSettingsProps) => {
    const {
        connectionState,
        errorBanner,
        wsUrl,
        token,
        clientId,
        setWsUrl,
        setToken,
        setClientId,
        saveConnectionSettings,
        disconnect,
    } = useCodex();

    return (
        <div className="p-10 lg:px-8 md:pt-16 md:px-5 md:pb-8 text-ios-label">
            <div className="flex items-start justify-between gap-6">
                <div>
                    <div className="text-[1.25rem] leading-7 font-semibold">
                        Connection
                    </div>
                    <div className="mt-2 text-[0.95rem] leading-6 text-ios-secondary/60">
                        Connect this UI to your Mac-hosted Codex Remote WS
                        server.
                    </div>
                    <div className="mt-2 text-[0.75rem] leading-4 text-ios-secondary/60">
                        Tip: when served from your tunnel, WS URL is usually the
                        same origin (e.g. <span className="font-semibold">wss://ios.phi.pe</span>).
                    </div>
                </div>
                {onClose ? (
                    <button
                        className="inline-flex h-10 items-center justify-center rounded-xl border border-ios-separator/60 bg-ios-surface2 px-4 text-[0.9rem] font-semibold text-ios-label transition-colors hover:bg-ios-surface"
                        onClick={onClose}
                        type="button"
                    >
                        Close
                    </button>
                ) : null}
            </div>

            <div className="mt-10 space-y-6">
                <label className="block">
                    <div className="text-[0.75rem] leading-4 text-ios-secondary/60">WS URL</div>
                    <input
                        className="mt-2 w-full h-11 px-4 rounded-xl border border-ios-separator/60 bg-ios-surface2 text-[0.95rem] outline-none transition-shadow placeholder:text-ios-secondary/60 focus:shadow-[0_0_0_0.125rem_rgba(0,122,255,0.35)]"
                        placeholder="wss://ios.phi.pe"
                        value={wsUrl}
                        onChange={(e) => setWsUrl(e.target.value)}
                    />
                </label>

                <label className="block">
                    <div className="text-[0.75rem] leading-4 text-ios-secondary/60">Token</div>
                    <input
                        className="mt-2 w-full h-11 px-4 rounded-xl border border-ios-separator/60 bg-ios-surface2 text-[0.95rem] outline-none transition-shadow placeholder:text-ios-secondary/60 focus:shadow-[0_0_0_0.125rem_rgba(0,122,255,0.35)]"
                        placeholder="CODEX_REMOTE_TOKEN"
                        type="password"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                    />
                </label>

                <label className="block">
                    <div className="text-[0.75rem] leading-4 text-ios-secondary/60">Client ID</div>
                    <input
                        className="mt-2 w-full h-11 px-4 rounded-xl border border-ios-separator/60 bg-ios-surface2 text-[0.95rem] outline-none transition-shadow placeholder:text-ios-secondary/60 focus:shadow-[0_0_0_0.125rem_rgba(0,122,255,0.35)]"
                        placeholder="same on every device to sync"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                    />
                    <div className="mt-2 text-[0.75rem] leading-4 text-ios-secondary/60">
                        Use the same Client ID on multiple devices if you want
                        them to share the same “last active” Codex thread.
                    </div>
                </label>

                {errorBanner ? (
                    <div className="p-4 rounded-xl border border-ios-red/30 bg-ios-red/10 text-ios-red break-words">
                        {errorBanner}
                    </div>
                ) : null}

                <div className="flex flex-wrap gap-3 items-center">
                    <button
                        className="inline-flex h-12 items-center justify-center rounded-xl bg-ios-blue px-5 text-[0.9rem] font-semibold text-white shadow-[0_0.75rem_2rem_-1.5rem_rgba(0,0,0,0.35)] transition-opacity hover:opacity-90"
                        onClick={saveConnectionSettings}
                        type="button"
                    >
                        Save &amp; connect
                    </button>
                    <button
                        className="inline-flex h-12 items-center justify-center rounded-xl border border-ios-separator/60 bg-ios-surface2 px-5 text-[0.9rem] font-semibold text-ios-label transition-colors hover:bg-ios-surface"
                        onClick={disconnect}
                        type="button"
                    >
                        Disconnect
                    </button>
                    <div className="ml-auto text-[0.75rem] leading-4 text-ios-secondary/60">
                        Status:{" "}
                        <span className="font-semibold text-ios-label">
                            {connectionState}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ConnectionSettings;
