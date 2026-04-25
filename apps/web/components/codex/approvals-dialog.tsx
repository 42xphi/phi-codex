"use client";

import * as React from "react";

import { useCodex } from "@/lib/codex";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

type ApprovalsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ApprovalsDialog({ open, onOpenChange }: ApprovalsDialogProps) {
  const { approvals, respondApproval } = useCodex();

  // Open state is driven by approvals; ignore manual closes.
  const isOpen = open && approvals.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Approval required</DialogTitle>
          <DialogDescription>
            Codex is asking permission to proceed.
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-4 py-1">
            {approvals.map((a) => (
              <div
                key={a.requestId}
                className="rounded-lg border border-border bg-background p-4"
              >
                <div className="text-sm font-semibold">
                  {a.title || "Approval request"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{a.kind}</div>
                <pre className="mt-3 whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs leading-5 text-foreground">
                  {a.detail || ""}
                </pre>
                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => respondApproval(a.requestId, "decline")}
                  >
                    Decline
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => respondApproval(a.requestId, "acceptForSession")}
                  >
                    Allow session
                  </Button>
                  <Button
                    variant="default"
                    onClick={() => respondApproval(a.requestId, "accept")}
                  >
                    Allow
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

