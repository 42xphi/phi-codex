import { useState, useEffect } from "react";
import { disablePageScroll, enablePageScroll } from "scroll-lock";
import Icon from "@/components/Icon";
import Modal from "@/components/Modal";
import ConnectionSettings from "@/components/Codex/ConnectionSettings";
import Navigation from "./Navigation";
import ChatList from "./ChatList";
import ToggleTheme from "./ToggleTheme";

import { useCodex } from "@/lib/codex";
import { twMerge } from "tailwind-merge";

type LeftSidebarProps = {
    value: boolean;
    setValue?: any;
    smallSidebar?: boolean;
    onRequestClose?: () => void;
};

const LeftSidebar = ({
    value,
    setValue,
    smallSidebar,
    onRequestClose,
}: LeftSidebarProps) => {
    const [visibleSettings, setVisibleSettings] = useState<boolean>(false);
    const { startThread } = useCodex();

    useEffect(() => {
        return () => {};
    }, []);

    const navigation = [
        {
            title: "New chat",
            icon: "plus-circle",
            color: "fill-current text-ios-blue",
            onClick: () => startThread(),
        },
        {
            title: "Reconnect",
            icon: "arrow-up",
            color: "fill-current text-ios-secondary/70",
            onClick: () => setVisibleSettings(true),
        },
        {
            title: "Settings",
            icon: "settings",
            color: "fill-current text-ios-secondary/70",
            onClick: () => setVisibleSettings(true),
        },
    ];

    const handleClick = () => {
        setValue(!value);
        smallSidebar && value ? disablePageScroll() : enablePageScroll();
    };

    return (
        <>
            <div
                className={twMerge(
                    `fixed z-20 top-0 left-0 bottom-0 flex flex-col pt-16 px-4 bg-ios-surface border-r border-ios-separator/60 ${
                        value
                            ? "w-24 pb-38 md:w-16 md:px-0 md:pb-30"
                            : "w-80 pb-58"
                    } md:top-4 md:bottom-4 md:left-4 md:right-4 md:w-[calc(100%-2rem)] md:rounded-[1.25rem] md:shadow-2xl`
                )}
            >
                <div
                    className={`absolute top-0 right-0 left-0 flex items-center h-16 pl-6 pr-6 border-b border-ios-separator/60 ${
                        value ? "justify-center md:px-4" : "justify-between"
                    }`}
                >
                    {!value ? (
                        <div className="text-[0.95rem] font-semibold text-ios-label">
                            Codex
                        </div>
                    ) : null}
                    <button
                        className="group tap-highlight-color"
                        onClick={handleClick}
                    >
                        <Icon
                            className="fill-current text-ios-secondary/70 transition-colors group-hover:text-ios-label"
                            name={value ? "toggle-on" : "toggle-off"}
                        />
                    </button>
                    {onRequestClose ? (
                        <button
                            className="absolute top-3 right-3 flex justify-center items-center w-10 h-10 border border-ios-separator/60 rounded-full text-0 transition-colors hover:bg-ios-surface2"
                            onClick={onRequestClose}
                            type="button"
                        >
                            <Icon className="fill-current text-ios-secondary/70" name="close" />
                        </button>
                    ) : null}
                </div>
                <div className="grow overflow-y-auto scroll-smooth scrollbar-none">
                    <Navigation visible={value} items={navigation} />
                    <div
                        className={`my-4 h-px bg-ios-separator/60 ${
                            value ? "-mx-4 md:mx-0" : "-mx-2 md:mx-0"
                        }`}
                    ></div>
                    <ChatList
                        visible={value}
                        onOpenSettings={() => setVisibleSettings(true)}
                        onCloseSidebar={onRequestClose}
                    />
                </div>
                <div
                    className="absolute left-0 bottom-0 right-0 pb-6 px-4 bg-ios-surface border-t border-ios-separator/60 md:px-3"
                    style={{
                        paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)",
                    }}
                >
                    <ToggleTheme visible={value} />
                </div>
            </div>
            <Modal
                className="md:!p-0"
                classWrap="max-w-[48rem] md:min-h-screen-ios md:rounded-none"
                classButtonClose="hidden md:block md:absolute md:top-5 md:right-5 dark:fill-n-4"
                classOverlay="md:bg-n-1"
                visible={visibleSettings}
                onClose={() => setVisibleSettings(false)}
            >
                <ConnectionSettings onClose={() => setVisibleSettings(false)} />
            </Modal>
        </>
    );
};

export default LeftSidebar;
