import { useState, useEffect } from "react";
import MediaQuery from "react-responsive";

type BurgerProps = {
    className?: string;
    onClick: () => void;
    visibleRightSidebar: boolean;
};

const Burger = ({ className, onClick, visibleRightSidebar }: BurgerProps) => {
    const [mounted, setMounted] = useState<boolean>(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    return mounted ? (
        <MediaQuery maxWidth={1023}>
            <button
                className={`relative z-[25] shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-full border border-ios-separator/60 bg-ios-surface/80 backdrop-blur supports-[backdrop-filter]:bg-ios-surface/60 shadow-[0_0.75rem_2rem_-1.5rem_rgba(0,0,0,0.35)] tap-highlight-color md:absolute md:m-0 ${
                    visibleRightSidebar && "md:!fixed"
                } ${className}`}
                onClick={onClick}
                type="button"
                aria-label={visibleRightSidebar ? "Close workspace panel" : "Open workspace panel"}
                style={{
                    top: "calc(env(safe-area-inset-top) + 0.75rem)",
                    right: "calc(env(safe-area-inset-right) + 0.75rem)",
                }}
            >
                <div className="flex flex-col items-center justify-center">
                <span
                    className={`w-5 h-0.5 my-0.5 bg-ios-label/80 rounded-full transition-all ${
                        visibleRightSidebar && "translate-y-0.75 rotate-45"
                    }`}
                ></span>
                <span
                    className={`w-5 h-0.5 my-0.5 bg-ios-label/80 rounded-full transition-all ${
                        visibleRightSidebar && "-translate-y-0.75 -rotate-45"
                    }`}
                ></span>
                </div>
            </button>
        </MediaQuery>
    ) : null;
};

export default Burger;
