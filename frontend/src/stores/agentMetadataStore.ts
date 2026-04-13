import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AgentMetadata {
  displayName?: string;
  avatarLetter?: string;
  /** 本地图片路径（Base64 Data URI） */
  avatarImage?: string;
}

const STORAGE_KEY = "d-ui-agent-metadata";

interface AgentMetadataState {
  byId: Record<string, AgentMetadata>;
  get: (agentId: string) => AgentMetadata | undefined;
  set: (agentId: string, meta: Partial<AgentMetadata>) => void;
}

export const useAgentMetadataStore = create<AgentMetadataState>()(
  persist(
    (set, get) => ({
      byId: {},
      get: (agentId) => get().byId[agentId],
      set: (agentId, meta) =>
        set((s) => ({
          byId: {
            ...s.byId,
            [agentId]: { ...s.byId[agentId], ...meta },
          },
        })),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      /**
       * 自定义 merge：逐条校验 byId 中每个条目的结构，
       * 丢弃格式不合法的旧数据，防止类型污染。
       */
      merge: (persisted, current) => {
        let byId: Record<string, AgentMetadata> = {};
        try {
          const raw =
            persisted &&
            typeof persisted === "object" &&
            "byId" in persisted
              ? (persisted as { byId: unknown }).byId
              : null;
          if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            for (const [k, v] of Object.entries(raw)) {
              if (v && typeof v === "object" && !Array.isArray(v)) {
                byId[k] = v as AgentMetadata;
              }
            }
          }
        } catch {
          // 数据损坏时降级为空对象
          byId = {};
        }
        return { ...current, byId };
      },
      /**
       * 反序列化失败时的降级策略：重置为空的 byId，不崩溃。
       */
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          if (import.meta.env.DEV) {
            console.warn(
              "[agentMetadataStore] rehydrate failed, resetting to defaults:",
              error
            );
          }
        }
      },
    }
  )
);
