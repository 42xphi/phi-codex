"use client";

import * as React from "react";
import { PanelLeft, PanelRight, Settings2 } from "lucide-react";

import { useCodex } from "@/lib/codex";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ProjectsSidebar } from "@/components/codex/projects-sidebar";
import { ChatPanel } from "@/components/codex/chat-panel";
import { WorkspacePanel } from "@/components/codex/workspace-panel";
import { SettingsDialog } from "@/components/codex/settings-dialog";
import { ApprovalsDialog } from "@/components/codex/approvals-dialog";

export default function CodexApp() {
  const { approvals } = useCodex();

  const [leftOpen, setLeftOpen] = React.useState(false);
  const [rightOpen, setRightOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  return (
    <div className="h-dvh w-full">
      <div className="flex h-14 items-center gap-2 border-b border-border bg-card/60 px-3 backdrop-blur supports-[backdrop-filter]:bg-card/40 lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open projects"
          onClick={() => setLeftOpen(true)}
        >
          <PanelLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">Codex Remote</div>
          <div className="truncate text-xs text-muted-foreground">
            Your Mac-backed Codex assistant
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open workspace panel"
          onClick={() => setRightOpen(true)}
        >
          <PanelRight />
        </Button>
      </div>

      <div className="hidden h-[calc(100dvh-0px)] lg:block">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          <ResizablePanel defaultSize={22} minSize={18} maxSize={30}>
            <div className="h-full border-r border-border bg-card">
              <ProjectsSidebar onOpenSettings={() => setSettingsOpen(true)} />
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={54} minSize={40}>
            <div className="h-full bg-background">
              <ChatPanel onOpenSettings={() => setSettingsOpen(true)} />
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={24} minSize={18} maxSize={40}>
            <div className="h-full border-l border-border bg-card">
              <WorkspacePanel />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <div className="h-[calc(100dvh-3.5rem)] bg-background lg:hidden">
        <ChatPanel onOpenSettings={() => setSettingsOpen(true)} />
      </div>

      {/* Mobile drawers (simple overlays) */}
      {leftOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="h-full w-[22rem] max-w-[85vw] border-r border-border bg-card">
            <ProjectsSidebar
              onRequestClose={() => setLeftOpen(false)}
              onOpenSettings={() => {
                setLeftOpen(false);
                setSettingsOpen(true);
              }}
            />
          </div>
          <button
            className="flex-1 bg-black/40"
            aria-label="Close"
            onClick={() => setLeftOpen(false)}
            type="button"
          />
        </div>
      ) : null}

      {rightOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <button
            className="flex-1 bg-black/40"
            aria-label="Close"
            onClick={() => setRightOpen(false)}
            type="button"
          />
          <div className="h-full w-[24rem] max-w-[90vw] border-l border-border bg-card">
            <WorkspacePanel onRequestClose={() => setRightOpen(false)} />
          </div>
        </div>
      ) : null}

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ApprovalsDialog
        open={approvals.length > 0}
        onOpenChange={() => {
          /* approvals drive open state */
        }}
      />

      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-0 z-40 h-10 bg-gradient-to-t from-background to-transparent lg:hidden",
        )}
      />
    </div>
  );
}
