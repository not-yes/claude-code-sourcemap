import { useState, useEffect, useCallback } from "react";
import { getStats, getCostHistory } from "@/api/tauri-api";
import type { StatsResult, CostHistoryResult } from "@/api/tauri-api";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  RefreshCw,
  DollarSign,
  Cpu,
  Timer,
  GitPullRequest,
  Layers,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

function formatUptime(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs} 秒`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hours} 小时 ${rem} 分`;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ─── 子组件 ───────────────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
}: {
  icon: React.ElementType;
  title: string;
}) {
  return (
    <h4 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
      <Icon size={14} className="text-muted-foreground" />
      {title}
    </h4>
  );
}

function StatCard({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string | number;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={cn("font-medium text-sm text-foreground", valueClass)}>
        {value}
      </p>
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export function StatsPanel() {
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [costHistory, setCostHistory] = useState<CostHistoryResult | null>(null);
  const [trendView, setTrendView] = useState<"month" | "week">("month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getStats();
      setStats(data);
      try {
        const historyData = await getCostHistory();
        setCostHistory(historyData);
      } catch {
        // 历史数据加载失败不阻断主面板展示
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !stats) {
    return (
      <div className="px-6 py-5 text-muted-foreground text-sm animate-pulse">
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-5 space-y-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={load}>
          重试
        </Button>
      </div>
    );
  }

  // 使用默认值避免 null 访问
  const s: StatsResult = stats ?? {
    totalCostUsd: 0,
    modelUsage: {},
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    apiDurationMs: 0,
    apiDurationWithoutRetriesMs: 0,
    toolDurationMs: 0,
    linesAdded: 0,
    linesRemoved: 0,
    totalSessions: 0,
    activeSession: false,
    uptime: 0,
    memoryUsage: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 },
  };

  // 防御性处理：后端可能返回 null/undefined 的嵌套字段
  const modelUsage = s.modelUsage ?? {};
  const memoryUsage = s.memoryUsage ?? { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 };

  const cacheRatio =
    (s.inputTokens ?? 0) + (s.cacheReadTokens ?? 0) > 0
      ? ((s.cacheReadTokens ?? 0) / ((s.inputTokens ?? 0) + (s.cacheReadTokens ?? 0))) * 100
      : 0;

  const modelEntries = Object.entries(modelUsage);

  return (
    <div className="px-6 py-5 space-y-6 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-foreground flex items-center gap-2">
          <BarChart3 size={18} />
          运行统计
        </h3>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>

      {/* 1. LLM 成本概览 */}
      <div>
        <SectionHeader icon={DollarSign} title="LLM 成本概览" />
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="总成本"
            value={`$${s.totalCostUsd.toFixed(4)}`}
            valueClass="text-amber-500"
          />
          <StatCard
            label="总 Token"
            value={s.totalTokens.toLocaleString()}
          />
          <StatCard
            label="缓存命中率"
            value={`${cacheRatio.toFixed(1)}%`}
            valueClass="text-emerald-500"
          />
        </div>
      </div>

      {/* 2. Token 明细 */}
      <div>
        <SectionHeader icon={Cpu} title="Token 明细" />
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="输入 Token"
            value={s.inputTokens.toLocaleString()}
          />
          <StatCard
            label="输出 Token"
            value={s.outputTokens.toLocaleString()}
          />
          <StatCard
            label="缓存读取 Token"
            value={s.cacheReadTokens.toLocaleString()}
          />
          <StatCard
            label="缓存创建 Token"
            value={s.cacheCreationTokens.toLocaleString()}
          />
        </div>
      </div>

      {/* 3. 性能指标 */}
      <div>
        <SectionHeader icon={Timer} title="性能指标" />
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="API 总耗时"
            value={formatDuration(s.apiDurationMs)}
          />
          <StatCard
            label="API 耗时（去重试）"
            value={formatDuration(s.apiDurationWithoutRetriesMs)}
          />
          <StatCard
            label="工具执行耗时"
            value={formatDuration(s.toolDurationMs)}
          />
        </div>
      </div>

      {/* 4. 代码变更 */}
      <div>
        <SectionHeader icon={GitPullRequest} title="代码变更" />
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="新增行数"
            value={`+${s.linesAdded.toLocaleString()}`}
            valueClass="text-emerald-500"
          />
          <StatCard
            label="删除行数"
            value={`-${s.linesRemoved.toLocaleString()}`}
            valueClass="text-red-500"
          />
        </div>
      </div>

      {/* 5. 按模型分解（有数据才显示） */}
      {modelEntries.length > 0 && (
        <div>
          <SectionHeader icon={Layers} title="按模型分解" />
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto] text-xs text-muted-foreground px-3 py-2 bg-muted/40 border-b border-border">
              <span>模型</span>
              <span className="text-right mr-4">Token</span>
              <span className="text-right">成本</span>
            </div>
            {modelEntries.map(([model, usage]) => (
              <div
                key={model}
                className="grid grid-cols-[1fr_auto_auto] px-3 py-2 text-xs border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors"
              >
                <span className="font-mono text-foreground truncate pr-2">
                  {model}
                </span>
                <span className="text-muted-foreground text-right mr-4 tabular-nums">
                  {(
                    usage.inputTokens +
                    usage.outputTokens
                  ).toLocaleString()}
                </span>
                <span className="text-amber-500 font-medium tabular-nums">
                  ${usage.costUSD.toFixed(4)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. 系统状态 */}
      <div>
        <SectionHeader icon={Activity} title="系统状态" />
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="会话数" value={s.totalSessions} />
          <StatCard label="运行时长" value={formatUptime(s.uptime)} />
          <StatCard
            label="内存使用"
            value={`${formatBytes(memoryUsage.heapUsed)} / ${formatBytes(memoryUsage.heapTotal)}`}
          />
        </div>
      </div>

      {/* 7. 成本趋势 */}
      {costHistory && (
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-foreground">成本趋势</h3>
            <div className="flex gap-1">
              <button
                onClick={() => setTrendView("month")}
                className={cn(
                  "px-2.5 py-1 rounded text-xs transition-colors",
                  trendView === "month"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                月度
              </button>
              <button
                onClick={() => setTrendView("week")}
                className={cn(
                  "px-2.5 py-1 rounded text-xs transition-colors",
                  trendView === "week"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                周度
              </button>
            </div>
          </div>

          {/* 趋势列表 */}
          <div className="space-y-2">
            {(() => {
              const data = trendView === "month" ? costHistory.byMonth : costHistory.byWeek;
              const sortedKeys = Object.keys(data).sort().reverse();
              const displayKeys = trendView === "month" ? sortedKeys.slice(0, 3) : sortedKeys.slice(0, 8);

              if (displayKeys.length === 0) {
                return (
                  <p className="text-xs text-muted-foreground py-2">暂无历史数据</p>
                );
              }

              return displayKeys.map((key) => {
                const stats = data[key];
                return (
                  <div key={key} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
                    <span className="text-sm font-mono text-foreground">{key}</span>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>${stats.costUSD.toFixed(4)}</span>
                      <span>{((stats.inputTokens + stats.outputTokens) / 1000).toFixed(1)}k tokens</span>
                      <span>{stats.sessions} 次会话</span>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
