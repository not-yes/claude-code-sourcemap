import { useState } from "react";
import { CheckCircle2, Circle, ChevronDown, ChevronRight, ClipboardList, Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface TaskItem {
  status: "pending" | "in_progress" | "completed" | "failed";
  content: string;
  activeForm?: string;
}

interface TaskResult {
  tasks: TaskItem[];
  summary?: string;
}

/** 解析 Task 工具返回的结果 */
function parseTaskResult(result: unknown): TaskResult | null {
  if (typeof result === "string") {
    try {
      result = JSON.parse(result);
    } catch {
      return null;
    }
  }
  if (typeof result === "object" && result !== null) {
    const obj = result as Record<string, unknown>;
    if (Array.isArray(obj.tasks)) {
      return obj as unknown as TaskResult;
    }
    // 尝试提取 tasks 数组
    const keys = Object.keys(obj);
    for (const key of keys) {
      if (Array.isArray(obj[key])) {
        return { tasks: obj[key] as TaskItem[], summary: obj.summary as string | undefined };
      }
    }
  }
  return null;
}

/** 单个任务项 */
function TaskItemRow({ item, index }: { item: TaskItem; index: number }) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    pending: <Circle className="h-4 w-4 text-muted-foreground shrink-0" />,
    in_progress: <Clock className="h-4 w-4 text-primary shrink-0 animate-pulse" />,
    completed: <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />,
    failed: <AlertCircle className="h-4 w-4 text-destructive shrink-0" />,
  }[item.status];

  const statusLabel = {
    pending: "待处理",
    in_progress: "进行中",
    completed: "已完成",
    failed: "失败",
  }[item.status];

  const statusBg = {
    pending: "bg-muted/40 dark:bg-muted/30",
    in_progress: "bg-primary/15 dark:bg-primary/25",
    completed: "bg-green-500/15 dark:bg-green-500/25",
    failed: "bg-destructive/15 dark:bg-destructive/25",
  }[item.status];

  const statusText = {
    pending: "text-muted-foreground",
    in_progress: "text-primary dark:text-primary",
    completed: "text-green-700 dark:text-green-300",
    failed: "text-destructive",
  }[item.status];

  return (
    <div
      className={cn(
        "group rounded-lg border border-border/40 overflow-hidden transition-all duration-200",
        "hover:border-primary/40 hover:shadow-sm hover:shadow-primary/5",
        "cursor-pointer",
        item.status === "in_progress" && "border-primary/40 shadow-sm shadow-primary/10",
        "animate-fade-in-up"
      )}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <button
        type="button"
        className="w-full px-3 py-2 flex items-center gap-2.5 text-left hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform" />
        )}
        {statusIcon}
        <span className={cn(
          "flex-1 text-sm truncate",
          item.status === "completed" && "line-through text-muted-foreground",
          item.status === "failed" && "text-destructive"
        )}>
          {item.content}
        </span>
        <span className={cn(
          "shrink-0 text-xs px-1.5 py-0.5 rounded font-medium",
          statusBg,
          statusText
        )}>
          {statusLabel}
        </span>
      </button>

      {expanded && item.activeForm && (
        <div className="px-3 pb-2 pt-0 text-xs text-muted-foreground border-t border-border/30 bg-muted/10">
          <span className="font-medium text-primary/70">执行中:</span> {item.activeForm}
        </div>
      )}
    </div>
  );
}

/** Task 结果卡片 - 专为任务工具设计的结果展示 */
export function TaskResultCard({ result }: { result: unknown }) {
  const taskResult = parseTaskResult(result);

  if (!taskResult || !Array.isArray(taskResult.tasks) || taskResult.tasks.length === 0) {
    return null;
  }

  const completedCount = taskResult.tasks.filter(t => t.status === "completed").length;
  const totalCount = taskResult.tasks.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="space-y-3 my-2">
      {/* 卡片头部 */}
      <div className="flex items-center gap-2 px-1">
        <ClipboardList className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-medium text-foreground">任务列表</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {completedCount}/{totalCount} 完成
        </span>
      </div>

      {/* 进度条 */}
      {totalCount > 1 && (
        <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* 任务列表 */}
      <div className="space-y-1.5">
        {taskResult.tasks.map((item, index) => (
          <TaskItemRow key={index} item={item} index={index} />
        ))}
      </div>

      {/* 摘要信息 */}
      {taskResult.summary && (
        <p className="text-xs text-muted-foreground pt-1 border-t border-border/30 italic">
          {taskResult.summary}
        </p>
      )}
    </div>
  );
}
