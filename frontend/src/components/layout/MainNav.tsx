import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { WindowControls } from "./WindowControls";
import { BarChart3, Bot, Clock, Settings, Bug, Moon, Sun, BookMarked } from "lucide-react";
import { ConnectionStatus } from "./ConnectionStatus";
import { useState, useEffect } from "react";
import type { NavPanel } from "@/stores/appStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLogStore } from "@/stores/logStore";
import { getMemoryMetrics, formatMemoryMetrics, type MemoryMetrics } from "@/lib/memoryMonitor";

const NAV_ITEMS: { key: NavPanel; icon: typeof Bot }[] = [
  { key: "agents", icon: Bot },
  { key: "cron", icon: Clock },
  { key: "skills", icon: BookMarked },
  { key: "stats", icon: BarChart3 },
  { key: "settings", icon: Settings },
];

export function MainNav() {
  const activeNav = useAppStore((s) => s.activeNav);
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const theme = useAppStore((s) => s.theme);
  const [moreOpen, setMoreOpen] = useState(false);
  const logEntries = useLogStore((s) => s.entries);
  const clearLogs = useLogStore((s) => s.clear);
  const [memMetrics, setMemMetrics] = useState<MemoryMetrics | null>(
    () => import.meta.env.DEV ? getMemoryMetrics() : null
  );

  // 仅开发模式下启用内存指标轮询（5 秒刷新）
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const id = setInterval(() => setMemMetrics(getMemoryMetrics()), 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <aside className="flex w-[60px] shrink-0 flex-col bg-[#f0f0f0] dark:bg-[#1e1e1e]">
      <WindowControls />
      <div className="p-2 flex flex-col items-center gap-1">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent shadow-lg shadow-primary/20">
          <span className="text-lg font-bold text-primary-foreground">D</span>
        </div>
      </div>
      <nav className="flex-1 flex flex-col items-center py-2 gap-0.5">
        {NAV_ITEMS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveNav(key)}
            className={cn(
              "group relative flex h-12 w-12 items-center justify-center rounded-xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
              activeNav === key
                ? "bg-gradient-to-br from-primary/15 to-accent/10 text-primary shadow-sm shadow-primary/10"
                : "text-muted-foreground hover:bg-muted/70 dark:hover:bg-muted/40 hover:scale-105"
            )}
            title={
              key === "stats"
                ? "任务统计"
                : key === "agents"
                ? "Agents"
                : key === "cron"
                ? "定时任务"
                : key === "skills"
                ? "Skills"
                : "设置"
            }
          >
            {activeNav === key && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-gradient-to-b from-primary to-accent rounded-full" />
            )}
            <Icon size={22} className={cn(
              "transition-transform duration-200",
              activeNav === key ? "" : "group-hover:scale-110"
            )} />
          </button>
        ))}
      </nav>
      <div className="p-2 flex flex-col items-center gap-0.5">
        <ConnectionStatus />
        <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
          <DialogTrigger asChild>
            <button
              className="group flex h-12 w-12 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 dark:hover:bg-muted/40 transition-all duration-200 hover:scale-105"
              title="运行日志"
            >
              <Bug size={20} className="transition-transform duration-200 group-hover:scale-110" />
            </button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[70vh] flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                运行日志
                <Button variant="outline" size="sm" onClick={clearLogs}>
                  清空
                </Button>
              </DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground mb-2">
              macOS: Cmd+Option+I | Windows: Ctrl+Shift+I
            </p>
            {import.meta.env.DEV && memMetrics && (
              <div className="mb-2 px-2 py-1 rounded bg-primary/5 border border-primary/10 font-mono text-[10px] text-muted-foreground">
                {formatMemoryMetrics(memMetrics)}
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-auto font-mono text-xs bg-muted/50 dark:bg-muted/70 rounded-lg p-3">
              {logEntries.length === 0 ? (
                <span className="text-muted-foreground">暂无日志</span>
              ) : (
                logEntries.map((e, i) => (
                  <div
                    key={`${e.time}-${i}`}
                    className={e.type === "error" ? "text-destructive" : ""}
                  >
                    [{e.time}] {e.message}
                  </div>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>
        <button
          onClick={toggleTheme}
          className="group flex h-12 w-12 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 dark:hover:bg-muted/40 transition-all duration-200 hover:scale-105"
          title="切换主题"
        >
          {theme === "light" ? (
            <Moon size={20} className="transition-transform duration-200 group-hover:scale-110" />
          ) : (
            <Sun size={20} className="transition-transform duration-200 group-hover:scale-110" />
          )}
        </button>
      </div>
    </aside>
  );
}
