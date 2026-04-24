"use client";

import Modal from "@/components/Modal";
import { useCodex } from "@/lib/codex";

const Approvals = () => {
    const { approvals, respondApproval } = useCodex();
    const current = approvals[0];
    const visible = approvals.length > 0;

    if (!current) return null;

    return (
        <Modal
            className="md:!p-0"
            classWrap="max-w-[48rem] rounded-[1.25rem] bg-ios-surface border border-ios-separator/60 shadow-[0_1.5rem_4rem_-2.5rem_rgba(0,0,0,0.45)] md:min-h-screen-ios md:rounded-none"
            classButtonClose="hidden md:block md:absolute md:top-5 md:right-5"
            classOverlay="bg-black/40 backdrop-blur-sm"
            visible={visible}
            onClose={() => respondApproval(current.requestId, "cancel")}
        >
            <div className="p-10 lg:px-8 md:pt-16 md:px-5 md:pb-8">
                <div className="flex items-start justify-between gap-6">
                    <div>
                        <div className="text-[1.25rem] leading-7 font-semibold text-ios-label">
                            Approval required
                        </div>
                        <div className="mt-2 text-[0.95rem] leading-6 text-ios-secondary/60">
                            {current.title}
                        </div>
                        <div className="mt-2 text-[0.75rem] leading-4 text-ios-secondary/60">
                            Kind:{" "}
                            <span className="font-semibold text-ios-label">
                                {current.kind}
                            </span>
                            {approvals.length > 1 ? (
                                <>
                                    {" "}
                                    · {approvals.length - 1} queued
                                </>
                            ) : null}
                        </div>
                    </div>
                </div>

                <div className="mt-8 rounded-xl border border-ios-separator/60 overflow-hidden">
                    <div className="max-h-[50vh] overflow-auto bg-ios-surface2">
                        <pre className="p-4 text-[0.75rem] leading-5 whitespace-pre-wrap break-words text-ios-label">
                            {current.detail}
                        </pre>
                    </div>
                </div>

                <div className="mt-8 flex flex-wrap gap-3 items-center">
                    <button
                        className="inline-flex h-12 items-center justify-center rounded-xl bg-ios-blue px-5 text-[0.9rem] font-semibold text-white shadow-[0_0.75rem_2rem_-1.5rem_rgba(0,0,0,0.35)] transition-opacity hover:opacity-90"
                        onClick={() =>
                            respondApproval(current.requestId, "accept")
                        }
                        type="button"
                    >
                        Accept
                    </button>
                    <button
                        className="inline-flex h-12 items-center justify-center rounded-xl border border-ios-separator/60 bg-ios-surface2 px-5 text-[0.9rem] font-semibold text-ios-label transition-colors hover:bg-ios-surface"
                        onClick={() =>
                            respondApproval(
                                current.requestId,
                                "acceptForSession"
                            )
                        }
                        type="button"
                    >
                        Accept for session
                    </button>
                    <button
                        className="inline-flex h-12 items-center justify-center rounded-xl border border-ios-red/30 bg-ios-red/10 px-5 text-[0.9rem] font-semibold text-ios-red transition-colors hover:bg-ios-red/15"
                        onClick={() =>
                            respondApproval(current.requestId, "decline")
                        }
                        type="button"
                    >
                        Decline
                    </button>
                    <button
                        className="inline-flex h-12 items-center justify-center rounded-xl border border-ios-separator/60 bg-ios-surface2 px-5 text-[0.9rem] font-semibold text-ios-label transition-colors hover:bg-ios-surface"
                        onClick={() =>
                            respondApproval(current.requestId, "cancel")
                        }
                        type="button"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default Approvals;
