import { useEffect } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppLayout } from "@/components/layout/AppLayout";
import { AppWindow } from "@/components/layout/window";
import { CommandPalette } from "@/components/command/CommandPalette";
import { KeyboardShortcuts } from "@/components/command/KeyboardShortcuts";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { checkIsTauri } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { ping } from "@/api/tauri-api";
import { useAgentsStore } from "@/stores/agentsStore";
import { useSidecar } from "@/hooks/useSidecar";
import { useAppStore } from "@/stores/appStore";
import { cleanupOldSessions } from "@/lib/conversationStorage";
import { useTauriEnvironmentCheck } from "@/hooks/useTauriEnvironmentCheck";

function App() {
  // 全局Tauri环境检测（仅检测宿主环境；Sidecar健康由 useSidecar 统一管理）
  const { isTauriReady } = useTauriEnvironmentCheck();

  // 输出环境检测状态用于调试
  useEffect(() => {
    console.log('[App] Tauri environment status:', { isTauriReady });
  }, [isTauriReady]);

  // Sidecar 连接初始化：Tauri 环境下自动启动并重联
  const { start, checkConnection } = useSidecar();
  const setSidecarConnected = useAppStore((s) => s.setSidecarConnected);
  const setSidecarError = useAppStore((s) => s.setSidecarError);

  // 在环境检测完成后才进行Sidecar初始化
  useEffect(() => {
    if (!isTauriReady) return; // 等待Tauri环境检测完成
    if (!checkIsTauri()) return;

    let cancelled = false;

    const init = async () => {
      // 先检查是否已经运行
      console.info('[App] 开始 Sidecar 初始化流程');
      const alreadyRunning = await checkConnection();
      console.info(`[App] checkConnection 结果: alreadyRunning=${alreadyRunning}`);
      if (cancelled) return;

      if (alreadyRunning) {
        console.info('[App] Sidecar 已在运行，直接设置 connected=true');
        setSidecarConnected(true);
        setSidecarError(null);
        // 启动成功后加载 agents
        if (!cancelled) {
          console.info('[App] 调用 agentsStore.load() [alreadyRunning path]');
          void useAgentsStore.getState().load();
        }
        return;
      }

      // 尝试启动 Sidecar,优先使用设置中配置的工作目录
      try {
        // 1. 确保默认工作目录 ~/Claude-Workspace 存在
        const defaultWorkspace = await invoke<string>("ensure_default_workspace");
        console.info(`[App] Default workspace ensured: ${defaultWorkspace}`);

        // 2. 读取工作目录配置 (支持多目录)
        const workingDirs = await invoke<string[] | null>("get_config", {
          key: "working_directories",
        });

        // 3. 若配置为空，自动写入默认目录
        let resolvedDefaultCwd = "";
        if (!workingDirs || workingDirs.length === 0) {
          // 尝试兼容旧配置
          const oldWorkingDir = await invoke<string | null>("get_config", {
            key: "working_directory",
          });
          if (oldWorkingDir) {
            resolvedDefaultCwd = oldWorkingDir;
          } else {
            // 无任何配置，使用默认工作目录
            resolvedDefaultCwd = defaultWorkspace;
            await invoke("set_config", {
              key: "working_directories",
              value: [defaultWorkspace],
            });
            console.info(`[App] No working directories configured, set default: ${defaultWorkspace}`);
          }
          // Only set if currently empty (persist might have restored a value)
          if (useAppStore.getState().workingDirectories.length === 0) {
            useAppStore.getState().setWorkingDirectories([resolvedDefaultCwd]);
          }
        } else {
          // 使用第一个工作目录作为默认激活目录
          resolvedDefaultCwd = workingDirs[0];
          if (workingDirs.length > 1) {
            console.info(
              `[App] Multiple directories provided (${workingDirs.length}). Default: ${workingDirs[0]}`,
              workingDirs.slice(1).map((d, i) => `  [${i + 2}] ${d}`).join('\n')
            );
          }
          // Only set if currently empty (persist might have restored a value)
          if (useAppStore.getState().workingDirectories.length === 0) {
            useAppStore.getState().setWorkingDirectories(workingDirs);
          }
        }

        // 4. 优先使用 per-agent 已保存的工作目录（来自 agentWorkingDirectory["main"]），
        //    否则回退到刚解析的默认目录
        const mainAgentCwd =
          useAppStore.getState().agentWorkingDirectory["main"] || resolvedDefaultCwd;
        console.info(`[App] Starting main agent with cwd: ${mainAgentCwd}`);

        await start(mainAgentCwd);
        if (!cancelled) {
          // 等待 Sidecar RPC 层就绪（ping 确认）
          let ready = false;
          for (let i = 0; i < 10; i++) {
            try {
              await ping();
              console.info(`[App] ping 成功 (第 ${i + 1} 次尝试)`);
              ready = true;
              break;
            } catch {
              console.info(`[App] ping 失败 (第 ${i + 1}/10 次)，500ms 后重试`);
              await new Promise(r => setTimeout(r, 500));
            }
          }
          if (!ready) {
            console.warn('[App] Sidecar ping 未在 5 秒内响应，将在后台继续重试');
            // 不设置 connected，启动后台重试
            const retryLoad = async () => {
              for (let retry = 0; retry < 15; retry++) {
                await new Promise(r => setTimeout(r, 1000));
                if (cancelled) return;
                try {
                  await ping();
                  console.info(`[App] 后台 ping 成功 (重试 ${retry + 1})，设置 connected=true`);
                  setSidecarConnected(true);
                  setSidecarError(null);
                  console.info('[App] 调用 agentsStore.load() [background retry path]');
                  void useAgentsStore.getState().load();
                  return;
                } catch {
                  console.info(`[App] 后台 ping 失败 (重试 ${retry + 1}/15)`);
                }
              }
              // 15 秒后仍然失败
              if (!cancelled) {
                setSidecarError('Sidecar 连接失败，请尝试重启应用');
              }
            };
            void retryLoad();
          } else {
            setSidecarConnected(true);
            setSidecarError(null);
            // 启动成功后加载 agents
            console.info('[App] 调用 agentsStore.load() [normal path]');
            void useAgentsStore.getState().load();
          }
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setSidecarConnected(false);
          setSidecarError(msg);
        }
      }
    };

    void init();

    return () => {
      cancelled = true;
    };
    // isTauriReady 从 false → true 时需要重新执行以启动 Sidecar
    // start/checkConnection 为 useCallback 包裹的稳定引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTauriReady]);

  // macOS：仅内容区 CALayer 圆角，不启用系统交通灯（与侧栏 `WindowControls` 并存）；阴影仍由 tauri.conf + set_shadow
  useEffect(() => {
    if (!checkIsTauri()) return;
    void (async () => {
      try {
        const { getCurrentWebviewWindow } = await import(
          "@tauri-apps/api/webviewWindow"
        );
        await invoke("apply_content_corner_radius", {
          window: getCurrentWebviewWindow(),
          cornerRadius: 12,
        });
      } catch {
        /* 非 macOS 空实现或权限等 */
      }
    })();
  }, []);

  // Task #5: 应用启动时清理过旧的本地会话缓存
  useEffect(() => {
    cleanupOldSessions(10);
  }, []);

  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={300}>
        <AppWindow>
          <AppLayout />
          <CommandPalette />
          <KeyboardShortcuts />
          <Toaster />
        </AppWindow>
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
