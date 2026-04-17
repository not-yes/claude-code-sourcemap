import { cn } from "@/lib/utils";

interface CompactingIndicatorProps {
  contextPercent?: number;
  compacting?: boolean;
  className?: string;
}

// 定义在组件外部，避免每次渲染创建新函数
function CompactDot() {
  return (
    <span className="inline-flex gap-0.5">
      <span className="animate-compact-dot size-1 rounded-full bg-primary" style={{ animationDelay: "0ms" }} />
      <span className="animate-compact-dot size-1 rounded-full bg-primary" style={{ animationDelay: "200ms" }} />
      <span className="animate-compact-dot size-1 rounded-full bg-primary" style={{ animationDelay: "400ms" }} />
    </span>
  );
}

export function CompactingIndicator({ contextPercent, compacting, className }: CompactingIndicatorProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 py-1.5 px-3 rounded-full",
        "bg-muted/60 backdrop-blur-sm border border-border/40",
        "animate-fade-in-up",
        className
      )}
    >
      {contextPercent !== undefined && (
        <span className="text-xs text-muted-foreground">
          Context: <span className="text-primary font-medium">{contextPercent}%</span>
        </span>
      )}
      {compacting && (
        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
          compacting
          <CompactDot />
        </span>
      )}
    </div>
  );
}
