import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useEffect, useRef } from "react";
import type { PermissionRequest, PermissionDecision } from "@/stores/permissionStore";

/** 权限请求超时时间（毫秒），超时后自动拒绝 */
const PERMISSION_TIMEOUT_MS = 290_000; // 与 Sidecar 300s 超时同步，留 10s 缓冲

interface PermissionDialogProps {
  request: PermissionRequest | null;
  onDecision: (requestId: string, decision: PermissionDecision) => void;
}

/**
 * 根据工具名称判断是否属于破坏性操作
 */
function isDestructiveTool(tool: string): boolean {
  const destructiveTools = [
    "bash",
    "computer",
    "file_write",
    "str_replace_editor",
    "str_replace_based_edit_tool",
  ];
  return destructiveTools.some((t) => tool.toLowerCase().includes(t));
}

/**
 * 根据工具名渲染操作详情
 */
function OperationDetail({ request }: { request: PermissionRequest }) {
  const tool = request.tool.toLowerCase();
  const input = request.toolInput ?? {};

  // Bash 命令显示
  if (tool.includes("bash") || tool.includes("computer")) {
    const command =
      typeof input.command === "string"
        ? input.command
        : typeof input.cmd === "string"
          ? input.cmd
          : null;
    return (
      <div className="rounded-md bg-muted/60 border border-border overflow-hidden">
        <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/40 border-b border-border">
          执行命令
        </div>
        <pre className="px-3 py-2 text-xs font-mono text-foreground whitespace-pre-wrap break-all max-h-40 overflow-auto">
          {command ?? request.action}
        </pre>
      </div>
    );
  }

  // 文件操作显示路径
  if (
    tool.includes("file") ||
    tool.includes("edit") ||
    tool.includes("write") ||
    tool.includes("str_replace")
  ) {
    const filePath =
      typeof input.path === "string"
        ? input.path
        : typeof input.file_path === "string"
          ? input.file_path
          : request.path;
    return (
      <div className="rounded-md bg-muted/60 border border-border overflow-hidden">
        <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/40 border-b border-border">
          文件路径
        </div>
        <div className="px-3 py-2 text-xs font-mono text-foreground break-all">
          {filePath ?? request.action}
        </div>
      </div>
    );
  }

  // 默认：显示 action 和 JSON 输入
  return (
    <div className="space-y-2">
      <div className="rounded-md bg-muted/60 border border-border overflow-hidden">
        <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/40 border-b border-border">
          操作描述
        </div>
        <div className="px-3 py-2 text-sm text-foreground">{request.action}</div>
      </div>
      {Object.keys(input).length > 0 && (
        <div className="rounded-md bg-muted/60 border border-border overflow-hidden">
          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/40 border-b border-border">
            参数详情
          </div>
          <pre className="px-3 py-2 text-xs font-mono text-foreground whitespace-pre-wrap break-all max-h-32 overflow-auto">
            {JSON.stringify(input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * 权限确认弹窗
 *
 * 当 Sidecar 请求工具执行权限时展示，支持允许/拒绝/始终允许三种决策。
 * 超过 5 分钟未响应时自动拒绝（防止 Sidecar 一直阻塞）。
 */
export function PermissionDialog({ request, onDecision }: PermissionDialogProps) {
  const isOpen = request !== null;
  const isDestructive = request ? isDestructiveTool(request.tool) : false;

  // 超时自动拒绝
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isOpen || !request) return;
    timerRef.current = setTimeout(() => {
      onDecision(request.requestId, { granted: false, denyReason: "请求超时，自动拒绝" });
    }, PERMISSION_TIMEOUT_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isOpen, request, onDecision]);

  const handleAllow = () => {
    if (!request) return;
    onDecision(request.requestId, { granted: true });
  };

  const handleDeny = () => {
    if (!request) return;
    onDecision(request.requestId, { granted: false, denyReason: "用户拒绝" });
  };

  const handleAlwaysAllow = () => {
    if (!request) return;
    onDecision(request.requestId, { granted: true, remember: true });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleDeny()}>
      <DialogContent className="max-w-lg" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="text-lg">🔐</span>
            权限请求
          </DialogTitle>
          <DialogDescription className="sr-only">
            工具正在请求执行权限，请确认是否允许
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* 工具名称 Badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">工具：</span>
            <span
              className={[
                "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border",
                isDestructive
                  ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800"
                  : "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800",
              ].join(" ")}
            >
              {request?.tool ?? ""}
            </span>
            {isDestructive && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                ⚠ 高风险
              </span>
            )}
          </div>

          {/* 破坏性操作警告条 */}
          {isDestructive && (
            <div className="flex items-start gap-2.5 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-3 py-2.5">
              <span className="text-base leading-none mt-0.5">⚠️</span>
              <div className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                此操作具有潜在风险，可能对系统文件或命令执行产生不可逆的影响，请谨慎确认。
              </div>
            </div>
          )}

          {/* 操作详情 */}
          {request && <OperationDetail request={request} />}

          {/* 描述信息 */}
          {request?.description && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {request.description}
            </p>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDeny}
            className="border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-700 dark:hover:text-red-300 order-3 sm:order-1"
          >
            拒绝
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAlwaysAllow}
            className="border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 hover:text-blue-700 dark:hover:text-blue-300 order-2 sm:order-2"
          >
            始终允许
          </Button>
          <Button
            size="sm"
            onClick={handleAllow}
            className="bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white order-1 sm:order-3"
          >
            允许
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
