import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { NavPanel } from "@/types/app";

// 重导出类型以保持对外 API 兼容
export type { NavPanel };

const CONTENT_LIST_WIDTH_MIN = 180;
const CONTENT_LIST_WIDTH_MAX = 500;
const CONTENT_LIST_WIDTH_DEFAULT = 260;

/** localStorage：各主导航下列表列宽度，关闭应用后恢复 */
const CONTENT_LIST_WIDTHS_STORAGE_KEY = "d-ui-content-list-widths-by-nav";

function defaultContentListWidths(): Record<NavPanel, number> {
  return {
    stats: CONTENT_LIST_WIDTH_DEFAULT,
    agents: CONTENT_LIST_WIDTH_DEFAULT,
    cron: CONTENT_LIST_WIDTH_DEFAULT,
    skills: CONTENT_LIST_WIDTH_DEFAULT,
    settings: CONTENT_LIST_WIDTH_DEFAULT,
  };
}

function clampWidth(w: number): number {
  return Math.max(
    CONTENT_LIST_WIDTH_MIN,
    Math.min(CONTENT_LIST_WIDTH_MAX, w)
  );
}

/** 合并本地缓存与默认值，并校正范围 */
function normalizeContentListWidths(raw: unknown): Record<NavPanel, number> {
  const base = defaultContentListWidths();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Partial<Record<NavPanel, unknown>>;
  const keys: NavPanel[] = [
    "stats",
    "agents",
    "cron",
    "skills",
    "settings",
  ];
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      base[k] = clampWidth(v);
    }
  }
  return base;
}

export interface AppState {
  theme: "light" | "dark" | "system";
  /** 各主导航下第二列（列表）宽度独立记忆，拖拽分隔条只改当前页 */
  contentListWidthByNav: Record<NavPanel, number>;
  activeNav: NavPanel;
  selectedAgentId: string | null;
  agentDetailViewId: string | null;
  selectedCronId: string | null;
  selectedSkillId: string | null;
  selectedSettingsCategory: string | null;
  historyCronId: string | null;
  agentInfoDialogOpenId: string | null;
  chatHeaderAction: React.ReactNode | null;
  activeBackendSessionId: string | null;
  historySheetOpen: boolean;
  checkpointSheetOpen: boolean;
  /** 回滚等操作后递增，驱动 ChatArea 重新拉取会话消息 */
  chatHistoryReloadNonce: number;
  /** ChatArea 流式/执行任务中，用于禁用 checkpoint 等互斥操作 */
  chatExecuteLoading: boolean;
  /** Sidecar 进程当前是否已连接 */
  sidecarConnected: boolean;
  /** Sidecar 最近一次连接错误，无错误时为 null */
  sidecarError: string | null;
  /** 是否已配置 API Key（不存储实际值） */
  apiKeyConfigured: boolean;
  /** 当前选择的模型 */
  selectedModel: string;
  /** 工作目录路径 (支持多个) */
  workingDirectories: string[];
  /** RuntimePanel 宽度，范围 [250, 600] */
  runtimePanelWidth: number;
  /** RuntimePanel 是否折叠 */
  runtimePanelCollapsed: boolean;
  setSidecarConnected: (connected: boolean) => void;
  setSidecarError: (error: string | null) => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
  setApiKeyConfigured: (configured: boolean) => void;
  setSelectedModel: (model: string) => void;
  setWorkingDirectories: (dirs: string[]) => void;
  addWorkingDirectory: (dir: string) => void;
  removeWorkingDirectory: (dir: string) => void;
  setChatHeaderAction: (action: React.ReactNode) => void;
  setContentListWidth: (width: number) => void;
  setActiveNav: (nav: NavPanel) => void;
  setSelectedAgent: (id: string | null) => void;
  setAgentDetailViewId: (id: string | null) => void;
  setSelectedCron: (id: string | null) => void;
  setSelectedSkill: (id: string | null) => void;
  setSelectedSettingsCategory: (id: string | null) => void;
  setHistoryCronId: (id: string | null) => void;
  setAgentInfoDialogOpenId: (id: string | null) => void;
  setActiveBackendSessionId: (id: string | null) => void;
  setHistorySheetOpen: (open: boolean) => void;
  setCheckpointSheetOpen: (open: boolean) => void;
  bumpChatHistoryReload: () => void;
  setChatExecuteLoading: (loading: boolean) => void;
  toggleTheme: () => void;
  setRuntimePanelWidth: (width: number) => void;
  toggleRuntimePanel: () => void;
  showRuntimePanel: () => void;
  /** Agent 启动中的加载状态，key 为 agentId */
  agentStartLoading: Record<string, boolean>;
  setAgentStartLoading: (agentId: string, loading: boolean) => void;
  /** 每个 Agent 独立的工作目录，key 为 agentId */
  agentWorkingDirectory: Record<string, string>;
  setAgentWorkingDirectory: (agentId: string, dir: string) => void;
  getAgentWorkingDirectory: (agentId: string) => string;
  /** 标志：前端主动触发的 agent stop（如切换工作目录），用于抑制自动重连 */
  intentionalAgentStop: boolean;
  setIntentionalAgentStop: (v: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      theme: "light",
      contentListWidthByNav: defaultContentListWidths(),
      activeNav: "agents",
      selectedAgentId: "main",
      agentDetailViewId: null,
      selectedCronId: null,
      selectedSkillId: null,
      selectedSettingsCategory: null,
      historyCronId: null,
      agentInfoDialogOpenId: null,
      chatHeaderAction: null,
      activeBackendSessionId: null,
      historySheetOpen: false,
      checkpointSheetOpen: false,
      chatHistoryReloadNonce: 0,
      chatExecuteLoading: false,
      sidecarConnected: false,
      sidecarError: null,
      apiKeyConfigured: false,
      selectedModel: "claude-sonnet-4-20250514",
      workingDirectories: [],
      runtimePanelWidth: 350,
      runtimePanelCollapsed: false,
      agentStartLoading: {},
      agentWorkingDirectory: {},
      intentionalAgentStop: false,
      setSidecarConnected: (sidecarConnected) =>
        set(sidecarConnected ? { sidecarConnected, sidecarError: null } : { sidecarConnected }),
      setSidecarError: (sidecarError) => set({ sidecarError }),
      setApiKeyConfigured: (apiKeyConfigured) => set({ apiKeyConfigured }),
      setSelectedModel: (selectedModel) => set({ selectedModel }),
      setWorkingDirectories: (workingDirectories) => set({ workingDirectories }),
      addWorkingDirectory: (dir) => set((state) => ({
        workingDirectories: state.workingDirectories.includes(dir)
          ? state.workingDirectories
          : [...state.workingDirectories, dir],
      })),
      removeWorkingDirectory: (dir) => set((state) => ({
        workingDirectories: state.workingDirectories.filter((d) => d !== dir),
      })),
      setTheme: (theme) => {
        set({ theme });
        const isDark =
          theme === "dark" ||
          (theme === "system" &&
            typeof window !== "undefined" &&
            window.matchMedia("(prefers-color-scheme: dark)").matches);
        document.documentElement.classList.toggle("dark", isDark);
      },
      setContentListWidth: (width) =>
        set((s) => {
          const w = clampWidth(width);
          return {
            contentListWidthByNav: {
              ...s.contentListWidthByNav,
              [s.activeNav]: w,
            },
          };
        }),
      setActiveNav: (activeNav) => set({ activeNav }),
      setSelectedAgent: (selectedAgentId) => set({ selectedAgentId }),
      setAgentDetailViewId: (agentDetailViewId) => set({ agentDetailViewId }),
      setSelectedCron: (selectedCronId) => set({ selectedCronId }),
      setSelectedSkill: (selectedSkillId) => set({ selectedSkillId }),
      setSelectedSettingsCategory: (selectedSettingsCategory) =>
        set({ selectedSettingsCategory }),
      setHistoryCronId: (historyCronId) => set({ historyCronId }),
      setAgentInfoDialogOpenId: (agentInfoDialogOpenId) =>
        set({ agentInfoDialogOpenId }),
      setChatHeaderAction: (chatHeaderAction) => set({ chatHeaderAction }),
      setActiveBackendSessionId: (id) => set({ activeBackendSessionId: id }),
      setHistorySheetOpen: (open) => set({ historySheetOpen: open }),
      setCheckpointSheetOpen: (open) => set({ checkpointSheetOpen: open }),
      bumpChatHistoryReload: () =>
        set((s) => ({ chatHistoryReloadNonce: s.chatHistoryReloadNonce + 1 })),
      setChatExecuteLoading: (chatExecuteLoading) =>
        set({ chatExecuteLoading }),
      toggleTheme: () =>
        set((s) => {
          const next = s.theme === "light" ? "dark" : "light";
          document.documentElement.classList.toggle("dark", next === "dark");
          return { theme: next };
        }),
      setRuntimePanelWidth: (width) =>
        set({ runtimePanelWidth: Math.max(250, Math.min(600, width)) }),
      toggleRuntimePanel: () =>
        set((s) => ({ runtimePanelCollapsed: !s.runtimePanelCollapsed })),
      showRuntimePanel: () => set({ runtimePanelCollapsed: false }),
      setAgentStartLoading: (agentId: string, loading: boolean) =>
        set((state) => ({
          agentStartLoading: {
            ...state.agentStartLoading,
            [agentId]: loading,
          },
        })),
      setAgentWorkingDirectory: (agentId: string, dir: string) =>
        set((state) => ({
          agentWorkingDirectory: {
            ...state.agentWorkingDirectory,
            [agentId]: dir,
          },
        })),
      getAgentWorkingDirectory: (agentId: string) => {
        const state = get();
        return state.agentWorkingDirectory[agentId] ?? state.workingDirectories[0] ?? "";
      },
      setIntentionalAgentStop: (v: boolean) => set({ intentionalAgentStop: v }),
    }),
    {
      name: CONTENT_LIST_WIDTHS_STORAGE_KEY,
      version: 2,
      partialize: (s) => ({
        theme: s.theme,
        contentListWidthByNav: s.contentListWidthByNav,
        runtimePanelWidth: s.runtimePanelWidth,
        runtimePanelCollapsed: s.runtimePanelCollapsed,
        agentWorkingDirectory: s.agentWorkingDirectory,
      }),
      merge: (persisted, current) => {
        const patch =
          persisted && typeof persisted === "object"
            ? (persisted as {
                theme?: "light" | "dark" | "system";
                contentListWidthByNav?: unknown;
                runtimePanelWidth?: unknown;
                runtimePanelCollapsed?: unknown;
                agentWorkingDirectory?: unknown;
              })
            : null;
        const merged: AppState = {
          ...current,
          ...(patch ?? {}) as Partial<AppState>,
          contentListWidthByNav: normalizeContentListWidths(
            patch?.contentListWidthByNav ?? current.contentListWidthByNav
          ),
        };
        if (typeof patch?.runtimePanelWidth === "number") {
          merged.runtimePanelWidth = Math.max(
            250,
            Math.min(600, patch.runtimePanelWidth)
          );
        }
        if (typeof patch?.runtimePanelCollapsed === "boolean") {
          merged.runtimePanelCollapsed = patch.runtimePanelCollapsed;
        }
        if (patch?.agentWorkingDirectory && typeof patch.agentWorkingDirectory === "object") {
          merged.agentWorkingDirectory = patch.agentWorkingDirectory as Record<string, string>;
        }
        return merged;
      },
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          // 反序列化失败：降级为默认字宽，不崩溃
          if (import.meta.env.DEV) {
            console.warn("[appStore] rehydrate failed, using defaults:", error);
          }
          state?.setContentListWidth(CONTENT_LIST_WIDTH_DEFAULT);
        } else if (state) {
          // 应用已保存的主题（包括"跟随系统"）
          state.setTheme(state.theme);
        }
      },
    }
  )
);
