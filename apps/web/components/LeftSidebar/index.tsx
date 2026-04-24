import { useState, useEffect } from "react";
import { disablePageScroll, enablePageScroll } from "scroll-lock";
import Logo from "@/components/Logo";
import Icon from "@/components/Icon";
import Modal from "@/components/Modal";
import ConnectionSettings from "@/components/Codex/ConnectionSettings";
import Navigation from "./Navigation";
import ChatList from "./ChatList";
import Profile from "./Profile";
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
    const { startThread, activeCwd } = useCodex();

    useEffect(() => {
        return () => {};
    }, []);

    const navigation = [
        {
            title: "New chat",
            icon: "plus-circle",
            color: "fill-primary-2",
            onClick: () => startThread({ cwd: activeCwd ?? undefined }),
        },
        {
            title: "Reconnect",
            icon: "arrow-up",
            color: "fill-accent-2",
            onClick: () => setVisibleSettings(true),
        },
        {
            title: "Settings",
            icon: "settings",
            color: "fill-accent-3",
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
                    `fixed z-20 top-0 left-0 bottom-0 flex flex-col pt-30 px-4 bg-n-7 ${
                        value
                            ? "w-24 pb-38 md:w-16 md:px-0 md:pb-30"
                            : "w-80 pb-58"
                    } md:top-4 md:bottom-4 md:left-4 md:right-4 md:w-[calc(100%-2rem)] md:rounded-[1.25rem] md:shadow-2xl`
                )}
            >
                <div
                    className={`absolute top-0 right-0 left-0 flex items-center h-30 pl-7 pr-6 ${
                        value ? "justify-center md:px-4" : "justify-between"
                    }`}
                >
                    {!value && <Logo />}
                    <button
                        className="group tap-highlight-color"
                        onClick={handleClick}
                    >
                        <Icon
                            className="fill-n-4 transition-colors group-hover:fill-n-3"
                            name={value ? "toggle-on" : "toggle-off"}
                        />
                    </button>
                    {onRequestClose ? (
                        <button
                            className="absolute top-6 right-6 flex justify-center items-center w-10 h-10 border-2 border-n-4/25 rounded-full text-0 transition-colors hover:border-transparent hover:bg-n-4/25"
                            onClick={onRequestClose}
                            type="button"
                        >
                            <Icon className="fill-n-4" name="close" />
                        </button>
                    ) : null}
                </div>
                <div className="grow overflow-y-auto scroll-smooth scrollbar-none">
                    <Navigation visible={value} items={navigation} />
                    <div
                        className={`my-4 h-0.25 bg-n-6 ${
                            value ? "-mx-4 md:mx-0" : "-mx-2 md:mx-0"
                        }`}
                    ></div>
                    <ChatList
                        visible={value}
                        onOpenSettings={() => setVisibleSettings(true)}
                        onCloseSidebar={onRequestClose}
                    />
                </div>
                <div className="absolute left-0 bottom-0 right-0 pb-6 px-4 bg-n-7 before:absolute before:left-0 before:right-0 before:bottom-full before:h-10 before:bg-gradient-to-t before:from-[#131617] before:to-[rgba(19,22,23,0)] before:pointer-events-none md:px-3">
                    <Profile visible={value} />
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
