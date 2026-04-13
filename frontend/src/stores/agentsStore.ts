import { create } from "zustand";
import { getAgents, getRunningAgents, type AgentInfo } from "@/api/tauri-api";

export interface AgentItem {
  id: string;
  name: string;
  ext: string;
  description?: string;
}

function toAgentItem(info: AgentInfo): AgentItem {
  return {
    id: info.name,
    name: info.name,
    ext: "json",
    description: info.description,
  };
}

type AgentsState = {
  agents: AgentItem[];
  loading: boolean;
  error: string | null;
  /** 自动重试计数器（内部使用） */
  _loadRetries: number;
  /** 拉取 / 刷新 Agent 列表（多组件共享同一份数据） */
  load: () => Promise<void>;
  /** 当前正在运行的 Agent ID 列表 */
  runningAgentIds: string[];
  /** 刷新运行中的 Agent ID 列表 */
  refreshRunningAgents: () => Promise<void>;
  /** 判断指定 Agent 是否正在运行 */
  isAgentRunning: (agentId: string) => boolean;
};

/** 用于防竞态：记录最新一次 load 调用的标识 */
let loadSeq = 0;
/** 存储待执行的重试 timeout ID，新 load() 调用时取消旧重试，避免竞态 */
let pendingRetryTimeout: ReturnType<typeof setTimeout> | null = null;

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: [],
  loading: false,
  error: null,
  _loadRetries: 0,
  runningAgentIds: [],
  load: async () => {
    // 取消任何待执行的重试，防止旧重试干扰新请求
    if (pendingRetryTimeout) {
      clearTimeout(pendingRetryTimeout);
      pendingRetryTimeout = null;
    }
    const seq = ++loadSeq;
    set({ loading: true, error: null, _loadRetries: 0 });
    console.info(`[agentsStore] 开始加载 agents (seq=${seq})`);
    try {
      const data = await getAgents();
      // 如果序号已过期（后续请求已发出），丢弃本次结果
      if (seq !== loadSeq) {
        console.info(`[agentsStore] 序号过期 (seq=${seq}, loadSeq=${loadSeq})，丢弃本次结果`);
        return;
      }
      const items = data
        .map(toAgentItem)
        .sort((a, b) => a.name.localeCompare(b.name));
      console.info(`[agentsStore] 加载成功，共 ${items.length} 个 agents (seq=${seq})`);
      set({ agents: items, loading: false, _loadRetries: 0 });
    } catch (e) {
      if (seq !== loadSeq) return;
      const currentAgents = get().agents;
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.warn(`[agentsStore] load 失败 (seq=${seq}), 保留现有 ${currentAgents.length} 个 agents:`, e);
      set({
        error: errorMsg || "加载失败",
        // 不清空 agents，保持旧列表，避免刷新时因临时错误丢失列表
        loading: false,
      });
      // 自动延迟重试（最多 3 次）
      const currentRetries = get()._loadRetries;
      if (currentRetries < 3) {
        set({ _loadRetries: currentRetries + 1 });
        const delay = 2000 * (currentRetries + 1);
        console.info(`[agentsStore] 计划第 ${currentRetries + 1}/3 次重试，${delay}ms 后`);
        pendingRetryTimeout = setTimeout(() => {
          pendingRetryTimeout = null;
          get().load();
        }, delay);
      } else if (errorMsg.includes("SIDECAR_NOT_RUNNING") || errorMsg.includes("超时")) {
        // 超过常规重试次数后，如果仍是 Sidecar 未就绪错误，5 秒后再做一次底底重试
        console.info(`[agentsStore] 常规重试已超限，5s 后底底重试`);
        pendingRetryTimeout = setTimeout(() => {
          pendingRetryTimeout = null;
          if (get().agents.length === 0) {
            console.info("[agentsStore] Sidecar 可能已就绪，自动重试加载 agents");
            set({ _loadRetries: 0 });
            get().load();
          }
        }, 5000);
      }
    }
  },
  refreshRunningAgents: async () => {
    try {
      const ids = await getRunningAgents();
      set({ runningAgentIds: ids });
    } catch (error) {
      console.error("[agentsStore] refreshRunningAgents failed:", error);
    }
  },
  isAgentRunning: (agentId: string) => {
    return get().runningAgentIds.includes(agentId);
  },
}));
