import { useShallow } from "zustand/react/shallow";
import { useAgentsStore, type AgentItem } from "@/stores/agentsStore";

export type { AgentItem };

/**
 * 全应用共享的 Agent 列表（单次 store 订阅，避免多路 selector + effect 在热更新时触发 hooks 数量异常）。
 * 首次拉取在 `App` 中调用 `useAgentsStore.getState().load()`。
 */
export function useAgents() {
  return useAgentsStore(
    useShallow((s) => ({
      agents: s.agents,
      loading: s.loading,
      error: s.error,
      reload: s.load,
    }))
  );
}
