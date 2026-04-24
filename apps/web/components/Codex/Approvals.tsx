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
            classWrap="max-w-[48rem] md:min-h-screen-ios md:rounded-none"
            classButtonClose="hidden md:block md:absolute md:top-5 md:right-5 dark:fill-n-4"
            classOverlay="md:bg-n-1"
            visible={visible}
            onClose={() => respondApproval(current.requestId, "cancel")}
        >
            <div className="p-12 lg:px-8 md:pt-16 md:px-5 md:pb-8">
                <div className="flex items-start justify-between gap-6">
                    <div>
                        <div className="h4 text-n-7 dark:text-n-1">
                            Approval required
                        </div>
                        <div className="mt-2 body2 text-n-4">
                            {current.title}
                        </div>
                        <div className="mt-2 caption1 text-n-4/75">
                            Kind:{" "}
                            <span className="font-semibold text-n-7 dark:text-n-1">
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

                <div className="mt-8 rounded-xl border border-n-3 dark:border-n-5 overflow-hidden">
                    <div className="max-h-[50vh] overflow-auto bg-n-2 dark:bg-n-7">
                        <pre className="p-4 caption1 whitespace-pre-wrap break-words text-n-7 dark:text-n-1">
                            {current.detail}
                        </pre>
                    </div>
                </div>

                <div className="mt-8 flex flex-wrap gap-3 items-center">
                    <button
                        className="btn-blue btn-large"
                        onClick={() =>
                            respondApproval(current.requestId, "accept")
                        }
                        type="button"
                    >
                        Accept
                    </button>
                    <button
                        className="btn-stroke-light btn-large"
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
                        className="btn-stroke-light btn-large"
                        onClick={() =>
                            respondApproval(current.requestId, "decline")
                        }
                        type="button"
                    >
                        Decline
                    </button>
                    <button
                        className="btn-stroke-light btn-large"
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

