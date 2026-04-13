import { memo, useEffect, useRef } from "react";
import {
  PanelLeftClose,
  Brain,
  Wrench,
  CheckCircle2,
  XCircle,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { useRuntimePanelStore } from "@/stores/runtimePanelStore";
import type { RuntimeLogEntry } from "@/stores/runtimePanelStore";
import { MarkdownContent } from "@/components/chat/MarkdownContent";

// ─── LogEntryRenderer ────────────────────────────────────────────────────────

const LogEntryRenderer = memo(function LogEntryRenderer({
  entry,
}: {
  entry: RuntimeLogEntry;
}) {
  switch (entry.type) {
    case "thinking":
      return (
        <div className="text-sm">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
            <Brain className="h-3.5 w-3.5 shrink-0" />
            <span className="text-xs font-medium">Thinking</span>
          </div>
          <div className="pl-5 text-muted-foreground italic text-xs">
            <MarkdownContent content={entry.content || ""} />
          </div>
        </div>
      );

    case "text":
      return (
        <div className="text-sm">
          <MarkdownContent content={entry.content || ""} />
        </div>
      );

    case "tool_use":
      return (
        <div className="text-sm border border-border rounded-md p-2 bg-muted/50">
          <div className="flex items-center gap-1.5 mb-1">
            <Wrench className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="font-mono text-xs font-medium truncate">
              {entry.toolName}
            </span>
          </div>
          <pre className="text-xs text-muted-foreground overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap break-all">
            {JSON.stringify(entry.input, null, 2)}
          </pre>
        </div>
      );

    case "tool_result":
      return (
        <div
          className={cn(
            "text-sm border rounded-md p-2",
            entry.isError
              ? "border-destructive/30 bg-destructive/5"
              : "border-border bg-muted/50"
          )}
        >
          <div className="flex items-center gap-1.5 mb-1">
            {entry.isError ? (
              <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
            )}
            <span className="font-mono text-xs truncate">
              {entry.toolName ? `${entry.toolName} result` : "tool result"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground max-h-48 overflow-y-auto">
            <MarkdownContent content={entry.result || ""} />
          </div>
        </div>
      );

    case "system":
      return (
        <div className="text-xs text-muted-foreground flex items-start gap-1.5 py-1">
          <Info className="h-3 w-3 shrink-0 mt-0.5" />
          <span className="break-words">{entry.content}</span>
        </div>
      );

    case "context_compact":
      return (
        <div className="text-xs text-muted-foreground py-1 text-center">
          Context compacted: {entry.preTokenCount} → {entry.postTokenCount}{" "}
          tokens
        </div>
      );

    case "complete":
      return (
        <div className="text-xs text-muted-foreground py-1 text-center border-t border-border mt-1 pt-2">
          完成
          {entry.reason ? ` (${entry.reason})` : ""}
          {entry.usage?.inputTokens !== undefined &&
          entry.usage?.outputTokens !== undefined
            ? ` — in: ${entry.usage.inputTokens}, out: ${entry.usage.outputTokens}`
            : ""}
        </div>
      );

    default:
      return null;
  }
});

// ─── RuntimePanel ────────────────────────────────────────────────────────────

export const RuntimePanel = memo(function RuntimePanel() {
  const runtimePanelWidth = useAppStore((s) => s.runtimePanelWidth);
  const toggleRuntimePanel = useAppStore((s) => s.toggleRuntimePanel);
  const logEntries = useRuntimePanelStore((s) => s.logEntries);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部（新日志到达时）
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logEntries.length]);

  return (
    <aside
      className="flex flex-col h-full overflow-hidden bg-muted/50 dark:bg-muted/50"
      style={{ width: runtimePanelWidth, transition: "width 200ms ease-out" }}
    >
      {/* 头部：标题 + 收起按钮 */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-sm font-medium text-foreground">执行过程</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={toggleRuntimePanel}
          title="收起面板"
        >
          <PanelLeftClose size={15} />
        </Button>
      </div>

      {/* 日志流 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-2"
      >
        {logEntries.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            等待执行...
          </div>
        ) : (
          logEntries.map((entry) => (
            <LogEntryRenderer key={entry.id} entry={entry} />
          ))
        )}
      </div>
    </aside>
  );
});
