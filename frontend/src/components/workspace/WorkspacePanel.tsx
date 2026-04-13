import { useState, useEffect, useCallback } from "react";
import { FolderOpen, FolderPlus, Check, Trash2, FileText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { invoke } from "@tauri-apps/api/core";
import { checkIsTauri } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { executeStream } from "@/api/tauri-api";

/**
 * 工作目录管理面板
 * 支持多个工作目录,允许用户添加/删除目录,并自动生成 AGENTS.md
 */
export function WorkspacePanel() {
  const workingDirectories = useAppStore((s) => s.workingDirectories);
  const setWorkingDirectories = useAppStore((s) => s.setWorkingDirectories);
  const addWorkingDirectory = useAppStore((s) => s.addWorkingDirectory);
  const removeWorkingDirectory = useAppStore((s) => s.removeWorkingDirectory);
  const [selectingDir, setSelectingDir] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [recentDirs, setRecentDirs] = useState<string[]>([]);

  // 加载已配置的工作目录
  useEffect(() => {
    if (!checkIsTauri()) return;
    const loadWorkingDirs = async () => {
      try {
        const dirs = await invoke<string[] | null>("get_config", {
          key: "working_directories",
        });
        if (dirs) {
          setWorkingDirectories(dirs);
        }
      } catch {
        // 静默处理
      }
    };
    void loadWorkingDirs();
  }, [setWorkingDirectories]);

  // 加载最近使用的目录列表
  useEffect(() => {
    if (!checkIsTauri()) return;
    const loadRecentDirs = async () => {
      try {
        const dirs = await invoke<string[] | null>("get_config", {
          key: "recent_directories",
        });
        if (dirs) {
          setRecentDirs(dirs);
        }
      } catch {
        // 静默处理
      }
    };
    void loadRecentDirs();
  }, []);

  // 选择并添加工作目录
  const handleSelectDirectory = async () => {
    if (!checkIsTauri()) return;
    setSelectingDir(true);
    try {
      const dir = await invoke<string | null>("select_directory");
      if (dir) {
        await addDirectory(dir);
      }
    } catch (e) {
      console.error("选择目录失败", e);
      toast.error("选择目录失败");
    } finally {
      setSelectingDir(false);
    }
  };

  // 添加工作目录
  const addDirectory = async (dir: string) => {
    if (workingDirectories.includes(dir)) {
      toast.info("该目录已在工作目录列表中");
      return;
    }

    try {
      // 添加到工作目录列表
      addWorkingDirectory(dir);
      const updatedDirs = [...workingDirectories, dir];
      await invoke("set_config", {
        key: "working_directories",
        value: updatedDirs,
      });

      toast.success(`已添加工作目录: ${formatPath(dir)}`);

      // 自动生成 AGENTS.md
      await generateAgentsMd(dir);

      // 更新最近使用的目录列表
      const updatedRecent = [
        dir,
        ...recentDirs.filter((d) => d !== dir),
      ].slice(0, 5);
      setRecentDirs(updatedRecent);
      await invoke("set_config", {
        key: "recent_directories",
        value: updatedRecent,
      });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error("添加工作目录失败:", errorMsg);
      toast.error(`添加工作目录失败: ${errorMsg}`);
    }
  };

  // 删除工作目录
  const handleRemoveDirectory = async (dir: string) => {
    try {
      removeWorkingDirectory(dir);
      const updatedDirs = workingDirectories.filter((d) => d !== dir);
      await invoke("set_config", {
        key: "working_directories",
        value: updatedDirs,
      });
      toast.success(`已移除工作目录: ${formatPath(dir)}`);
    } catch (e) {
      console.error("移除工作目录失败", e);
      toast.error("移除工作目录失败");
    }
  };

  // 生成 AGENTS.md 文件 (通过工具系统)
  const generateAgentsMd = async (targetDir: string) => {
    setGenerating(true);
    try {
      // AGENTS.md 模板内容
      const template = `# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## Project Overview

<!-- TODO: Add project description -->

## Architecture

<!-- TODO: Add architecture details -->

## Key Directories

<!-- TODO: Document key directories -->

## Development Workflow

<!-- TODO: Add development workflow -->

## Important Patterns

<!-- TODO: Document important patterns -->
`;

      // 通过 AI Agent 的文件工具生成 AGENTS.md
      // 这样会经过完整的工具系统,包含权限检查和操作日志
      await executeStream(
        `请在以下路径创建文件并写入内容（不要执行其他操作）：\n\n` +
        `文件路径: ${targetDir}/AGENTS.md\n\n` +
        `文件内容:\n${template}`,
        { backendSessionId: "workspace-agents-md-gen" },
        {
          onChunk: () => {
            // 静默处理,不需要显示中间过程
          },
          onDone: (error) => {
            if (error) {
              console.error("生成 AGENTS.md 失败", error);
              toast.error("生成 AGENTS.md 失败");
            } else {
              toast.success("已生成 AGENTS.md 文件");
            }
          },
        }
      );
    } catch (e) {
      console.error("生成 AGENTS.md 异常", e);
      toast.error("生成 AGENTS.md 失败");
    } finally {
      setGenerating(false);
    }
  };

  // 重新生成 AGENTS.md
  const handleRegenerateAgentsMd = useCallback(async (dir: string) => {
    await generateAgentsMd(dir);
  }, []);

  // 格式化路径显示
  const formatPath = (path: string) => {
    if (!path) return "";
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 头部 */}
      <div className="shrink-0 border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <FolderOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">工作目录</h2>
            <p className="text-sm text-muted-foreground">
              管理项目工作目录配置
            </p>
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* 工作目录列表 */}
          <div className="rounded-lg border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-muted-foreground">
                工作目录 ({workingDirectories.length})
              </h3>
              <Button
                size="sm"
                onClick={handleSelectDirectory}
                disabled={selectingDir}
              >
                <FolderPlus className="h-4 w-4 mr-2" />
                {selectingDir ? "选择中..." : "添加目录"}
              </Button>
            </div>

            {workingDirectories.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FolderOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">暂无工作目录</p>
                <p className="text-xs mt-1">点击上方按钮添加工作目录</p>
              </div>
            ) : (
              <div className="space-y-2">
                {workingDirectories.map((dir) => (
                  <div
                    key={dir}
                    className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                  >
                    <FolderOpen className="h-5 w-5 shrink-0 text-primary" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {formatPath(dir)}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {dir}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleRegenerateAgentsMd(dir)}
                        disabled={generating}
                        title="生成/更新 AGENTS.md"
                      >
                        {generating ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => handleRemoveDirectory(dir)}
                        title="移除目录"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 最近使用的目录 */}
          {recentDirs.length > 0 && (
            <div className="rounded-lg border bg-card p-5 shadow-sm">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">
                最近使用
              </h3>
              <div className="space-y-2">
                {recentDirs.map((dir) => {
                  const isAdded = workingDirectories.includes(dir);
                  return (
                    <button
                      key={dir}
                      onClick={() => !isAdded && addDirectory(dir)}
                      disabled={selectingDir || isAdded}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed",
                        isAdded && "bg-muted/50"
                      )}
                    >
                      <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {formatPath(dir)}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {dir}
                        </p>
                      </div>
                      {isAdded && (
                        <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 说明信息 */}
          <div className="rounded-lg border bg-muted/50 p-4">
            <h4 className="text-sm font-medium text-foreground mb-2">
              什么是工作目录?
            </h4>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li>• 文件操作 (Read/Write/Edit) 的默认相对路径基准</li>
              <li>• Agent 和 Skill 配置文件的搜索根目录</li>
              <li>• 会话历史和 Checkpoint 的关联目录</li>
              <li>• 每个目录会自动生成 AGENTS.md 文件</li>
              <li>• 使用 /init 命令可重新生成 AGENTS.md</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
