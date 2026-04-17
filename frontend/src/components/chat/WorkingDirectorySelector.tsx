import { useState, useCallback, useEffect } from "react";
import { FolderOpen, ChevronDown, Check, FolderPlus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/stores/appStore";
import { ensureAgent, stopAgent } from "@/api/tauri-api";
import { toast } from "sonner";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";

interface WorkingDirectorySelectorProps {
  agentId: string;
}

function shortenPath(fullPath: string): string {
  if (!fullPath) return "未设置";
  let path = fullPath;
  const homeMatch = path.match(/^\/Users\/[^/]+/);
  if (homeMatch) {
    path = "~" + path.slice(homeMatch[0].length);
  }
  const sep = "/";
  const parts = path.split(sep).filter(Boolean);
  if (parts.length <= 2) {
    return path;
  }
  const last2 = parts.slice(-2).join(sep);
  const prefix = path.startsWith("~") ? "~" : "";
  return `${prefix}/.../${last2}`;
}

export function WorkingDirectorySelector({ agentId }: WorkingDirectorySelectorProps) {
  const workingDirectories = useAppStore((s) => s.workingDirectories);
  const agentWorkingDirectory = useAppStore((s) => s.agentWorkingDirectory);
  const setAgentWorkingDirectory = useAppStore((s) => s.setAgentWorkingDirectory);
  const addWorkingDirectory = useAppStore((s) => s.addWorkingDirectory);
  const setIntentionalAgentStop = useAppStore((s) => s.setIntentionalAgentStop);
  const setAgentStartLoading = useAppStore((s) => s.setAgentStartLoading);

  const [restarting, setRestarting] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // 当前 Agent 的工作目录（简单从 store 读取）
  const currentDir = agentWorkingDirectory[agentId] || "";

  // 初始化：组件挂载时，如果没有设置过工作目录，使用第一个全局目录
  useEffect(() => {
    if (initialized) return;
    if (!agentWorkingDirectory[agentId] && workingDirectories[0]) {
      setAgentWorkingDirectory(agentId, workingDirectories[0]);
    }
    setInitialized(true);
  }, [agentId, workingDirectories, agentWorkingDirectory, setAgentWorkingDirectory, initialized]);

  const handleSelectDir = useCallback(
    async (dir: string) => {
      if (dir === currentDir || restarting) return;

      setRestarting(true);
      setIntentionalAgentStop(true);
      setAgentStartLoading(agentId, true);
      try {
        // 先添加新目录到全局列表（如果不在）
        if (!workingDirectories.includes(dir)) {
          addWorkingDirectory(dir);
        }

        // 停止旧 agent
        try {
          await stopAgent(agentId);
        } catch {
          // 忽略 stop 失败
        }

        await new Promise(r => setTimeout(r, 1000));

        // 启动新 agent（使用新目录）
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await ensureAgent(agentId, dir);
            lastError = null;
            break;
          } catch (e) {
            lastError = e;
            if (attempt < 2) {
              await new Promise(r => setTimeout(r, 2000));
            }
          }
        }
        if (lastError) throw lastError;

        // Agent 成功启动后才更新工作目录（触发 UI 更新）
        setAgentWorkingDirectory(agentId, dir);
        toast.success(`工作目录已切换至 ${shortenPath(dir)}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(`切换工作目录失败：${msg}`);
        // 回滚到之前的目录，并尝试重启旧 agent
        if (currentDir) {
          try {
            await ensureAgent(agentId, currentDir);
          } catch (restartErr) {
            console.warn("回滚重启旧 agent 失败:", restartErr);
          }
          setAgentWorkingDirectory(agentId, currentDir);
        }
      } finally {
        setIntentionalAgentStop(false);
        setRestarting(false);
        setAgentStartLoading(agentId, false);
      }
    },
    [agentId, currentDir, restarting, workingDirectories, setAgentWorkingDirectory, addWorkingDirectory, setIntentionalAgentStop, setAgentStartLoading]
  );

  const handleBrowse = useCallback(async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "选择工作目录",
      });
      if (selected && typeof selected === "string") {
        await handleSelectDir(selected);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`打开目录选择器失败：${msg}`);
    }
  }, [handleSelectDir]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={restarting}
          title={currentDir || "未设置工作目录"}
          className={cn(
            "flex items-center gap-1.5 max-w-[220px] px-2 py-1.5 rounded-lg text-xs",
            "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            "transition-all duration-200 hover:scale-105",
            "disabled:opacity-40 disabled:pointer-events-none"
          )}
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate min-w-0 font-mono leading-none">
            {restarting ? "重启中..." : shortenPath(currentDir)}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="bottom" className="w-72">
        {workingDirectories.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground text-center">
            暂无工作目录，点击下方浏览选择
          </div>
        ) : (
          workingDirectories.map((dir) => (
            <DropdownMenuItem
              key={dir}
              className="flex items-center gap-2 cursor-pointer"
              onSelect={() => void handleSelectDir(dir)}
            >
              <Check
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  dir === currentDir ? "opacity-100 text-primary" : "opacity-0"
                )}
              />
              <span
                className="truncate flex-1 font-mono text-xs"
                title={dir}
              >
                {shortenPath(dir)}
              </span>
            </DropdownMenuItem>
          ))
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="flex items-center gap-2 cursor-pointer text-muted-foreground"
          onSelect={() => void handleBrowse()}
        >
          <FolderPlus className="h-3.5 w-3.5 shrink-0" />
          <span className="text-xs">浏览选择...</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
