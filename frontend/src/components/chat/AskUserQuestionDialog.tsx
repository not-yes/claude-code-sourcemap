import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState, useCallback } from "react";
import type { PermissionRequest, PermissionDecision } from "@/stores/permissionStore";

/** 权限请求超时时间（毫秒），超时后自动拒绝 */
const PERMISSION_TIMEOUT_MS = 290_000; // 与 Sidecar 300s 超时同步，留 10s 缓冲

interface AskUserQuestionDialogProps {
  request: PermissionRequest | null;
  onDecision: (requestId: string, decision: PermissionDecision) => void;
}

interface QuestionOption {
  label: string;
  description: string;
  preview?: string;
}

interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

/** 从 toolInput 中安全解析 questions 数组 */
function parseQuestions(toolInput?: Record<string, unknown>): Question[] {
  if (!toolInput) return [];
  const raw = toolInput.questions;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Question => {
    return (
      typeof item === "object" &&
      item !== null &&
      typeof (item as Question).question === "string" &&
      typeof (item as Question).header === "string" &&
      Array.isArray((item as Question).options)
    );
  });
}

/** 单个问题的答案状态 */
type QuestionAnswer = {
  selected: string[]; // 已选 label 列表
  otherText: string;  // Other 文本框内容
  otherSelected: boolean;
};

const OTHER_LABEL = "Other";

/** 单个问题渲染组件 */
function QuestionCard({
  question,
  index,
  answer,
  onChange,
}: {
  question: Question;
  index: number;
  answer: QuestionAnswer;
  onChange: (updated: QuestionAnswer) => void;
}) {
  const isMulti = question.multiSelect === true;

  const handleOptionClick = (label: string) => {
    if (isMulti) {
      // 多选：切换
      const next = answer.selected.includes(label)
        ? answer.selected.filter((l) => l !== label)
        : [...answer.selected, label];
      onChange({ ...answer, selected: next });
    } else {
      // 单选：选中或取消
      const next = answer.selected[0] === label ? [] : [label];
      onChange({ ...answer, selected: next });
    }
  };

  const handleOtherClick = () => {
    if (isMulti) {
      onChange({ ...answer, otherSelected: !answer.otherSelected });
    } else {
      onChange({ ...answer, otherSelected: !answer.otherSelected, selected: [] });
    }
  };

  return (
    <div className="space-y-2.5">
      {/* 标题行：header chip + 问题序号 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground">Q{index + 1}</span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800">
          {question.header}
        </span>
        {isMulti && (
          <span className="text-xs text-muted-foreground">（可多选）</span>
        )}
      </div>

      {/* 问题文本 */}
      <p className="text-sm text-foreground leading-relaxed">{question.question}</p>

      {/* 选项列表 */}
      <div className="space-y-1.5">
        {question.options.map((opt) => {
          const isSelected = answer.selected.includes(opt.label);
          return (
            <button
              key={opt.label}
              type="button"
              onClick={() => handleOptionClick(opt.label)}
              className={[
                "w-full text-left rounded-md border px-3 py-2.5 transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected
                  ? "bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-700"
                  : "bg-muted/60 border-border hover:bg-muted/80 dark:hover:bg-muted/50",
              ].join(" ")}
            >
              <div className="flex items-start gap-2">
                {/* 多选时显示 checkbox 指示 */}
                {isMulti && (
                  <span
                    className={[
                      "mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center text-xs",
                      isSelected
                        ? "bg-blue-500 border-blue-500 text-white"
                        : "border-muted-foreground/40",
                    ].join(" ")}
                  >
                    {isSelected && "✓"}
                  </span>
                )}
                {/* 单选时显示 radio 指示 */}
                {!isMulti && (
                  <span
                    className={[
                      "mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border flex items-center justify-center",
                      isSelected
                        ? "border-blue-500"
                        : "border-muted-foreground/40",
                    ].join(" ")}
                  >
                    {isSelected && (
                      <span className="w-2 h-2 rounded-full bg-blue-500" />
                    )}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <div
                    className={[
                      "text-sm font-medium leading-snug",
                      isSelected
                        ? "text-blue-700 dark:text-blue-300"
                        : "text-foreground",
                    ].join(" ")}
                  >
                    {opt.label}
                  </div>
                  {opt.description && (
                    <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {opt.description}
                    </div>
                  )}
                  {opt.preview && (
                    <pre className="text-xs font-mono text-muted-foreground mt-1 whitespace-pre-wrap break-all">
                      {opt.preview}
                    </pre>
                  )}
                </div>
              </div>
            </button>
          );
        })}

        {/* Other 选项 */}
        <button
          type="button"
          onClick={handleOtherClick}
          className={[
            "w-full text-left rounded-md border px-3 py-2.5 transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            answer.otherSelected
              ? "bg-violet-50 dark:bg-violet-950/30 border-violet-300 dark:border-violet-700"
              : "bg-muted/60 border-border hover:bg-muted/80 dark:hover:bg-muted/50",
          ].join(" ")}
        >
          <div className="flex items-start gap-2">
            {isMulti ? (
              <span
                className={[
                  "mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center text-xs",
                  answer.otherSelected
                    ? "bg-violet-500 border-violet-500 text-white"
                    : "border-muted-foreground/40",
                ].join(" ")}
              >
                {answer.otherSelected && "✓"}
              </span>
            ) : (
              <span
                className={[
                  "mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border flex items-center justify-center",
                  answer.otherSelected
                    ? "border-violet-500"
                    : "border-muted-foreground/40",
                ].join(" ")}
              >
                {answer.otherSelected && (
                  <span className="w-2 h-2 rounded-full bg-violet-500" />
                )}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <div
                className={[
                  "text-sm font-medium leading-snug",
                  answer.otherSelected
                    ? "text-violet-700 dark:text-violet-300"
                    : "text-foreground",
                ].join(" ")}
              >
                {OTHER_LABEL}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                自定义回答
              </div>
            </div>
          </div>
        </button>

        {/* Other 展开文本框 */}
        {answer.otherSelected && (
          <textarea
            className={[
              "w-full rounded-md border border-violet-300 dark:border-violet-700",
              "bg-violet-50/50 dark:bg-violet-950/20 px-3 py-2",
              "text-sm text-foreground placeholder:text-muted-foreground",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "resize-none",
            ].join(" ")}
            rows={2}
            placeholder="请输入您的回答..."
            value={answer.otherText}
            onChange={(e) => onChange({ ...answer, otherText: e.target.value })}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>
    </div>
  );
}

/**
 * AskUserQuestion 专用问答弹窗
 *
 * 当 Sidecar AskUserQuestion 工具触发权限请求时显示，
 * 替代通用权限弹窗，提供结构化问答 UI。
 */
export function AskUserQuestionDialog({ request, onDecision }: AskUserQuestionDialogProps) {
  const isOpen = request !== null;
  const questions = parseQuestions(request?.toolInput);

  // 每个问题的答案状态
  const [answers, setAnswers] = useState<QuestionAnswer[]>([]);

  // 当 request 变化时重置答案
  useEffect(() => {
    if (request) {
      const qs = parseQuestions(request.toolInput);
      setAnswers(qs.map(() => ({ selected: [], otherText: "", otherSelected: false })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.requestId]);

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

  /** 判断某个问题是否已回答 */
  const isAnswered = (ans: QuestionAnswer): boolean => {
    if (ans.otherSelected) return ans.otherText.trim().length > 0;
    return ans.selected.length > 0;
  };

  /** 所有问题都已回答时启用提交 */
  const allAnswered =
    answers.length > 0 && answers.every((ans) => isAnswered(ans));

  const handleUpdateAnswer = useCallback((index: number, updated: QuestionAnswer) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = updated;
      return next;
    });
  }, []);

  const handleSubmit = () => {
    if (!request) return;
    const result: Record<string, string> = {};
    questions.forEach((q, i) => {
      const ans = answers[i];
      if (!ans) return;
      const parts: string[] = [];
      if (ans.selected.length > 0) {
        parts.push(...ans.selected);
      }
      if (ans.otherSelected && ans.otherText.trim()) {
        parts.push(ans.otherText.trim());
      }
      result[q.question] = parts.join(", ");
    });
    onDecision(request.requestId, { granted: true, answers: result });
  };

  const handleSkip = () => {
    if (!request) return;
    onDecision(request.requestId, { granted: false, denyReason: "用户拒绝回答" });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleSkip()}>
      <DialogContent
        className="max-w-lg max-h-[85vh] flex flex-col"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="text-lg">💬</span>
            问题回答
          </DialogTitle>
          <DialogDescription className="sr-only">
            AI 助手需要您回答以下问题以继续执行任务
          </DialogDescription>
        </DialogHeader>

        {/* 工具名 Badge */}
        <div className="flex items-center gap-2 flex-wrap flex-shrink-0 -mt-1">
          <span className="text-sm text-muted-foreground">工具：</span>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800">
            {request?.tool ?? "AskUserQuestion"}
          </span>
        </div>

        {/* 描述信息 */}
        {request?.description && (
          <p className="text-xs text-muted-foreground leading-relaxed flex-shrink-0">
            {request.description}
          </p>
        )}

        {/* 问题列表（可滚动） */}
        <div className="flex-1 overflow-y-auto space-y-5 py-1 pr-1 min-h-0">
          {questions.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              暂无问题数据
            </div>
          ) : (
            questions.map((q, i) => (
              <div key={i}>
                {i > 0 && <div className="border-t border-border mb-5" />}
                <QuestionCard
                  question={q}
                  index={i}
                  answer={answers[i] ?? { selected: [], otherText: "", otherSelected: false }}
                  onChange={(updated) => handleUpdateAnswer(i, updated)}
                />
              </div>
            ))
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2 flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSkip}
            className="border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-700 dark:hover:text-red-300 order-2 sm:order-1"
          >
            跳过
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!allAnswered}
            className="bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white disabled:opacity-50 disabled:cursor-not-allowed order-1 sm:order-2"
          >
            提交回答
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
