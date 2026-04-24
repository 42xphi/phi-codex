import { useEffect, useState } from "react";
import Link from "next/link";
import { twMerge } from "tailwind-merge";
import { enablePageScroll, clearQueueScrollLocks } from "scroll-lock";
import Head from "next/head";
import { useMediaQuery } from "react-responsive";
import LeftSidebar from "@/components/LeftSidebar";
import RightSidebar from "@/components/RightSidebar";
import Icon from "@/components/Icon";
import Burger from "./Burger";

type LayoutProps = {
    smallSidebar?: boolean;
    hideRightSidebar?: boolean;
    backUrl?: string;
    children: React.ReactNode;
};

const Layout = ({
    smallSidebar,
    hideRightSidebar,
    backUrl,
    children,
}: LayoutProps) => {
    const [visibleSidebar, setVisibleSidebar] = useState<any>(
        smallSidebar || false
    );
    const [leftDrawerOpen, setLeftDrawerOpen] = useState<boolean>(false);
    const [visibleRightSidebar, setVisibleRightSidebar] =
        useState<boolean>(false);

    const isDesktop = useMediaQuery({
        query: "(max-width: 1179px)",
    });
    const isPhone = useMediaQuery({
        query: "(max-width: 767px)",
    });

    const handleClickOverlay = () => {
        setLeftDrawerOpen(false);
        setVisibleRightSidebar(false);
        clearQueueScrollLocks();
        enablePageScroll();
    };

    useEffect(() => {
        if (isPhone) {
            setVisibleSidebar(false);
            return;
        }
        setVisibleSidebar(smallSidebar || isDesktop);
    }, [isDesktop, isPhone, smallSidebar]);

    return (
        <>
            <Head>
                <title>Codex Remote</title>
            </Head>
            <div
                className={`bg-ios-bg text-ios-label pr-6 md:pr-0 md:overflow-hidden ${
                    visibleSidebar
                        ? "pl-24 md:pl-0"
                        : smallSidebar
                        ? "pl-24 md:pl-0"
                        : "pl-80 xl:pl-24 md:pl-0"
                }`}
            >
                {!isPhone || leftDrawerOpen ? (
                    <LeftSidebar
                        value={visibleSidebar}
                        setValue={setVisibleSidebar}
                        smallSidebar={smallSidebar}
                        onRequestClose={isPhone ? () => setLeftDrawerOpen(false) : undefined}
                    />
                ) : null}
                <div
                    className={`flex py-6 md:py-0 ${
                        hideRightSidebar
                            ? "min-h-screen min-h-screen-ios"
                            : "h-screen h-screen-ios"
                    }`}
                >
                    <div
                        className={`relative flex grow max-w-full bg-ios-surface rounded-[1.25rem] border border-ios-separator/60 shadow-[0_0.75rem_2rem_-1.25rem_rgba(0,0,0,0.35)] md:rounded-none md:border-0 md:shadow-none ${
                            !hideRightSidebar &&
                            "pr-[22.5rem] 2xl:pr-80 lg:pr-0"
                        }`}
                    >
                        <div
                            className={`relative flex flex-col grow max-w-full ${
                                !hideRightSidebar && "md:pt-18"
                            }`}
                        >
                            {!hideRightSidebar && (
                                <Burger
                                    visibleRightSidebar={visibleRightSidebar}
                                    onClick={() =>
                                        setVisibleRightSidebar(
                                            !visibleRightSidebar
                                        )
                                    }
                                />
                            )}
                            {isPhone ? (
                                <button
                                    className="relative z-[25] shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-full border border-ios-separator/60 bg-ios-surface/80 backdrop-blur supports-[backdrop-filter]:bg-ios-surface/60 shadow-[0_0.75rem_2rem_-1.5rem_rgba(0,0,0,0.35)] tap-highlight-color md:absolute md:m-0"
                                    onClick={() => setLeftDrawerOpen(!leftDrawerOpen)}
                                    type="button"
                                    aria-label={leftDrawerOpen ? "Close threads" : "Open threads"}
                                    style={{
                                        top: "calc(env(safe-area-inset-top) + 0.75rem)",
                                        left: "calc(env(safe-area-inset-left) + 0.75rem)",
                                    }}
                                >
                                    <Icon
                                        className="fill-current text-ios-secondary/70 transition-colors hover:text-ios-blue"
                                        name={leftDrawerOpen ? "close" : "container"}
                                    />
                                </button>
                            ) : null}
                            {hideRightSidebar && smallSidebar && (
                                <Link
                                    className="absolute top-6 right-6 flex justify-center items-center w-10 h-10 border border-ios-separator/60 rounded-full text-0 transition-colors hover:bg-ios-surface2"
                                    href={backUrl || "/"}
                                >
                                    <Icon className="fill-current text-ios-secondary/70" name="close" />
                                </Link>
                            )}
                            {children}
                        </div>
                        {!hideRightSidebar && (
                            <RightSidebar
                                visible={visibleRightSidebar}
                            />
                        )}
                    </div>
                </div>
                <div
                    className={twMerge(
                        `fixed inset-0 z-10 bg-black/40 transition-opacity ${
                            leftDrawerOpen || visibleRightSidebar
                                ? "visible opacity-100"
                                : "invisible opacity-0 pointer-events-none"
                        }`
                    )}
                    onClick={handleClickOverlay}
                ></div>
            </div>
        </>
    );
};

export default Layout;
