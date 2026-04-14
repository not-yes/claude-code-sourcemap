import { useState, useEffect, useCallback } from "react";
import { Search, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  getSessions,
  getSessionMessages,
  deleteSession,
  type SessionItem,
} from "@/api/tauri-api";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";

/** Map frontend agent to backend agent_id. main=主聊 → default; others → agent name. Never use "task" (Heartbeat). */
function toAgentId(selectedAgentId: string): string {
  return selectedAgentId === "main" ? "default" : selectedAgentId;
}

function formatSessionTime(ts?: string): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    const now = new Date();
    const sameDay =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    return sameDay
      ? d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString("zh-CN", {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
  } catch {
    return "";
  }
}

/** Display title: title > task first line > preview > session_id. Per API guide + preview fallback. */
function getDisplayTitle(
  session: SessionItem,
  preview?: string
): string {
  if (session.title?.trim()) return session.title.trim();
  if (session.task?.trim()) {
    const firstLine = session.task.split("\n")[0].trim();
    if (firstLine)
      return firstLine.length > 30 ? firstLine.slice(0, 30) + "…" : firstLine;
  }
  if (preview) return preview;
  return session.id?.slice(0, 20) ?? "无标题会话";
}

export function ConversationHistorySheet({
  open,
  onOpenChange,
  agentId,
  onSelectSession,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  onSelectSession: (sessionId: string) => void;
}) {
  // 获取当前 Agent 的工作目录
  const agentWorkingDirectory = useAppStore((s) => s.agentWorkingDirectory);
  const workingDirectories = useAppStore((s) => s.workingDirectories);
  const currentCwd = agentWorkingDirectory[agentId] ?? workingDirectories[0] ?? "";

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SessionItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadSessions = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const list = await getSessions({
        agent_id: toAgentId(agentId),
        cwd: currentCwd,
        limit: 100,
      });
      setSessions(list ?? []);
      setPreviews({});
      setLoading(false);
      // 后台拉取每条会话的首条用户消息作为预览（分批避免过多并发）
      const sessionList = list ?? [];
      const CONCURRENCY = 6;
      const next: Record<string, string> = {};
      for (let i = 0; i < sessionList.length; i += CONCURRENCY) {
        const batch = sessionList.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (s) => {
            const msgs = await getSessionMessages(s.id, toAgentId(agentId), { limit: 10 });
            const firstUser = msgs.find((m) => m.role === "user");
            return {
              id: s.id,
              preview: (() => {
                const c = firstUser?.content;
                if (!c) return "";
                const t = c.replace(/\s+/g, " ").trim();
                return t.length > 80 ? t.slice(0, 80) + "…" : t;
              })(),
            };
          })
        );
        results.forEach((r) => {
          if (r.status === "fulfilled" && r.value.preview) {
            next[r.value.id] = r.value.preview;
          }
        });
        setPreviews((p) => ({ ...p, ...next }));
      }
    } catch (e) {
      setSessions([]);
      setLoadError(
        e instanceof Error ? e.message : "无法加载历史会话，请确认后端可用"
      );
    } finally {
      setLoading(false);
    }
  }, [agentId, currentCwd]);

  useEffect(() => {
    if (open && agentId) loadSessions();
  }, [open, agentId, loadSessions]);

  const searchLower = search.trim().toLowerCase();
  const filtered = searchLower
    ? sessions.filter(
        (s) =>
          s.id?.toLowerCase().includes(searchLower) ||
          String(s.agent_id ?? "").toLowerCase().includes(searchLower) ||
          String(s.title ?? "").toLowerCase().includes(searchLower) ||
          String(s.task ?? "").toLowerCase().includes(searchLower) ||
          (previews[s.id] ?? "").toLowerCase().includes(searchLower)
      )
    : sessions;

  const handleSelect = (session: SessionItem) => {
    onSelectSession(session.id);
    onOpenChange(false);
  };

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteSession(deleteTarget.id, toAgentId(agentId));
      setDeleteTarget(null);
      await loadSessions();
    } finally {
      setDeleting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteTarget, loadSessions]);

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[90vw] max-h-[85vh] min-h-[400px] flex flex-col p-0 gap-0 border-0 shadow-xl rounded-xl overflow-hidden bg-background text-foreground">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle className="text-base font-medium text-foreground">历史会话</DialogTitle>
        </DialogHeader>
        <div className="px-6 pb-6 flex flex-col flex-1 min-h-0">
          <div className="relative mb-4">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索会话"
              className="pl-9 h-10 bg-muted/20 dark:bg-muted/50 border-0 rounded-md"
            />
          </div>
          <div className="flex-1 overflow-auto min-h-[280px] -mx-1">
            {loading ? (
              <p className="px-4 py-12 text-sm text-muted-foreground text-center">
                加载中...
              </p>
            ) : loadError ? (
              <p className="px-4 py-12 text-sm text-destructive text-center whitespace-pre-wrap">
                {loadError}
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-4 py-12 text-sm text-muted-foreground text-center">
                暂无历史会话（在连接后端并成功对话后，会话会出现在此）
              </p>
            ) : (
              <div className="space-y-0.5">
                {filtered.map((s) => (
                  <div
                    key={s.id}
                    className={cn(
                      "group relative flex items-center rounded-lg transition-colors",
                      "hover:bg-muted/40"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelect(s)}
                      className="flex-1 min-w-0 px-4 py-3 text-left"
                    >
                      <div className="truncate text-sm font-medium text-foreground pr-6">
                        {getDisplayTitle(s, previews[s.id])}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {formatSessionTime(s.updated_at ?? s.created_at)}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(s);
                      }}
                      disabled={deleting}
                      title="删除会话"
                      className={cn(
                        "absolute right-2 top-1/2 -translate-y-1/2",
                        "flex h-7 w-7 items-center justify-center rounded-md",
                        "text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10",
                        "opacity-0 group-hover:opacity-100 transition-all",
                        "disabled:opacity-0"
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <ConfirmDialog
      open={!!deleteTarget}
      onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      title="删除会话"
      description="确定删除此会话？此操作不可恢复。"
      confirmLabel="删除"
      cancelLabel="取消"
      variant="destructive"
      onConfirm={handleDeleteConfirm}
    />
    </>
  );
}
