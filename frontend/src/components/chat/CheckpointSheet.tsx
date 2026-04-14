import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  listCheckpoints,
  saveCheckpoint,
  rollbackCheckpoint,
  compareCheckpoints,
  getCheckpointTimeline,
  exportCheckpoint,
  importCheckpoint,
  batchDeleteCheckpoints,
  subscribeCheckpointEvents,
  type CheckpointListItem,
  type CheckpointTimelineResult,
  type CompareCheckpointsResult,
} from "@/api/tauri-api";
import { useAppStore } from "@/stores/appStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/utils";

// ─── helpers ─────────────────────────────────────────────────────────────────

function downloadJson(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatCompareResult(c: CompareCheckpointsResult): string {
  const lines = [
    c.summary,
    "",
    `step_diff: ${c.step_diff}  todo_diff: ${c.todo_diff}  context_window_diff: ${c.context_window_diff}`,
    "",
    JSON.stringify(
      { todo_changes: c.todo_changes, context_changes: c.context_changes },
      null,
      2
    ),
  ];
  return lines.join("\n");
}

// ─── CompareModal ─────────────────────────────────────────────────────────────

function CompareModal({
  open,
  onClose,
  result,
}: {
  open: boolean;
  onClose: () => void;
  result: CompareCheckpointsResult | null;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl w-[90vw] max-h-[80vh] flex flex-col gap-0 p-0 border-0 shadow-xl rounded-xl overflow-hidden bg-background">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b border-border/60">
          <DialogTitle className="text-base font-medium">Checkpoint 对比结果</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto px-6 py-4 min-h-0">
          {result ? (
            <div className="space-y-4">
              {/* Summary banner */}
              <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-4 py-3">
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">{result.summary}</p>
              </div>

              {/* Metrics row */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Step 差值", value: result.step_diff },
                  { label: "Todo 差值", value: result.todo_diff },
                  { label: "Context 差值", value: result.context_window_diff },
                ].map((m) => (
                  <div
                    key={m.label}
                    className="rounded-lg border border-border/80 bg-muted/30 px-3 py-2 text-center"
                  >
                    <p className="text-xs text-muted-foreground mb-1">{m.label}</p>
                    <p
                      className={cn(
                        "text-lg font-mono font-semibold",
                        m.value > 0
                          ? "text-green-600 dark:text-green-400"
                          : m.value < 0
                          ? "text-red-500"
                          : "text-foreground"
                      )}
                    >
                      {m.value > 0 ? "+" : ""}
                      {m.value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Todo changes */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Todo 变更
                </p>
                <div className="rounded-lg border border-border/80 divide-y divide-border/60 overflow-hidden">
                  {(
                    [
                      { key: "added", label: "新增", color: "text-green-600 dark:text-green-400" },
                      { key: "removed", label: "移除", color: "text-red-500" },
                      { key: "completed", label: "完成", color: "text-blue-500" },
                      { key: "reopened", label: "重开", color: "text-yellow-500" },
                    ] as const
                  ).map(({ key, label, color }) => {
                    const items = result.todo_changes[key];
                    return (
                      <div key={key} className="px-3 py-2 flex gap-3 items-start">
                        <span className={cn("text-xs font-medium w-10 shrink-0 pt-0.5", color)}>
                          {label}
                        </span>
                        {items.length === 0 ? (
                          <span className="text-xs text-muted-foreground italic">无</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {items.map((t: string, i: number) => (
                              <span
                                key={i}
                                className="inline-block rounded bg-muted/50 px-1.5 py-0.5 text-xs font-mono"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Context changes */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Context 变更
                </p>
                <div className="rounded-lg border border-border/80 bg-muted/50 px-3 py-2 space-y-1.5">
                  <p className="text-xs">
                    <span className="text-muted-foreground">消息新增：</span>
                    <span className="font-mono font-medium">{result.context_changes.messages_added}</span>
                  </p>
                  <p className="text-xs">
                    <span className="text-muted-foreground">系统消息变更：</span>
                    <span className="font-mono font-medium">
                      {result.context_changes.system_messages_changed ? "是" : "否"}
                    </span>
                  </p>
                  {result.context_changes.last_user_message && (
                    <p className="text-xs">
                      <span className="text-muted-foreground">最后用户消息：</span>
                      <span className="font-mono">
                        {result.context_changes.last_user_message.slice(0, 80)}
                        {result.context_changes.last_user_message.length > 80 ? "…" : ""}
                      </span>
                    </p>
                  )}
                </div>
              </div>

              {/* Raw diff */}
              <details className="rounded-lg border border-border/80 overflow-hidden">
                <summary className="px-3 py-2 text-xs text-muted-foreground cursor-pointer hover:bg-muted/30 select-none">
                  原始 diff 数据
                </summary>
                <pre className="text-xs font-mono whitespace-pre-wrap break-words p-3 bg-muted/50 max-h-48 overflow-auto">
                  {formatCompareResult(result)}
                </pre>
              </details>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">暂无对比数据</p>
          )}
        </div>
        <div className="px-6 py-4 shrink-0 border-t border-border/60 flex justify-end">
          <Button size="sm" variant="secondary" onClick={onClose}>
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── TimelineView ─────────────────────────────────────────────────────────────

function TimelineView({
  timeline,
  onNodeClick,
}: {
  timeline: CheckpointTimelineResult;
  onNodeClick: (id: string) => void;
}) {
  const items = timeline.checkpoints;
  return (
    <div className="relative pl-6 space-y-0">
      {/* Vertical line */}
      {items.length > 1 && (
        <div className="absolute left-[11px] top-3 bottom-3 w-px bg-border/60" />
      )}
      {items.map((c, idx) => (
        <div key={c.id} className="relative flex gap-3 pb-4 last:pb-0">
          {/* Node dot */}
          <button
            type="button"
            onClick={() => onNodeClick(c.id)}
            className={cn(
              "relative z-10 mt-1 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center",
              "border-primary bg-background hover:bg-primary/10 transition-colors",
              idx === 0 && "border-blue-500"
            )}
            title="跳转到此 checkpoint"
          >
            <span className="w-2 h-2 rounded-full bg-primary" />
          </button>

          {/* Content */}
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-foreground">{c.id.slice(0, 12)}…</span>
              {c.tags.length > 0 &&
                c.tags.map((t) => (
                  <span
                    key={t}
                    className="inline-block px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium"
                  >
                    {t}
                  </span>
                ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              step {c.step} · {new Date(c.created_at).toLocaleString("zh-CN")}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── ImportDialog ─────────────────────────────────────────────────────────────

function ImportDialog({
  open,
  onClose,
  onSuccess,
  agentId,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  agentId: string;
}) {
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImport = async () => {
    const raw = importText.trim();
    if (!raw) {
      toast.error("请粘贴或选择导出的 JSON");
      return;
    }
    setBusy(true);
    try {
      const res = await importCheckpoint({ jsonData: raw }, agentId);
      toast.success(`已导入 checkpoint ${res.checkpoint_id.slice(0, 8)}…`);
      setImportText("");
      onSuccess();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导入失败");
    } finally {
      setBusy(false);
    }
  };

  const handleFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const t = typeof reader.result === "string" ? reader.result : "";
      setImportText(t);
    };
    reader.readAsText(file);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>导入 Checkpoint</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
            >
              选择文件
            </Button>
            <span className="text-xs text-muted-foreground">或直接粘贴 JSON</span>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <Textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="粘贴导出的 JSON 数据…"
            className="min-h-[120px] text-sm font-mono"
          />
          <div className="flex gap-2 justify-end">
            <Button type="button" size="sm" variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || !importText.trim()}
              onClick={() => void handleImport()}
            >
              {busy ? "导入中…" : "导入"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type ViewMode = "list" | "timeline";

export function CheckpointSheet({
  open,
  onOpenChange,
  sessionId,
  agentId,
  executeBusy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  agentId: string;
  executeBusy: boolean;
}) {
  const bumpChatHistoryReload = useAppStore((s) => s.bumpChatHistoryReload);

  // ── core state ──
  const [items, setItems] = useState<CheckpointListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // ── timeline state ──
  const [timeline, setTimeline] = useState<CheckpointTimelineResult | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // ── compare state ──
  const [compareSelected, setCompareSelected] = useState<Set<string>>(() => new Set());
  const [compareResult, setCompareResult] = useState<CompareCheckpointsResult | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);

  // ── batch-delete state ──
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(() => new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);

  // ── save state ──
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveTag, setSaveTag] = useState("");
  const [saveComment, setSaveComment] = useState("");

  // ── rollback state ──
  const [rollbackId, setRollbackId] = useState<string | null>(null);

  // ── import state ──
  const [importOpen, setImportOpen] = useState(false);

  const mutationsDisabled = executeBusy;

  // ── load list ──────────────────────────────────────────────────────────────

  const loadList = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const list = await listCheckpoints({ sessionId, limit: 100 }, agentId);
      setItems(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载 checkpoint 失败");
      setItems([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── load timeline ──────────────────────────────────────────────────────────

  const loadTimeline = useCallback(async () => {
    if (!sessionId) return;
    setTimelineLoading(true);
    try {
      const res = await getCheckpointTimeline({ sessionId, limit: 100 }, agentId);
      setTimeline(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载时间线失败");
    } finally {
      setTimelineLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (open && sessionId) {
      void loadList();
      setTimeline(null);
      setCompareSelected(new Set());
      setCompareResult(null);
      setBatchMode(false);
      setBatchSelected(new Set());
      setViewMode("list");
    }
  }, [open, sessionId, loadList]);

  useEffect(() => {
    if (viewMode === "timeline" && !timeline && !timelineLoading) {
      void loadTimeline();
    }
  }, [viewMode, timeline, timelineLoading, loadTimeline]);

  // 用 ref 追踪 viewMode，避免订阅 effect 因 viewMode 变化重建
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  useEffect(() => {
    if (!open || !sessionId) return;
    const ac = new AbortController();
    subscribeCheckpointEvents({
      sessionId,
      signal: ac.signal,
      onEvent: () => {
        void loadList();
        // 通过 ref 读取当前 viewMode，不将 viewMode 加入依赖以避免重建订阅
        if (viewModeRef.current === "timeline") void loadTimeline();
      },
    }).catch((e) => {
      if (ac.signal.aborted) return;
      if (e instanceof Error && e.message === "aborted") return;
    });
    return () => ac.abort();
  }, [open, sessionId, loadList, loadTimeline]);

  // ── save ───────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    const tag = saveTag.trim();
    if (!tag) {
      toast.error("请填写 tag");
      return;
    }
    try {
      await saveCheckpoint({
        sessionId,
        tag,
        comment: saveComment.trim() || undefined,
      }, agentId);
      toast.success("已保存 checkpoint");
      setSaveOpen(false);
      setSaveTag("");
      setSaveComment("");
      await loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  // ── rollback ───────────────────────────────────────────────────────────────

  const handleRollback = async () => {
    if (!rollbackId) return;
    try {
      await rollbackCheckpoint({ sessionId, checkpointId: rollbackId }, agentId);
      toast.success("已回滚，正在刷新对话");
      bumpChatHistoryReload();
      setRollbackId(null);
      await loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "回滚失败");
    }
  };

  // ── export ─────────────────────────────────────────────────────────────────

  const handleExport = async (checkpointId: string) => {
    try {
      const res = await exportCheckpoint({ sessionId, checkpointId }, agentId);
      const name = `checkpoint-${checkpointId.slice(0, 8)}.json`;
      downloadJson(name, res.json_data);
      toast.success("已导出");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导出失败");
    }
  };

  // ── compare ────────────────────────────────────────────────────────────────

  const toggleCompareSelect = (id: string) => {
    setCompareSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 2) {
        next.add(id);
      } else {
        toast.error("只能选择两个 checkpoint 进行对比");
      }
      return next;
    });
  };

  const handleCompare = async () => {
    const [idA, idB] = [...compareSelected];
    if (!idA || !idB) {
      toast.error("请选择两个不同的 checkpoint");
      return;
    }
    setCompareLoading(true);
    try {
      const res = await compareCheckpoints({
        sessionId,
        checkpointIdA: idA,
        checkpointIdB: idB,
      }, agentId);
      setCompareResult(res);
      setCompareOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "对比失败");
    } finally {
      setCompareLoading(false);
    }
  };

  // ── batch delete ───────────────────────────────────────────────────────────

  const toggleBatchSelect = (id: string) => {
    setBatchSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBatchDelete = async () => {
    const ids = [...batchSelected];
    if (ids.length === 0) return;
    try {
      await batchDeleteCheckpoints({ sessionId, checkpointIds: ids }, agentId);
      toast.success("已提交批量删除");
      setBatchSelected(new Set());
      setBatchMode(false);
      await loadList();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "批量删除失败");
    }
  };

  // ── timeline node click → scroll to rollback ───────────────────────────────

  const handleTimelineNodeClick = (id: string) => {
    setViewMode("list");
    setRollbackId(id);
  };

  // ─── render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Main dialog ── */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl w-[90vw] max-h-[85vh] min-h-[400px] flex flex-col p-0 gap-0 border-0 shadow-xl rounded-xl overflow-hidden bg-background text-foreground">

          {/* Header */}
          <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
            <DialogTitle className="text-base font-medium text-foreground">
              Checkpoint
            </DialogTitle>
            <p className="text-xs text-muted-foreground font-normal pr-8">
              会话{" "}
              <span className="font-mono break-all">{sessionId.slice(0, 36)}</span>
              {mutationsDisabled && " · 流式输出进行中，已暂停保存/回滚等操作"}
            </p>
          </DialogHeader>

          {/* Tab bar + toolbar */}
          <div className="px-6 pb-0 shrink-0 border-b border-border/60">
            {/* View tabs */}
            <div className="flex gap-0 mb-3">
              {(["list", "timeline"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={cn(
                    "px-4 py-1.5 text-sm rounded-t-md transition-colors border-b-2",
                    viewMode === mode
                      ? "border-primary text-foreground font-medium"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {mode === "list" ? "列表" : "时间线"}
                </button>
              ))}
            </div>

            {/* Action toolbar */}
            <div className="flex flex-wrap gap-2 pb-3">
              <Button
                type="button"
                size="sm"
                disabled={mutationsDisabled}
                onClick={() => setSaveOpen(true)}
              >
                保存
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void loadList()}
                disabled={loading}
              >
                刷新
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setImportOpen(true)}
                disabled={mutationsDisabled}
              >
                导入
              </Button>

              {/* Compare button — visible when exactly 2 are selected */}
              {compareSelected.size === 2 && viewMode === "list" && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={compareLoading}
                  onClick={() => void handleCompare()}
                >
                  {compareLoading ? "对比中…" : `对比 (${compareSelected.size})`}
                </Button>
              )}

              {/* Batch-delete toggle */}
              <Button
                type="button"
                size="sm"
                variant={batchMode ? "default" : "outline"}
                onClick={() => {
                  setBatchMode((v) => !v);
                  setBatchSelected(new Set());
                }}
              >
                {batchMode ? "退出多选" : "多选"}
              </Button>
              {batchMode && batchSelected.size > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={mutationsDisabled}
                  onClick={() => setBatchDeleteOpen(true)}
                >
                  删除选中 ({batchSelected.size})
                </Button>
              )}
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-auto px-6 py-4 min-h-0">

            {/* ── Timeline view ── */}
            {viewMode === "timeline" && (
              <div>
                {timelineLoading ? (
                  <p className="text-sm text-muted-foreground">加载时间线中…</p>
                ) : !timeline ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground mb-3">时间线尚未加载</p>
                    <Button size="sm" variant="secondary" onClick={() => void loadTimeline()}>
                      加载时间线
                    </Button>
                  </div>
                ) : timeline.checkpoints.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无 checkpoint</p>
                ) : (
                  <TimelineView
                    timeline={timeline}
                    onNodeClick={handleTimelineNodeClick}
                  />
                )}
              </div>
            )}

            {/* ── List view ── */}
            {viewMode === "list" && (
              <div className="space-y-2">
                {/* Compare hint */}
                {compareSelected.size > 0 && (
                  <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2 text-xs text-blue-600 dark:text-blue-400">
                    已选 {compareSelected.size} 个用于对比
                    {compareSelected.size === 1 && "，再选一个可执行对比"}
                    <button
                      type="button"
                      className="ml-2 underline opacity-70 hover:opacity-100"
                      onClick={() => setCompareSelected(new Set())}
                    >
                      清除
                    </button>
                  </div>
                )}

                {loading ? (
                  <p className="text-sm text-muted-foreground">加载中…</p>
                ) : items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    暂无 checkpoint；若刚开会话，请先在后端产生任务状态后再试。
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {items.map((c) => {
                      const isCompareChecked = compareSelected.has(c.id);
                      const isBatchChecked = batchSelected.has(c.id);

                      return (
                        <li
                          key={c.id}
                          className={cn(
                            "rounded-lg border border-border/80 p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between transition-colors",
                            (isCompareChecked || isBatchChecked) &&
                              "bg-primary/5 border-primary/30"
                          )}
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            {/* Batch-delete checkbox */}
                            {batchMode && (
                              <Checkbox
                                checked={isBatchChecked}
                                onCheckedChange={() => toggleBatchSelect(c.id)}
                                aria-label={`批量选择 ${c.id}`}
                              />
                            )}

                            {/* Compare checkbox */}
                            {!batchMode && (
                              <Checkbox
                                checked={isCompareChecked}
                                onCheckedChange={() => toggleCompareSelect(c.id)}
                                aria-label={`选择对比 ${c.id}`}
                                title="勾选用于对比"
                              />
                            )}

                            <div className="min-w-0">
                              <p className="text-xs font-mono break-all text-foreground">
                                {c.id}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">
                                step {c.step} ·{" "}
                                {new Date(c.created_at).toLocaleString("zh-CN")}
                                {c.tags.length > 0 ? (
                                  <>
                                    {" · "}
                                    {c.tags.map((t) => (
                                      <span
                                        key={t}
                                        className="inline-block mr-1 px-1.5 py-0 rounded bg-primary/10 text-primary text-[10px]"
                                      >
                                        {t}
                                      </span>
                                    ))}
                                  </>
                                ) : null}
                              </p>
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div className="flex flex-wrap gap-1.5 shrink-0">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => void handleExport(c.id)}
                            >
                              导出
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              disabled={mutationsDisabled}
                              onClick={() => setRollbackId(c.id)}
                            >
                              回滚
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Save dialog ── */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>保存 Checkpoint</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={saveTag}
              onChange={(e) => setSaveTag(e.target.value)}
              placeholder="tag（必填）"
            />
            <Textarea
              value={saveComment}
              onChange={(e) => setSaveComment(e.target.value)}
              placeholder="备注（可选）"
              className="min-h-[72px]"
            />
            <Button
              type="button"
              disabled={mutationsDisabled}
              onClick={() => void handleSave()}
            >
              保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Import dialog ── */}
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => void loadList()}
        agentId={agentId}
      />

      {/* ── Compare result modal ── */}
      <CompareModal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        result={compareResult}
      />

      {/* ── Rollback confirm ── */}
      <ConfirmDialog
        open={!!rollbackId}
        onOpenChange={(o) => !o && setRollbackId(null)}
        title="回滚 Checkpoint"
        description="将任务状态恢复到该 checkpoint，当前未保存进度可能丢失。确定继续？"
        confirmLabel="回滚"
        variant="destructive"
        onConfirm={handleRollback}
      />

      {/* ── Batch delete confirm ── */}
      <ConfirmDialog
        open={batchDeleteOpen}
        onOpenChange={setBatchDeleteOpen}
        title="批量删除 Checkpoint"
        description={`将删除已选中的 ${batchSelected.size} 个 checkpoint，确定继续？`}
        confirmLabel="删除"
        variant="destructive"
        onConfirm={runBatchDelete}
      />
    </>
  );
}
