import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UnreadState {
  // 用户侧：每个 agent 的最后查看时间戳
  lastSeenMap: Record<string, string>; // agentId → ISO timestamp
  // 用户侧：每个 agent 的未读会话消息数
  sessionUnreadMap: Record<string, number>; // agentId → count
  // Teammate 侧：每个 agent 的未读 teammate 消息数
  teammateUnreadMap: Record<string, number>; // agentId → count

  /** 获取合并后的总未读数 */
  getUnreadCount: (agentId: string) => number;
  /** 标记某个 agent 为已读（更新 lastSeenTimestamp 为当前时间，清零 sessionUnread） */
  markAsSeen: (agentId: string) => void;
  /** 设置 teammate 未读数（由轮询逻辑调用） */
  setTeammateUnread: (counts: Record<string, number>) => void;
  /** 设置用户侧会话未读数（由轮询逻辑调用） */
  setSessionUnread: (agentId: string, count: number) => void;
}

export const useUnreadStore = create<UnreadState>()(
  persist(
    (set, get) => ({
      lastSeenMap: {},
      sessionUnreadMap: {},
      teammateUnreadMap: {},

      getUnreadCount: (agentId: string) => {
        const state = get();
        return (
          (state.sessionUnreadMap[agentId] ?? 0) +
          (state.teammateUnreadMap[agentId] ?? 0)
        );
      },

      markAsSeen: (agentId: string) => {
        set((state) => ({
          lastSeenMap: {
            ...state.lastSeenMap,
            [agentId]: new Date().toISOString(),
          },
          sessionUnreadMap: {
            ...state.sessionUnreadMap,
            [agentId]: 0,
          },
        }));
      },

      setTeammateUnread: (counts: Record<string, number>) => {
        set({ teammateUnreadMap: counts });
      },

      setSessionUnread: (agentId: string, count: number) => {
        set((state) => ({
          sessionUnreadMap: {
            ...state.sessionUnreadMap,
            [agentId]: count,
          },
        }));
      },
    }),
    {
      name: "agent-last-seen-map",
      // 仅持久化 lastSeenMap，运行时状态不持久化
      partialize: (state) => ({ lastSeenMap: state.lastSeenMap }),
    }
  )
);
