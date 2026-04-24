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
                className={`pr-6 bg-n-7 md:p-0 md:bg-n-1 dark:md:bg-n-6 md:overflow-hidden ${
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
                        className={`relative flex grow max-w-full bg-n-1 rounded-[1.25rem] md:rounded-none dark:bg-n-6 ${
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
                                    className="relative z-[25] shrink-0 flex items-center justify-center w-8 h-8 my-5 mr-auto ml-6 tap-highlight-color md:absolute md:top-5 md:left-4 md:m-0"
                                    onClick={() => setLeftDrawerOpen(!leftDrawerOpen)}
                                    type="button"
                                >
                                    <Icon
                                        className="fill-n-4 transition-colors hover:fill-primary-1"
                                        name={leftDrawerOpen ? "close" : "container"}
                                    />
                                </button>
                            ) : null}
                            {hideRightSidebar && smallSidebar && (
                                <Link
                                    className="absolute top-6 right-6 flex justify-center items-center w-10 h-10 border-2 border-n-4/25 rounded-full text-0 transition-colors hover:border-transparent hover:bg-n-4/25"
                                    href={backUrl || "/"}
                                >
                                    <Icon className="fill-n-4" name="close" />
                                </Link>
                            )}
                            {children}
                        </div>
                        {!hideRightSidebar && (
                            <RightSidebar
                                className={`
                                ${
                                    !visibleSidebar &&
                                    "md:translate-x-64 md:before:absolute md:before:z-30 md:before:inset-0"
                                }
                            `}
                                visible={visibleRightSidebar}
                            />
                        )}
                    </div>
                </div>
                <div
                    className={twMerge(
                        `fixed inset-0 z-10 bg-n-7/80 transition-opacity ${
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
