import { create } from "zustand";
import { persist } from "zustand/middleware";

/** 未读状态存储 key：按 agent + cwd 隔离 */
export function unreadKey(agentId: string, cwd: string): string {
  return `${agentId}:${cwd || "default"}`;
}

interface UnreadState {
  // 用户侧：每个 agent+cwd 的最后查看时间戳
  lastSeenMap: Record<string, string>; // key: `${agentId}:${cwd}` → ISO timestamp
  // 用户侧：每个 agent+cwd 的未读会话消息数
  sessionUnreadMap: Record<string, number>; // key: `${agentId}:${cwd}` → count
  // Teammate 侧：每个 agent 的未读 teammate 消息数（ teammate 未读不区分 cwd ）
  teammateUnreadMap: Record<string, number>; // agentId → count

  /** 获取合并后的总未读数 */
  getUnreadCount: (agentId: string, cwd: string) => number;
  /** 标记某个 agent+cwd 为已读（更新 lastSeenTimestamp 为当前时间，清零 sessionUnread） */
  markAsSeen: (agentId: string, cwd: string) => void;
  /** 设置 teammate 未读数（由轮询逻辑调用） */
  setTeammateUnread: (counts: Record<string, number>) => void;
  /** 设置用户侧会话未读数（由轮询逻辑调用） */
  setSessionUnread: (agentId: string, cwd: string, count: number) => void;
}

export const useUnreadStore = create<UnreadState>()(
  persist(
    (set, get) => ({
      lastSeenMap: {},
      sessionUnreadMap: {},
      teammateUnreadMap: {},

      getUnreadCount: (agentId: string, cwd: string) => {
        const state = get();
        const key = unreadKey(agentId, cwd);
        return (
          (state.sessionUnreadMap[key] ?? 0) +
          (state.teammateUnreadMap[agentId] ?? 0)
        );
      },

      markAsSeen: (agentId: string, cwd: string) => {
        const key = unreadKey(agentId, cwd);
        set((state) => ({
          lastSeenMap: {
            ...state.lastSeenMap,
            [key]: new Date().toISOString(),
          },
          sessionUnreadMap: {
            ...state.sessionUnreadMap,
            [key]: 0,
          },
        }));
      },

      setTeammateUnread: (counts: Record<string, number>) => {
        set({ teammateUnreadMap: counts });
      },

      setSessionUnread: (agentId: string, cwd: string, count: number) => {
        const key = unreadKey(agentId, cwd);
        set((state) => ({
          sessionUnreadMap: {
            ...state.sessionUnreadMap,
            [key]: count,
          },
        }));
      },
    }),
    {
      name: "agent-last-seen-map-v2",
      // 仅持久化 lastSeenMap，运行时状态不持久化
      partialize: (state) => ({ lastSeenMap: state.lastSeenMap }),
    }
  )
);
