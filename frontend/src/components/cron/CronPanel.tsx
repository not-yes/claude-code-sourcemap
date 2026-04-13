import { useState, useEffect } from "react";
import {
  addCronJob,
  updateCronJob,
  getCronHistory,
  type CronHistoryItem,
} from "@/api/tauri-api";
import { useCronStore } from "@/stores/cronStore";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { ContentHeader } from "@/components/layout/ContentHeader";
import { CronTimePicker } from "@/components/ui/cron-time-picker";

const getSchedulePlaceholder = (type: 'cron' | 'at' | 'every') => {
  switch (type) {
    case 'cron': return '分 时 日 月 周，例如: 10 10 * * *'
    case 'every': return '间隔时间，例如: 5m, 1h, 30s'
    case 'at': return '执行时间，例如: 2024-04-10 10:00'
  }
}

export function CronPanel() {
  const selectedCronId = useAppStore((s) => s.selectedCronId);
  const setSelectedCron = useAppStore((s) => s.setSelectedCron);
  const historyCronId = useAppStore((s) => s.historyCronId);
  const setHistoryCronId = useAppStore((s) => s.setHistoryCronId);

  const { jobs, loading, error, reload, initCronListener } = useCronStore();

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addSchedule, setAddSchedule] = useState("");
  const [addScheduleType, setAddScheduleType] = useState<"cron" | "at" | "every">("cron");
  const [addInstruction, setAddInstruction] = useState("");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [history, setHistory] = useState<CronHistoryItem[]>([]);

  // 注册 Cron 完成事件监听器
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    initCronListener().then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [initCronListener]);

  const [editName, setEditName] = useState("");
  const [editSchedule, setEditSchedule] = useState("");
  const [editScheduleType, setEditScheduleType] = useState<"cron" | "at" | "every">("cron");
  const [editInstruction, setEditInstruction] = useState("");
  const [editEnabled, setEditEnabled] = useState(true);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const selectedJob = jobs.find((j) => j.id === selectedCronId);

  useEffect(() => {
    if (historyCronId) {
      getCronHistory(historyCronId)
        .then(setHistory)
        .catch(() => setHistory([]));
    } else {
      setHistory([]);
    }
  }, [historyCronId]);

  useEffect(() => {
    if (selectedJob) {
      setEditName(selectedJob.name);
      setEditSchedule(selectedJob.schedule);
      setEditScheduleType(selectedJob.schedule_type);
      setEditInstruction(selectedJob.instruction);
      setEditEnabled(selectedJob.enabled);
    }
  }, [selectedJob]);

  const handleAdd = async () => {
    if (!addName.trim() || !addSchedule.trim() || !addInstruction.trim()) {
      setAddError("名称、调度表达式和指令不能为空");
      return;
    }
    setAddSubmitting(true);
    setAddError(null);
    try {
      const res = await addCronJob({
        name: addName.trim(),
        schedule: addSchedule.trim(),
        schedule_type: addScheduleType,
        instruction: addInstruction.trim(),
      });
      setAddOpen(false);
      setAddName("");
      setAddSchedule("");
      setAddInstruction("");
      await reload();
      setSelectedCron(res.job_id);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setAddSubmitting(false);
    }
  };

  const handleSave = async () => {
    if (!selectedJob) return;
    setEditSaving(true);
    setEditError(null);
    try {
      await updateCronJob(selectedJob.id, {
        name: editName.trim(),
        schedule: editSchedule.trim(),
        schedule_type: editScheduleType,
        instruction: editInstruction.trim(),
        enabled: editEnabled,
      });
      await reload();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setEditSaving(false);
    }
  };

  const formatTs = (ts?: number) => {
    if (!ts) return "-";
    return new Date(ts * 1000).toLocaleString("zh-CN");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ContentHeader
        title="定时任务"
        actions={
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => reload()}
              disabled={loading}
              title="刷新"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <button
                  type="button"
                  title="新建定时任务"
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新建定时任务</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <div>
                  <label className="text-sm font-medium text-foreground">名称</label>
                  <Input
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder="任务名称"
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">调度类型</label>
                  <Select
                    value={addScheduleType}
                    onValueChange={(v) =>
                      setAddScheduleType(v as "cron" | "at" | "every")
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="选择类型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cron">Cron 表达式</SelectItem>
                      <SelectItem value="at">指定时间 (At)</SelectItem>
                      <SelectItem value="every">固定间隔 (Every)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">调度设置</label>
                  {addScheduleType === "cron" ? (
                    <div className="mt-2">
                      <CronTimePicker
                        value={addSchedule}
                        onChange={setAddSchedule}
                      />
                    </div>
                  ) : (
                    <Input
                      value={addSchedule}
                      onChange={(e) => setAddSchedule(e.target.value)}
                      placeholder={getSchedulePlaceholder(addScheduleType)}
                      className="mt-1"
                    />
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">执行指令</label>
                  <Textarea
                    value={addInstruction}
                    onChange={(e) => setAddInstruction(e.target.value)}
                    placeholder="任务指令"
                    className="mt-1 min-h-[80px]"
                  />
                </div>
                {addError && (
                  <p className="text-sm text-destructive">{addError}</p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>
                  取消
                </Button>
                <Button onClick={handleAdd} disabled={addSubmitting}>
                  {addSubmitting ? "创建中..." : "创建"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        }
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        {loading && jobs.length === 0 ? (
          <div className="p-4 text-muted-foreground">加载中...</div>
        ) : error ? (
          <div className="p-4 text-destructive">{error}</div>
        ) : !selectedJob ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm px-6 py-8">
            从左侧选择任务查看详情
          </div>
        ) : (
          <div className="flex-1 min-w-0 px-6 py-5 overflow-auto max-w-3xl">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-foreground">任务详情</h4>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={editSaving}
                >
                  {editSaving ? "保存中..." : "保存"}
                </Button>
              </div>
              {editError && (
                <p className="text-sm text-destructive">{editError}</p>
              )}
              <div className="grid gap-3">
                <div>
                  <label className="text-sm font-medium text-foreground">名称</label>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">调度类型</label>
                  <Select
                    value={editScheduleType}
                    onValueChange={(v) =>
                      setEditScheduleType(v as "cron" | "at" | "every")
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="选择类型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cron">Cron</SelectItem>
                      <SelectItem value="at">At</SelectItem>
                      <SelectItem value="every">Every</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">调度设置</label>
                  {editScheduleType === "cron" ? (
                    <div className="mt-2">
                      <CronTimePicker
                        value={editSchedule}
                        onChange={setEditSchedule}
                      />
                    </div>
                  ) : (
                    <Input
                      value={editSchedule}
                      onChange={(e) => setEditSchedule(e.target.value)}
                      placeholder={getSchedulePlaceholder(editScheduleType)}
                      className="mt-1 font-mono"
                    />
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">执行指令</label>
                  <Textarea
                    value={editInstruction}
                    onChange={(e) => setEditInstruction(e.target.value)}
                    className="mt-1 min-h-[80px]"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="edit-enabled"
                    checked={editEnabled}
                    onCheckedChange={(v) => setEditEnabled(v === true)}
                  />
                  <label
                    htmlFor="edit-enabled"
                    className="text-sm text-foreground cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    启用
                  </label>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium text-foreground mb-2">执行状态</h4>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>上次: {formatTs(selectedJob.last_run)}</p>
                  <p>下次: {formatTs(selectedJob.next_run)}</p>
                  <p>执行 {selectedJob.run_count} 次</p>
                </div>
              </div>

              {selectedJob.last_result && (
                <div>
                  <h4 className="text-sm font-medium text-foreground mb-2">最近产出</h4>
                  <pre className="text-xs text-foreground bg-muted/50 p-3 rounded overflow-auto max-h-48">
                    {selectedJob.last_result.success
                      ? selectedJob.last_result.output ||
                        "(无输出)"
                      : selectedJob.last_result.error || "(失败无详情)"}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {historyCronId && (
        <Dialog
          open={!!historyCronId}
          onOpenChange={(open) => !open && setHistoryCronId(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>执行历史</DialogTitle>
            </DialogHeader>
            <div className="max-h-64 overflow-auto space-y-1 text-sm">
              {history.length === 0 ? (
                <p className="text-muted-foreground">暂无历史记录</p>
              ) : (
                history.map((h) => (
                  <div key={h.run_id} className="rounded border p-2">
                    <div className="flex justify-between">
                      <span
                        className={
                          h.success
                            ? "text-green-600 dark:text-green-400"
                            : "text-destructive"
                        }
                      >
                        {h.success ? "成功" : "失败"}
                      </span>
                      <span className="text-muted-foreground">
                        {formatTs(h.timestamp)} · {h.duration_ms}ms
                      </span>
                    </div>
                    <pre className="mt-1 text-xs text-foreground overflow-auto max-h-20 bg-muted/50 p-1 rounded">
                      {h.output || h.error || "-"}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
