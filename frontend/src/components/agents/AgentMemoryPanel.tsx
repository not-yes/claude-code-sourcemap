import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Trash2, RefreshCw, Brain, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  getAgentMemoryStats,
  getAgentMemoryRecent,
  searchAgentMemory,
  clearAgentMemory,
  type AgentMemoryEntry,
} from "@/api/tauri-api";
import type { AgentMemoryStatsCounts } from "@/types/agents";

interface AgentMemoryPanelProps {
  agentId: string;
}

// ---------- stat card ----------

function StatCard({
  icon,
  label,
  value,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | undefined;
  loading: boolean;
}) {
  return (
    <Card className="flex items-center gap-3 p-3 shadow-none">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        {loading ? (
          <div className="mt-0.5 h-4 w-10 animate-pulse rounded bg-muted" />
        ) : (
          <p className="text-base font-semibold leading-tight text-foreground">
            {value ?? "—"}
          </p>
        )}
      </div>
    </Card>
  );
}

// ---------- memory entry ----------

function MemoryEntryRow({
  entry,
  highlight,
}: {
  entry: AgentMemoryEntry;
  highlight?: string;
}) {
  const time = entry.created_at
    ? (() => {
        try {
          return new Date(entry.created_at).toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          });
        } catch {
          return entry.created_at;
        }
      })()
    : null;

  const highlightContent = (text: string, kw: string | undefined) => {
    if (!kw || !kw.trim()) return <span>{text}</span>;
    const idx = text.toLowerCase().indexOf(kw.toLowerCase());
    if (idx === -1) return <span>{text}</span>;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="rounded bg-yellow-200 px-0.5 text-yellow-900 dark:bg-yellow-800/60 dark:text-yellow-200">
          {text.slice(idx, idx + kw.length)}
        </mark>
        {text.slice(idx + kw.length)}
      </>
    );
  };

  return (
    <div className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted/50 text-[10px] text-muted-foreground font-semibold">
        M
      </div>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm text-foreground leading-snug">
          {highlightContent(entry.content, highlight)}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {time && (
            <span className="text-[11px] text-muted-foreground">{time}</span>
          )}
          {entry.importance != null && (
            <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              重要度 {entry.importance.toFixed(2)}
            </span>
          )}
          {entry.access_count != null && (
            <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              访问 {entry.access_count} 次
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- main panel ----------

const PAGE_SIZE = 20;

export function AgentMemoryPanel({ agentId }: AgentMemoryPanelProps) {
  // --- stats ---
  const [stats, setStats] = useState<AgentMemoryStatsCounts | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  // --- recent ---
  const [recentEntries, setRecentEntries] = useState<AgentMemoryEntry[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentLimit, setRecentLimit] = useState(PAGE_SIZE);

  // --- search ---
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AgentMemoryEntry[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchedQuery, setSearchedQuery] = useState("");

  // --- clear dialog ---
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const abortRef = useRef<{ stats?: boolean; recent?: boolean; search?: boolean }>({});

  const loadStats = useCallback(async () => {
    let cancelled = false;
    setStatsLoading(true);
    setStatsError(null);
    try {
      const r = await getAgentMemoryStats(agentId);
      if (!cancelled && !abortRef.current.stats) setStats(r.stats);
    } catch (e) {
      if (!cancelled && !abortRef.current.stats)
        setStatsError(e instanceof Error ? e.message : "加载统计失败");
    } finally {
      if (!cancelled && !abortRef.current.stats) setStatsLoading(false);
    }
    return () => { cancelled = true; };
  }, [agentId]);

  const loadRecent = useCallback(
    async (limit: number) => {
      let cancelled = false;
      setRecentLoading(true);
      setRecentError(null);
      try {
        const r = await getAgentMemoryRecent(agentId, { limit });
        if (!cancelled && !abortRef.current.recent) setRecentEntries(r.results);
      } catch (e) {
        if (!cancelled && !abortRef.current.recent)
          setRecentError(e instanceof Error ? e.message : "加载记忆失败");
      } finally {
        if (!cancelled && !abortRef.current.recent) setRecentLoading(false);
      }
      return () => { cancelled = true; };
    },
    [agentId]
  );

  useEffect(() => {
    abortRef.current = { stats: false, recent: false, search: false };
    setSearchResults(null);
    setQuery("");
    setRecentLimit(PAGE_SIZE);
    loadStats();
    loadRecent(PAGE_SIZE);
    return () => {
      // cleanup 时设置 abort 标志，防止异步操作完成后设置已卸载组件的状态
      abortRef.current = { stats: true, recent: true, search: true };
    };
  }, [agentId, loadStats, loadRecent]);

  const handleLoadMore = () => {
    const next = recentLimit + PAGE_SIZE;
    setRecentLimit(next);
    loadRecent(next);
  };

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    abortRef.current.search = false;
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults(null);
    try {
      const r = await searchAgentMemory(agentId, { q });
      if (!abortRef.current.search) {
        setSearchResults(r.results);
        setSearchedQuery(q);
      }
    } catch (e) {
      if (!abortRef.current.search)
        setSearchError(e instanceof Error ? e.message : "搜索失败");
    } finally {
      if (!abortRef.current.search) setSearchLoading(false);
    }
  };

  const handleClearConfirm = async () => {
    setClearing(true);
    setClearError(null);
    try {
      await clearAgentMemory(agentId);
      setClearOpen(false);
      setSearchResults(null);
      setRecentEntries([]);
      setRecentLimit(PAGE_SIZE);
      await loadStats();
      await loadRecent(PAGE_SIZE);
    } catch (e) {
      setClearError(e instanceof Error ? e.message : "清空记忆失败");
    } finally {
      setClearing(false);
    }
  };

  const displayedEntries = searchResults !== null ? searchResults : recentEntries;
  const isSearch = searchResults !== null;

  return (
    <div className="space-y-4">
      {/* ---- stats row ---- */}
      <div className="grid grid-cols-1 gap-2">
        <StatCard
          icon={<Database className="h-4 w-4" />}
          label="总记忆数"
          value={stats?.total ?? undefined}
          loading={statsLoading}
        />
      </div>
      {statsError && (
        <p className="text-xs text-destructive">{statsError}</p>
      )}

      {/* ---- search ---- */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
            }}
            placeholder="搜索记忆内容..."
            className="pl-8 shadow-none text-sm"
          />
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleSearch}
          disabled={searchLoading || !query.trim()}
          className="shadow-none shrink-0"
        >
          {searchLoading ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            "搜索"
          )}
        </Button>
        {isSearch && (
          <Button
            size="sm"
            variant="ghost"
            className="shadow-none shrink-0 text-muted-foreground"
            onClick={() => {
              setSearchResults(null);
              setQuery("");
              setSearchedQuery("");
            }}
          >
            清除
          </Button>
        )}
      </div>

      {/* ---- list header ---- */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          {isSearch
            ? `搜索"${searchedQuery}"的结果（${searchResults!.length} 条）`
            : "最近记忆"}
        </p>
        {!isSearch && (
          <button
            type="button"
            onClick={() => {
              loadStats();
              loadRecent(recentLimit);
            }}
            disabled={recentLoading || statsLoading}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            <RefreshCw
              className={cn(
                "h-3 w-3",
                (recentLoading || statsLoading) && "animate-spin"
              )}
            />
            刷新
          </button>
        )}
      </div>

      {/* ---- entry list ---- */}
      <div className="rounded-xl border border-border/70 bg-background">
        {searchError && (
          <p className="px-3 py-3 text-xs text-destructive">{searchError}</p>
        )}
        {recentError && !isSearch && (
          <p className="px-3 py-3 text-xs text-destructive">{recentError}</p>
        )}
        {(isSearch ? searchLoading : recentLoading) && (
          <div className="flex items-center justify-center px-3 py-6">
            <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="ml-2 text-xs text-muted-foreground">加载中…</span>
          </div>
        )}
        {!searchLoading && !recentLoading && displayedEntries.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
            <Brain className="h-8 w-8 opacity-30" />
            <p className="text-xs">{isSearch ? "没有匹配的记忆" : "暂无记忆"}</p>
          </div>
        )}
        {!searchLoading &&
          !(isSearch ? searchLoading : recentLoading) &&
          displayedEntries.length > 0 && (
            <div className="divide-y divide-border/50">
              {displayedEntries.map((entry) => (
                <MemoryEntryRow
                  key={entry.id}
                  entry={entry}
                  highlight={isSearch ? searchedQuery : undefined}
                />
              ))}
            </div>
          )}
        {!isSearch &&
          !recentLoading &&
          recentEntries.length >= recentLimit && (
            <div className="flex justify-center border-t border-border/50 px-3 py-2">
              <button
                type="button"
                onClick={handleLoadMore}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                加载更多
              </button>
            </div>
          )}
      </div>

      {/* ---- clear button ---- */}
      <div className="flex items-center justify-between pt-1">
        <p className="text-[11px] text-muted-foreground">
          清空后不可恢复
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shadow-none border-destructive/50 text-destructive hover:bg-destructive/5 hover:text-destructive"
          onClick={() => {
            setClearError(null);
            setClearOpen(true);
          }}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          清空所有记忆
        </Button>
      </div>

      {/* ---- confirm dialog ---- */}
      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>清空 Agent 记忆</DialogTitle>
            <DialogDescription>
              确定清空「{agentId}」在服务端缓存中的全部记忆？此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          {clearError && (
            <p className="text-sm text-destructive">{clearError}</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setClearOpen(false)}
              disabled={clearing}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleClearConfirm}
              disabled={clearing}
            >
              {clearing ? "清空中…" : "确认清空"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
