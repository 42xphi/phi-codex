import Image from "@/components/Image";
import Icon from "@/components/Icon";

type QuestionProps = {
    content: React.ReactNode;
    time?: string;
    image?: string;
    document?: string;
};

const Question = ({ content, time, image, document }: QuestionProps) => (
    <div className="flex justify-end">
        <div className="w-full max-w-[50rem]">
            <div className="ml-auto w-fit max-w-full rounded-[1.25rem] bg-ios-blue px-4 py-3 text-white shadow-[0_0.5rem_1.5rem_-1rem_rgba(0,0,0,0.35)]">
                {document ? (
                    <div className="mb-3 inline-flex max-w-full items-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-[0.85rem] font-semibold text-white">
                        <Icon className="w-4 h-4 fill-current" name="file" />
                        <span className="truncate">{document}</span>
                    </div>
                ) : null}
                <div className="text-[0.95rem] leading-6 whitespace-pre-wrap break-words">
                    {content}
                </div>
                {image ? (
                    <div className="mt-3">
                        <div className="relative w-[11.25rem] h-[11.25rem] overflow-hidden rounded-[1rem] border border-white/20">
                            <Image
                                className="object-cover"
                                src={image}
                                fill
                                alt="Attachment"
                            />
                        </div>
                    </div>
                ) : null}
            </div>
            {time ? (
                <div className="mt-1 pr-1 text-right text-[0.7rem] leading-4 text-ios-secondary/60">
                    {time}
                </div>
            ) : null}
        </div>
    </div>
);

export default Question;
