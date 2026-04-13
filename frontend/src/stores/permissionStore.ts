import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PermissionRequest, PermissionDecision } from '@/types/permissions';

// 重导出类型以保持对外 API 兼容
export type { PermissionRequest, PermissionDecision };

const STORAGE_KEY = 'd-ui-permission-decisions';

interface PermissionState {
  /** 当前待处理的权限请求 */
  pendingRequest: PermissionRequest | null;
  /** 记住的决策映射 (tool → granted)，持久化到 localStorage */
  rememberedDecisions: Record<string, boolean>;

  setPendingRequest: (request: PermissionRequest | null) => void;
  addRememberedDecision: (tool: string, granted: boolean) => void;
  getRememberedDecision: (tool: string) => boolean | undefined;
  clearRememberedDecisions: () => void;
}

export const usePermissionStore = create<PermissionState>()(
  persist(
    (set, get) => ({
      pendingRequest: null,
      rememberedDecisions: {},

      setPendingRequest: (request) => set({ pendingRequest: request }),

      addRememberedDecision: (tool, granted) =>
        set((s) => ({
          rememberedDecisions: { ...s.rememberedDecisions, [tool]: granted },
        })),

      getRememberedDecision: (tool) => get().rememberedDecisions[tool],

      clearRememberedDecisions: () => set({ rememberedDecisions: {} }),
    }),
    {
      name: STORAGE_KEY,
      // 只持久化 rememberedDecisions，pendingRequest 是运行时状态不需要持久化
      partialize: (s) => ({ rememberedDecisions: s.rememberedDecisions }),
      merge: (persisted, current) => {
        let decisions: Record<string, boolean> = {};
        try {
          const raw =
            persisted &&
            typeof persisted === 'object' &&
            'rememberedDecisions' in persisted
              ? (persisted as { rememberedDecisions: unknown }).rememberedDecisions
              : null;
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            // 只保留 boolean 值，丢弃格式不正确的条目
            for (const [k, v] of Object.entries(raw)) {
              if (typeof v === 'boolean') {
                decisions[k] = v;
              }
            }
          }
        } catch {
          decisions = {};
        }
        return { ...current, rememberedDecisions: decisions };
      },
    }
  )
);
