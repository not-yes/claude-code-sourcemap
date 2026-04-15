import { useState, useEffect, useRef } from "react";
import { Search, Plus, Play, History, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { useAgents } from "@/hooks/useAgents";
import { useCronStore } from "@/stores/cronStore";
import { useSkills } from "@/hooks/useSkills";
import { runCronJob, deleteCronJob, getSessions, ensureAgent, type CronJob } from "@/api/tauri-api";
import type { SkillItem } from "@/hooks/useSkills";
import { AgentAvatar } from "@/components/agents/AgentAvatar";
import { CreateAgentDialog } from "@/components/agents/CreateAgentDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAgentMetadataStore } from "@/stores/agentMetadataStore";
import { toast } from "sonner";
import { useUnreadStore } from "@/stores/unreadStore";
import { useUnreadPolling } from "@/hooks/useUnreadPolling";
import { useAgentsStore } from "@/stores/agentsStore";

function formatCronTs(ts?: number) {
  if (!ts) return "-";
  return new Date(ts * 1000).toLocaleString("zh-CN");
}

function CronTaskList({
  jobs,
  loading,
  selectedId,
  onSelect,
  onRun,
  onDelete,
  onHistory,
}: {
  jobs: CronJob[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRun: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void;
  onHistory: (id: string) => void;
}) {
  if (loading)
    return (
      <p className="px-3 py-4 text-sm text-muted-foreground">加载中...</p>
    );
  if (jobs.length === 0)
    return (
      <p className="px-3 py-4 text-sm text-muted-foreground">暂无定时任务</p>
    );
  return (
    <div className="p-2 space-y-2">
      {jobs.map((j) => (
        <div
          key={j.id}
          className={cn(
            "rounded-lg border p-3 cursor-pointer transition-colors",
            selectedId === j.id
              ? "border-primary bg-primary/5"
              : "hover:bg-muted/30"
          )}
          onClick={() => onSelect(j.id)}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate text-foreground">{j.name}</p>
              <p className="text-xs text-muted-foreground">cron: {j.schedule}</p>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {j.instruction}
              </p>
            </div>
            <div
              className="flex shrink-0 gap-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onRun(j.id)} title="执行">
                <Play size={12} />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onHistory(j.id)} title="历史">
                <History size={12} />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(j.id)} title="删除">
                <Trash2 size={12} />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0 text-xs text-muted-foreground mt-2">
            <span>上次: {formatCronTs(j.last_run)}</span>
            <span>下次: {formatCronTs(j.next_run)}</span>
            <span>执行 {j.run_count} 次</span>
            {!j.enabled && <span className="text-amber-600 dark:text-amber-500">已禁用</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 按 category 分组，category 为空或 "general" 归为「其他」 */
function groupSkillsByCategory(skills: SkillItem[]): Map<string, SkillItem[]> {
  const map = new Map<string, SkillItem[]>();
  for (const s of skills) {
    const cat = s.category?.trim() && s.category !== "general" ? s.category : "其他";
    const arr = map.get(cat) ?? [];
    arr.push(s);
    map.set(cat, arr);
  }
  const sorted = new Map<string, SkillItem[]>();
  const keys = [...map.keys()].sort((a, b) => {
    if (a === "其他") return 1;
    if (b === "其他") return -1;
    return a.localeCompare(b);
  });
  for (const k of keys) sorted.set(k, (map.get(k) ?? []).sort((a, b) => a.name.localeCompare(b.name)));
  return sorted;
}

function SkillsList({
  skills,
  loading,
  selectedId,
  onSelect,
}: {
  skills: SkillItem[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (loading)
    return (
      <p className="px-3 py-4 text-sm text-muted-foreground">加载中...</p>
    );
  if (skills.length === 0)
    return (
      <p className="px-3 py-4 text-sm text-muted-foreground">暂无 Skills</p>
    );
  const byCategory = groupSkillsByCategory(skills);
  return (
    <div className="p-2 space-y-4">
      {[...byCategory.entries()].map(([category, items]) => (
        <div key={category}>
          <p className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {category}
          </p>
          <div className="space-y-2 mt-1">
            {items.map((s) => (
              <div
                key={s.id}
                className={cn(
                  "rounded-lg border p-3 cursor-pointer transition-colors",
                  selectedId === s.id
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/30"
                )}
                onClick={() => onSelect(s.id)}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate text-foreground">{s.name}</p>
                  {s.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {s.description}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0 text-xs text-muted-foreground mt-2">
                  <span>v{s.version}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentListItem({
  selected,
  isMaster,
  displayName,
  subtitle,
  onClick,
  onAvatarClick,
  agentAvatar,
  unreadCount,
  isRunning,
}: {
  id: string;
  selected: boolean;
  isMaster: boolean;
  displayName: string;
  subtitle?: string;
  onClick: () => void;
  onAvatarClick: () => void;
  setAgentInfoDialogOpenId?: (id: string | null) => void;
  agentAvatar?: React.ReactNode;
  unreadCount?: number;
  isRunning?: boolean;
}) {
  const avatar = isMaster ? (
    <div
      className="w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center shrink-0 cursor-pointer hover:opacity-90"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onAvatarClick();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          onAvatarClick();
        }
      }}
    >
      <span className="text-lg font-medium text-primary">主</span>
    </div>
  ) : (
    <div
      className="cursor-pointer hover:opacity-90"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onAvatarClick();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          onAvatarClick();
        }
      }}
    >
      {agentAvatar}
    </div>
  );

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors",
        selected
          ? "bg-primary/10 dark:bg-primary/20 text-foreground"
          : "hover:bg-muted/50 dark:hover:bg-muted/60 text-foreground"
      )}
    >
      {avatar}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={cn(
                "inline-block w-2 h-2 rounded-full shrink-0",
                isRunning ? "bg-green-500" : "bg-gray-400 dark:bg-gray-500"
              )}
              title={isRunning ? "运行中" : "未启动"}
            />
            <span className="font-medium truncate text-foreground">{displayName}</span>
          </div>
          {unreadCount != null && unreadCount > 0 && (
            <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-medium text-white shrink-0">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        )}
      </div>
    </button>
  );
}

export function ContentList() {
  const activeNav = useAppStore((s) => s.activeNav);
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const selectedCronId = useAppStore((s) => s.selectedCronId);
  const selectedSkillId = useAppStore((s) => s.selectedSkillId);
  const selectedSettingsCategory = useAppStore(
    (s) => s.selectedSettingsCategory
  );
  const setSelectedAgent = useAppStore((s) => s.setSelectedAgent);
  const setAgentDetailViewId = useAppStore((s) => s.setAgentDetailViewId);
  const workingDirectories = useAppStore((s) => s.workingDirectories);
  const setSelectedCron = useAppStore((s) => s.setSelectedCron);
  const setSelectedSkill = useAppStore((s) => s.setSelectedSkill);
  const setSelectedSettingsCategory = useAppStore(
    (s) => s.setSelectedSettingsCategory
  );
  const setHistoryCronId = useAppStore((s) => s.setHistoryCronId);
  const contentListWidth = useAppStore(
    (s) => s.contentListWidthByNav[s.activeNav]
  );

  const [search, setSearch] = useState("");
  const [deleteCronId, setDeleteCronId] = useState<string | null>(null);
  const setAgentInfoDialogOpenId = useAppStore(
    (s) => s.setAgentInfoDialogOpenId
  );
  const { agents, loading: agentsLoading, error: agentsError, reload: agentsReload } = useAgents();
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const getMeta = useAgentMetadataStore((s) => s.get);
  const cronJobs = useCronStore((s) => s.jobs);
  const cronLoading = useCronStore((s) => s.loading);
  const cronReload = useCronStore((s) => s.reload);
  const { skills, loading: skillsLoading, reload: skillsReload } = useSkills();
  const markAsSeen = useUnreadStore((s) => s.markAsSeen);
  const getUnreadCount = useUnreadStore((s) => s.getUnreadCount);
  const { isAgentRunning, refreshRunningAgents } = useAgentsStore();

  // 启动未读轮询
  useUnreadPolling(selectedAgentId);

  // 定时刷新 Agent 运行状态
  useEffect(() => {
    if (activeNav !== "agents") return;
    refreshRunningAgents();
    const interval = setInterval(refreshRunningAgents, 10000);
    return () => clearInterval(interval);
  }, [activeNav, refreshRunningAgents]);

  // 存储每个 agent 的最近会话摘要: agentId -> 摘要字符串
  const [agentSessionSummaries, setAgentSessionSummaries] = useState<Record<string, string>>({});
  const summaryLoadedForRef = useRef<string>("");

  useEffect(() => {
    if (activeNav === "cron") cronReload();
  }, [activeNav, cronReload]);

  useEffect(() => {
    if (activeNav === "skills") skillsReload();
  }, [activeNav, skillsReload]);

  // Auto-select Master when switching to agents and none selected
  useEffect(() => {
    if (activeNav === "agents" && !selectedAgentId) {
      setSelectedAgent("main");
    }
  }, [activeNav, selectedAgentId, setSelectedAgent]);

  // 当 agents 列表变化时，并发加载每个 agent 的最近会话摘要
  useEffect(() => {
    if (agentsLoading || agents.length === 0) return;
    // 用 agent ids 的 join 字符串作为缓存键，避免重复加载相同列表
    const cacheKey = agents.map((a) => a.id).join(",");
    if (summaryLoadedForRef.current === cacheKey) return;
    summaryLoadedForRef.current = cacheKey;

    const loadSummaries = async () => {
      const results: Record<string, string> = {};
      await Promise.all(
        agents.map(async (agent) => {
          try {
            const sessions = await getSessions({ agent_id: agent.id, limit: 1 });
            if (sessions.length > 0) {
              const session = sessions[0];
              const raw = session.title ?? session.task ?? "";
              if (raw) {
                results[agent.id] = raw.length > 18 ? raw.slice(0, 18) + "…" : raw;
              }
            }
          } catch (err) {
            // 静默失败，不影响列表显示
            console.warn(`[ContentList] getSessions 失败 agentId=${agent.id}:`, err);
          }
        })
      );
      setAgentSessionSummaries((prev) => ({ ...prev, ...results }));
    };

    loadSummaries();
  }, [agents, agentsLoading]);

  // Auto-select first settings category when switching to settings
  useEffect(() => {
    if (activeNav === "settings" && !selectedSettingsCategory) {
      setSelectedSettingsCategory("model-api");
    }
  }, [activeNav, selectedSettingsCategory, setSelectedSettingsCategory]);

  const SETTINGS_CATEGORIES = [
    { id: "model-api", label: "模型与 API" },
    { id: "appearance", label: "外观与界面" },
    { id: "session", label: "会话与文件" },
    { id: "notifications", label: "通知设置" },
    { id: "env", label: "环境变量" },
    { id: "advanced", label: "高级设置" },
    { id: "sync-config", label: "配置同步" },
  ];

  const filteredAgents = search
    ? agents.filter((a) =>
        a.name.toLowerCase().includes(search.toLowerCase())
      )
    : agents;

  const filteredCron = search
    ? cronJobs.filter(
        (j) =>
          j.name.toLowerCase().includes(search.toLowerCase()) ||
          j.id.toLowerCase().includes(search.toLowerCase())
      )
    : cronJobs;

  const filteredSkills = search
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.description.toLowerCase().includes(search.toLowerCase()) ||
          s.id.toLowerCase().includes(search.toLowerCase())
      )
    : skills;

  return (
    <aside
      className="flex shrink-0 flex-col bg-[#f7f7f7] dark:bg-[#252525]"
      style={{ width: contentListWidth }}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索"
            className="h-9 w-full rounded-full border-0 bg-muted/30 pl-9 pr-3 text-sm shadow-none ring-offset-0 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 dark:bg-muted/40"
          />
        </div>
        <button
          type="button"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/30 text-foreground hover:bg-muted/50 dark:bg-muted/50 dark:hover:bg-muted/40"
          title={activeNav === "agents" ? "新建 Agent" : "新建"}
          onClick={() => {
            if (activeNav === "agents") setCreateAgentOpen(true);
          }}
        >
          <Plus size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {activeNav === "agents" && (
          <>
            <AgentListItem
              id="main"
              selected={selectedAgentId === "main"}
              isMaster
              displayName={getMeta("main")?.displayName ?? "主聊"}
              subtitle="Master · 默认对话"
              onClick={() => {
                setSelectedAgent("main");
                setAgentDetailViewId(null);
                markAsSeen("main");
              }}
              onAvatarClick={() => setAgentInfoDialogOpenId("main")}
              unreadCount={getUnreadCount("main")}
              isRunning={isAgentRunning("main")}
            />
            {agentsError && !agentsLoading && (
              <div className="px-3 py-3 text-center">
                <p className="text-xs text-destructive mb-2">加载失败</p>
                <button
                  onClick={() => useAgentsStore.getState().load()}
                  className="text-xs text-primary hover:underline"
                >
                  重新加载
                </button>
              </div>
            )}
            {agentsLoading && (
              <p className="px-3 py-4 text-sm text-muted-foreground">加载中...</p>
            )}
            {!agentsLoading &&
              filteredAgents.map((a) => {
                const meta = getMeta(a.id);
                const displayName = meta?.displayName ?? a.name;
                const summary = agentSessionSummaries[a.id];
                const subtitle = summary ?? `Agent ID: ${a.id}`;
                return (
            <AgentListItem
              key={a.id}
              id={a.id}
              selected={selectedAgentId === a.id}
              isMaster={false}
              displayName={displayName}
              subtitle={subtitle}
              onClick={() => {
                setSelectedAgent(a.id);
                setAgentDetailViewId(null);
                markAsSeen(a.id);
                // 预启动 Agent（非阻塞，失败不影响选择）
                // 优先使用 per-agent 保存的工作目录
                ensureAgent(a.id, useAppStore.getState().agentWorkingDirectory[a.id] ?? workingDirectories[0] ?? "")
                  .then(() => {
                    refreshRunningAgents();
                  })
                  .catch((err) => {
                    console.warn(`[ContentList] 预启动 Agent ${a.id} 失败:`, err);
                  });
              }}
              onAvatarClick={() => {
                setSelectedAgent(a.id);
                setAgentDetailViewId(a.id);
              }}
              agentAvatar={<AgentAvatar agentId={a.id} name={a.name} />}
              unreadCount={getUnreadCount(a.id)}
              isRunning={isAgentRunning(a.id)}
            />
                );
              })}
            {!agentsLoading && !agentsError && filteredAgents.length === 0 && (
              <div className="px-3 py-4 text-center">
                <p className="text-sm text-muted-foreground mb-2">暂无其他 Agent</p>
                <button
                  onClick={() => useAgentsStore.getState().load()}
                  className="text-xs text-primary hover:underline"
                >
                  刷新列表
                </button>
              </div>
            )}
          </>
        )}

        {activeNav === "cron" && (
          <CronTaskList
            jobs={filteredCron}
            loading={cronLoading}
            selectedId={selectedCronId}
            onSelect={setSelectedCron}
            onRun={(id) => {
              runCronJob(id)
                .then(() => cronReload())
                .catch((e) => toast.error(e instanceof Error ? e.message : "执行失败"));
            }}
            onDelete={(id) => setDeleteCronId(id)}
            onHistory={(id) => setHistoryCronId(id)}
          />
        )}

        {activeNav === "skills" && (
          <SkillsList
            skills={filteredSkills}
            loading={skillsLoading}
            selectedId={selectedSkillId}
            onSelect={setSelectedSkill}
          />
        )}

        {activeNav === "stats" && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            任务统计已在右侧显示
          </div>
        )}

        {activeNav === "settings" && (
          <div className="p-2 space-y-0.5">
            {SETTINGS_CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedSettingsCategory(c.id)}
                className={cn(
                  "w-full px-3 py-2.5 text-left text-sm rounded-lg transition-colors",
                  selectedSettingsCategory === c.id
                    ? "bg-primary/10 dark:bg-primary/20"
                    : "hover:bg-muted/50 dark:hover:bg-muted/60"
                )}
              >
                <span className="text-foreground">{c.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <CreateAgentDialog
        open={createAgentOpen}
        onOpenChange={setCreateAgentOpen}
        onSuccess={(newName) => {
          agentsReload();
          if (newName) {
            setSelectedAgent(newName);
            setAgentDetailViewId(newName);
          }
        }}
      />
      <ConfirmDialog
        open={!!deleteCronId}
        onOpenChange={(open) => !open && setDeleteCronId(null)}
        title="删除定时任务"
        description="确定删除该定时任务？此操作不可恢复。"
        confirmLabel="删除"
        variant="destructive"
        onConfirm={async () => {
          if (!deleteCronId) return;
          await deleteCronJob(deleteCronId);
          if (selectedCronId === deleteCronId) setSelectedCron(null);
          cronReload();
        }}
      />
    </aside>
  );
}
