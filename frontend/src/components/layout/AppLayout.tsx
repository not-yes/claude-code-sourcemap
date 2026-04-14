import { useCallback, useRef } from "react";
import { ChevronLeft } from "lucide-react";
import { MainNav } from "./MainNav";
import { ContentList } from "./ContentList";
import { ResizableDivider } from "./ResizableDivider";
import { MainContent } from "./MainContent";
import { AgentInfoDialog } from "@/components/agents/AgentInfoDialog";
import { RuntimePanel } from "@/components/runtime/RuntimePanel";
import { useAppStore } from "@/stores/appStore";
import { useAgents } from "@/hooks/useAgents";

export function AppLayout() {
  const agentInfoDialogOpenId = useAppStore(
    (s) => s.agentInfoDialogOpenId
  );
  const setAgentInfoDialogOpenId = useAppStore(
    (s) => s.setAgentInfoDialogOpenId
  );
  // RuntimePanel 暂停使用，保留订阅关系供后续恢复
  void useAppStore((s) => s.activeNav);
  void useAppStore((s) => s.selectedAgentId);
  const runtimePanelCollapsed = useAppStore((s) => s.runtimePanelCollapsed);
  const runtimePanelWidth = useAppStore((s) => s.runtimePanelWidth);
  const setRuntimePanelWidth = useAppStore((s) => s.setRuntimePanelWidth);
  const toggleRuntimePanel = useAppStore((s) => s.toggleRuntimePanel);
  const { agents } = useAgents();

  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleRuntimeDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWidthRef.current = runtimePanelWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handleMouseMove = (moveEvent: MouseEvent) => {
        // RuntimePanel 在分隔条左侧，向左拖动增大宽度
        const delta = moveEvent.clientX - startXRef.current;
        setRuntimePanelWidth(startWidthRef.current + delta);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [runtimePanelWidth, setRuntimePanelWidth]
  );

  const showRuntimePanel = false; // TODO: 暂停使用，恢复时改为 activeNav === "agents" && !!selectedAgentId;

  return (
    <div className="h-full min-h-0 flex flex-col bg-background">
      <div className="flex flex-1 min-h-0">
        <MainNav />
        <ContentList />
        <ResizableDivider />
        {showRuntimePanel && (
          <>
            {runtimePanelCollapsed ? (
              <button
                onClick={toggleRuntimePanel}
                className="flex items-center justify-center w-8 shrink-0 hover:bg-muted/70 border-l border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title="展开运行时面板"
                aria-label="展开运行时面板"
              >
                <ChevronLeft className="h-4 w-4 text-muted-foreground" />
              </button>
            ) : (
              <>
                <RuntimePanel />
                <div
                  role="separator"
                  aria-orientation="vertical"
                  className="w-px shrink-0 bg-border hover:bg-primary/30 cursor-col-resize flex-shrink-0 transition-colors"
                  onMouseDown={handleRuntimeDividerMouseDown}
                  style={{ touchAction: "none" }}
                />
              </>
            )}
          </>
        )}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          <MainContent />
        </main>
      </div>
      <AgentInfoDialog
        agent={
          agentInfoDialogOpenId === "main"
            ? { id: "main", name: "main", ext: "md" }
            : agents.find((a) => a.id === agentInfoDialogOpenId) ?? null
        }
        open={!!agentInfoDialogOpenId}
        onOpenChange={(open) => !open && setAgentInfoDialogOpenId(null)}
      />
    </div>
  );
}
