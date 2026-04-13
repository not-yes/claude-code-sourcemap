import { useEffect, useRef, useState, useCallback } from "react";
import { getHealth, ping, getStatus, getStats, listTools } from "@/api/tauri-api";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

type ConnectionState = "connected" | "connecting" | "disconnected";

interface ToolItem {
  name?: string;
  description?: string;
  [key: string]: unknown;
}

interface StatusInfo {
  [key: string]: unknown;
}

interface StatsInfo {
  [key: string]: unknown;
}

const POLL_INTERVAL_MS = 10_000;

function StatusDot({ state }: { state: ConnectionState }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        state === "connected" && "bg-green-500 shadow-sm shadow-green-500/50",
        state === "connecting" && "bg-yellow-400 animate-pulse",
        state === "disconnected" && "bg-red-500"
      )}
    />
  );
}

function StatusLabel({ state }: { state: ConnectionState }) {
  const text =
    state === "connected"
      ? "已连接"
      : state === "connecting"
      ? "连接中"
      : "未连接";
  return <span className="text-xs text-muted-foreground">{text}</span>;
}

function KeyValueRow({ label, value }: { label: string; value: unknown }) {
  const display =
    value === null || value === undefined
      ? "—"
      : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  return (
    <div className="flex items-start justify-between gap-2 py-0.5">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-mono text-right break-all max-w-[160px]">{display}</span>
    </div>
  );
}

export function ConnectionStatus() {
  const [state, setState] = useState<ConnectionState>("connecting");
  const [open, setOpen] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);

  const [statusInfo, setStatusInfo] = useState<StatusInfo | null>(null);
  const [statsInfo, setStatsInfo] = useState<StatsInfo | null>(null);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkPing = useCallback(async () => {
    try {
      // 先检查 sidecar 进程是否运行
      const running = await getHealth();
      if (!running) {
        setState("disconnected");
        return;
      }
      // 再 ping 一下确认响应
      await ping();
      setState("connected");
    } catch {
      setState("disconnected");
    }
  }, []);

  // 启动轮询
  useEffect(() => {
    // 初始检查，立即标记为 connecting
    setState("connecting");
    checkPing();

    timerRef.current = setInterval(checkPing, POLL_INTERVAL_MS);

    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [checkPing]);

  // 打开 Popover 时加载详细信息
  const loadDetails = useCallback(async () => {
    if (state !== "connected") return;
    setLoadingDetails(true);
    try {
      const [s, st, t] = await Promise.allSettled([
        getStatus(),
        getStats(),
        listTools(),
      ]);
      if (s.status === "fulfilled") setStatusInfo(s.value);
      if (st.status === "fulfilled") setStatsInfo(st.value as unknown as StatsInfo);
      if (t.status === "fulfilled") setTools(t.value as ToolItem[]);
    } finally {
      setLoadingDetails(false);
    }
  }, [state]);

  const handleOpenChange = useCallback(
    (val: boolean) => {
      setOpen(val);
      if (val) loadDetails();
    },
    [loadDetails]
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className="group flex h-10 w-full items-center justify-center gap-1.5 rounded-xl text-muted-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 dark:hover:bg-muted/40 transition-all duration-200 hover:scale-105"
          title={
            state === "connected"
              ? "Sidecar 已连接，点击查看详情"
              : state === "connecting"
              ? "正在连接 Sidecar…"
              : "Sidecar 未连接"
          }
        >
          <StatusDot state={state} />
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        className="w-72 p-3"
      >
        {/* 头部：状态 */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Sidecar 状态</span>
          <div className="flex items-center gap-1.5">
            <StatusDot state={state} />
            <StatusLabel state={state} />
          </div>
        </div>

        {state !== "connected" && (
          <p className="text-xs text-muted-foreground">
            {state === "connecting"
              ? "正在等待 Sidecar 启动，请稍候…"
              : "Sidecar 进程未运行。请在主界面中启动连接。"}
          </p>
        )}

        {state === "connected" && (
          <>
            {loadingDetails && (
              <p className="text-xs text-muted-foreground py-2">加载中…</p>
            )}

            {!loadingDetails && (
              <>
                {/* 运行状态 */}
                {statusInfo && Object.keys(statusInfo).length > 0 && (
                  <>
                    <Separator className="my-2" />
                    <p className="text-xs font-medium mb-1">运行状态</p>
                    {Object.entries(statusInfo).map(([k, v]) => (
                      <KeyValueRow key={k} label={k} value={v} />
                    ))}
                  </>
                )}

                {/* 系统统计 */}
                {statsInfo && Object.keys(statsInfo).length > 0 && (
                  <>
                    <Separator className="my-2" />
                    <p className="text-xs font-medium mb-1">系统统计</p>
                    {Object.entries(statsInfo).map(([k, v]) => (
                      <KeyValueRow key={k} label={k} value={v} />
                    ))}
                  </>
                )}

                {/* 工具列表 */}
                <Separator className="my-2" />
                <button
                  onClick={() => setToolsExpanded((v) => !v)}
                  className="flex w-full items-center justify-between text-xs font-medium hover:text-foreground transition-colors mb-1"
                >
                  <span className="flex items-center gap-1">
                    <Wrench size={12} />
                    已加载工具
                    <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                      {tools.length}
                    </Badge>
                  </span>
                  {toolsExpanded ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                </button>
                {toolsExpanded && (
                  <div className="max-h-40 overflow-auto rounded bg-muted/50 p-1.5">
                    {tools.length === 0 ? (
                      <span className="text-xs text-muted-foreground">暂无工具</span>
                    ) : (
                      tools.map((t, i) => (
                        <div
                          key={i}
                          className="py-0.5 px-1 text-xs font-mono text-foreground/80 truncate"
                          title={
                            typeof t.description === "string"
                              ? t.description
                              : String(t.name ?? i)
                          }
                        >
                          {String(t.name ?? t.description ?? `tool-${i}`)}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
