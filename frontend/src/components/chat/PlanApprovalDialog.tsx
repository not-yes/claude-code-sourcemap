import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import type { PermissionRequest, PermissionDecision } from "@/stores/permissionStore";
import { MarkdownContent } from "@/components/chat/MarkdownContent";

/** 权限请求超时时间（毫秒），超时后自动拒绝 */
const PERMISSION_TIMEOUT_MS = 290_000;

interface PlanApprovalDialogProps {
  request: PermissionRequest | null;
  onDecision: (requestId: string, decision: PermissionDecision) => void;
}

/**
 * 从 PermissionRequest 中提取计划文本
 */
function extractPlanText(request: PermissionRequest): string {
  const input = request.toolInput ?? {};
  if (typeof input.plan === "string" && input.plan.trim()) {
    return input.plan;
  }
  if (request.description && request.description.trim()) {
    return request.description;
  }
  return request.action;
}

/**
 * ExitPlanMode 计划审批弹窗
 *
 * 当 Sidecar ExitPlanMode 工具触发权限请求时展示，
 * 支持预览/编辑计划内容，并允许批准或拒绝执行。
 * 超过 290s 未响应时自动拒绝。
 */
export function PlanApprovalDialog({ request, onDecision }: PlanApprovalDialogProps) {
  const isOpen = request !== null;

  // 计划文本编辑状态
  const [editedPlan, setEditedPlan] = useState<string>("");
  const [isEditMode, setIsEditMode] = useState(false);

  // 拒绝原因展开状态
  const [showDenyReason, setShowDenyReason] = useState(false);
  const [denyReason, setDenyReason] = useState("");

  // 超时定时器
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 每次 request 变更时重置状态并初始化计划文本
  useEffect(() => {
    if (!request) return;
    const planText = extractPlanText(request);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- batch state updates for initialization
    setEditedPlan(planText);
    setIsEditMode(false);
    setShowDenyReason(false);
    setDenyReason("");
  }, [request?.requestId]);

  // 超时自动拒绝
  useEffect(() => {
    if (!isOpen || !request) return;
    timerRef.current = setTimeout(() => {
      onDecision(request.requestId, { granted: false, denyReason: "请求超时，自动拒绝" });
    }, PERMISSION_TIMEOUT_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isOpen, request, onDecision]);

  const handleApprove = () => {
    if (!request) return;
    onDecision(request.requestId, {
      granted: true,
      updatedInput: { plan: editedPlan },
    });
  };

  const handleDeny = () => {
    if (!request) return;
    onDecision(request.requestId, {
      granted: false,
      denyReason: denyReason.trim() || "用户拒绝计划",
    });
  };

  const handleDenyClick = () => {
    if (showDenyReason) {
      // 已展开拒绝原因输入框，直接提交
      handleDeny();
    } else {
      // 展开拒绝原因输入框
      setShowDenyReason(true);
    }
  };

  const originalPlan = request ? extractPlanText(request) : "";
  const hasEdited = editedPlan !== originalPlan;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleDeny()}>
      <DialogContent
        className="max-w-2xl w-full"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="text-lg">📋</span>
            计划审批
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            AI 已生成以下执行计划，请审查后决定是否批准执行。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* 工具标签 + 编辑/预览切换 */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">模式：</span>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800">
                ExitPlanMode
              </span>
              {hasEdited && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                  已修改
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsEditMode((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border hover:bg-muted/60"
            >
              {isEditMode ? "👁 预览模式" : "✏️ 编辑模式"}
            </button>
          </div>

          {/* 计划内容区域 */}
          <div className="rounded-md border border-border overflow-hidden">
            <div className="px-3 py-1.5 flex items-center justify-between bg-muted/40 border-b border-border">
              <span className="text-xs font-medium text-muted-foreground">
                {isEditMode ? "编辑计划" : "计划预览"}
              </span>
              {isEditMode && hasEdited && (
                <button
                  type="button"
                  onClick={() => setEditedPlan(originalPlan)}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  重置
                </button>
              )}
            </div>

            {isEditMode ? (
              <textarea
                value={editedPlan}
                onChange={(e) => setEditedPlan(e.target.value)}
                className="w-full px-3 py-2.5 text-sm font-mono text-foreground bg-background resize-none outline-none max-h-96 overflow-auto leading-relaxed"
                rows={14}
                spellCheck={false}
                placeholder="在此编辑计划内容..."
              />
            ) : (
              <div className="px-3 py-2.5 max-h-96 overflow-auto">
                {editedPlan.trim() ? (
                  <MarkdownContent content={editedPlan} className="text-sm" />
                ) : (
                  <p className="text-sm text-muted-foreground italic">（无计划内容）</p>
                )}
              </div>
            )}
          </div>

          {/* 拒绝原因输入区（展开后显示） */}
          {showDenyReason && (
            <div className="rounded-md border border-red-200 dark:border-red-800 overflow-hidden">
              <div className="px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border-b border-red-200 dark:border-red-800">
                拒绝原因（可选）
              </div>
              <textarea
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                className="w-full px-3 py-2 text-sm text-foreground bg-background resize-none outline-none"
                rows={3}
                placeholder="请说明拒绝原因，或留空使用默认原因..."
                autoFocus
              />
            </div>
          )}

          {/* 描述信息 */}
          {request?.description && !isEditMode && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {request.description}
            </p>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          {/* 拒绝按钮 */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleDenyClick}
            className="border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-700 dark:hover:text-red-300 order-2 sm:order-1"
          >
            {showDenyReason ? "确认拒绝" : "拒绝"}
          </Button>

          {/* 取消展开拒绝原因 */}
          {showDenyReason && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowDenyReason(false);
                setDenyReason("");
              }}
              className="text-muted-foreground order-3 sm:order-2"
            >
              取消
            </Button>
          )}

          {/* 批准按钮 */}
          <Button
            size="sm"
            onClick={handleApprove}
            className="bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white order-1 sm:order-3"
          >
            批准执行{hasEdited ? "（已修改）" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
