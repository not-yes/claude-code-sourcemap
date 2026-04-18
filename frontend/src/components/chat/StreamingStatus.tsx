import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface StreamingStatusProps {
  startTime: number;
  tokenEstimate: number;
  className?: string;
}

/**
 * 格式化时长显示
 * 不到1分钟显示 "Xs"，超过1分钟显示 "Xm Ys"
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.floor(seconds)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}

/**
 * 格式化 token 数量
 * 超过1000显示 "Xk"，否则显示数字
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
}

/**
 * 流式传输状态指示器
 * 显示运行时长、估算 token 数量
 */
export function StreamingStatus({ startTime, tokenEstimate, className }: StreamingStatusProps) {
  const [elapsed, setElapsed] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // 使用 requestAnimationFrame 更新，避免 setInterval 的时间漂移
    const updateElapsed = () => {
      setElapsed((Date.now() - startTime) / 1000);
      rafRef.current = requestAnimationFrame(updateElapsed);
    };

    // 初始更新
    setElapsed((Date.now() - startTime) / 1000);
    rafRef.current = requestAnimationFrame(updateElapsed);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [startTime]);

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 py-1 px-2.5 rounded-full",
        "bg-muted/60 backdrop-blur-sm border border-border/40",
        "text-xs text-muted-foreground",
        "animate-fade-in-up",
        className
      )}
    >
      {/* 运行时长 */}
      <span className="font-medium tabular-nums">
        {formatDuration(elapsed)}
      </span>

      {/* 分隔符 */}
      <span className="opacity-50">·</span>

      {/* Token 数量 */}
      <span className="tabular-nums">
        <span className="opacity-70">↓</span> {formatTokens(tokenEstimate)} tokens
      </span>

      {/* 加载动画点 */}
      <span className="inline-flex gap-0.5 ml-1">
        <span className="animate-pulse size-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "0ms" }} />
        <span className="animate-pulse size-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "150ms" }} />
        <span className="animate-pulse size-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: "300ms" }} />
      </span>
    </div>
  );
}
