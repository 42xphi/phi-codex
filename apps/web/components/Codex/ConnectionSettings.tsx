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
        <div className="p-12 lg:px-8 md:pt-16 md:px-5 md:pb-8">
            <div className="flex items-start justify-between gap-6">
                <div>
                    <div className="h4 text-n-7 dark:text-n-1">
                        Connection
                    </div>
                    <div className="mt-2 body2 text-n-4">
                        Connect this UI to your Mac-hosted Codex Remote WS
                        server.
                    </div>
                    <div className="mt-2 caption1 text-n-4/75">
                        Tip: when served from your tunnel, WS URL is usually the
                        same origin (e.g. <span className="font-semibold">wss://ios.phi.pe</span>).
                    </div>
                </div>
                {onClose ? (
                    <button
                        className="btn-stroke-light btn-medium"
                        onClick={onClose}
                        type="button"
                    >
                        Close
                    </button>
                ) : null}
            </div>

            <div className="mt-10 space-y-6">
                <label className="block">
                    <div className="caption1 text-n-4">WS URL</div>
                    <input
                        className="mt-2 w-full h-11 px-4 bg-transparent shadow-[inset_0_0_0_0.0625rem_#DADBDC] rounded-xl outline-none body2 text-n-7 transition-shadow focus:shadow-[inset_0_0_0_0.125rem_#0084FF] placeholder:text-n-4 dark:shadow-[inset_0_0_0_0.0625rem_#2A2E2F] dark:text-n-1 dark:focus:shadow-[inset_0_0_0_0.125rem_#0084FF]"
                        placeholder="wss://ios.phi.pe"
                        value={wsUrl}
                        onChange={(e) => setWsUrl(e.target.value)}
                    />
                </label>

                <label className="block">
                    <div className="caption1 text-n-4">Token</div>
                    <input
                        className="mt-2 w-full h-11 px-4 bg-transparent shadow-[inset_0_0_0_0.0625rem_#DADBDC] rounded-xl outline-none body2 text-n-7 transition-shadow focus:shadow-[inset_0_0_0_0.125rem_#0084FF] placeholder:text-n-4 dark:shadow-[inset_0_0_0_0.0625rem_#2A2E2F] dark:text-n-1 dark:focus:shadow-[inset_0_0_0_0.125rem_#0084FF]"
                        placeholder="CODEX_REMOTE_TOKEN"
                        type="password"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                    />
                </label>

                <label className="block">
                    <div className="caption1 text-n-4">Client ID</div>
                    <input
                        className="mt-2 w-full h-11 px-4 bg-transparent shadow-[inset_0_0_0_0.0625rem_#DADBDC] rounded-xl outline-none body2 text-n-7 transition-shadow focus:shadow-[inset_0_0_0_0.125rem_#0084FF] placeholder:text-n-4 dark:shadow-[inset_0_0_0_0.0625rem_#2A2E2F] dark:text-n-1 dark:focus:shadow-[inset_0_0_0_0.125rem_#0084FF]"
                        placeholder="same on every device to sync"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                    />
                    <div className="mt-2 caption1 text-n-4/75">
                        Use the same Client ID on multiple devices if you want
                        them to share the same “last active” Codex thread.
                    </div>
                </label>

                {errorBanner ? (
                    <div className="p-4 rounded-xl border border-accent-1/50 bg-accent-1/10 text-accent-1">
                        {errorBanner}
                    </div>
                ) : null}

                <div className="flex flex-wrap gap-3 items-center">
                    <button
                        className="btn-blue btn-large"
                        onClick={saveConnectionSettings}
                        type="button"
                    >
                        Save &amp; connect
                    </button>
                    <button
                        className="btn-stroke-light btn-large"
                        onClick={disconnect}
                        type="button"
                    >
                        Disconnect
                    </button>
                    <div className="ml-auto caption1 text-n-4/75">
                        Status:{" "}
                        <span className="font-semibold text-n-7 dark:text-n-1">
                            {connectionState}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ConnectionSettings;

