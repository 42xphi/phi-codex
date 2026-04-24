import { usePathname } from "next/navigation";
import Link from "next/link";
import { twMerge } from "tailwind-merge";
import Icon from "@/components/Icon";

type NavigationType = {
    title: string;
    icon: string;
    color: string;
    url?: string;
    onClick?: () => void;
};

type NavigationProps = {
    visible?: boolean;
    items: NavigationType[];
};

const Navigation = ({ visible, items }: NavigationProps) => {
    const pathname = usePathname();

    return (
        <div className={`${visible && "px-2"}`}>
            {items.map((item, index) =>
                item.url ? (
                    <Link
                        className={twMerge(
                            `group flex items-center h-11 rounded-xl transition-colors ${
                                visible ? "px-3 justify-center" : "px-4"
                            } ${
                                pathname === item.url
                                    ? "bg-ios-surface2 text-ios-label"
                                    : "text-ios-secondary/80 hover:bg-ios-surface2 hover:text-ios-label"
                            }`
                        )}
                        href={item.url}
                        key={index}
                    >
                        <Icon className={twMerge("transition-colors", item.color)} name={item.icon} />
                        {!visible ? (
                            <div className="ml-4 text-[0.9rem] font-semibold">
                                {item.title}
                            </div>
                        ) : null}
                    </Link>
                ) : (
                    <button
                        className={twMerge(
                            "group flex items-center w-full h-11 rounded-xl transition-colors",
                            visible ? "px-3 justify-center" : "px-4",
                            "text-ios-secondary/80 hover:bg-ios-surface2 hover:text-ios-label",
                        )}
                        key={index}
                        onClick={item.onClick}
                        type="button"
                    >
                        <Icon className={twMerge("transition-colors", item.color)} name={item.icon} />
                        {!visible ? (
                            <div className="ml-4 text-[0.9rem] font-semibold">
                                {item.title}
                            </div>
                        ) : null}
                    </button>
                )
            )}
        </div>
    );
};

export default Navigation;
