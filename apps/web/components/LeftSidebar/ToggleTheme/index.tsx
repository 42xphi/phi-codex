import { useColorMode } from "@chakra-ui/color-mode";
import { twMerge } from "tailwind-merge";
import Icon from "@/components/Icon";

type ToggleThemeProps = {
    visible?: boolean;
};

const ToggleTheme = ({ visible }: ToggleThemeProps) => {
    const { colorMode, setColorMode } = useColorMode();

    const items = [
        {
            title: "Light",
            icon: "sun",
            active: colorMode === "light",
            onClick: () => setColorMode("light"),
        },
        {
            title: "Dark",
            icon: "moon",
            active: colorMode === "dark",
            onClick: () => setColorMode("dark"),
        },
    ];

    return (
        <div
            className={`${
                !visible &&
                `relative flex w-full p-1 rounded-xl border border-ios-separator/60 bg-ios-surface2 before:absolute before:left-1 before:top-1 before:bottom-1 before:w-[calc(50%-0.25rem)] before:bg-ios-surface before:rounded-[0.625rem] before:transition-all ${
                    colorMode === "dark" && "before:translate-x-full"
                }`
            }`}
        >
            {items.map((item, index) => (
                <button
                    className={twMerge(
                        `relative z-1 group flex justify-center items-center ${
                            visible
                                ? `flex w-full h-16 rounded-xl bg-ios-surface2 md:w-8 md:h-8 md:mx-auto ${
                                      item.active && "hidden"
                                  }`
                                : `h-10 basis-1/2 text-[0.85rem] font-semibold text-ios-secondary/70 transition-colors hover:text-ios-label ${
                                      item.active && "text-ios-label"
                                  }`
                        }`
                    )}
                    key={index}
                    onClick={item.onClick}
                    type="button"
                >
                    <Icon
                        className={`fill-current text-ios-secondary/70 transition-colors group-hover:text-ios-label ${
                            !visible && "mr-3"
                        } ${item.active && !visible && "text-ios-label"}`}
                        name={item.icon}
                    />
                    {!visible && item.title}
                </button>
            ))}
        </div>
    );
};

export default ToggleTheme;
