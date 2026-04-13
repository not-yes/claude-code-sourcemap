import { useEffect, useRef } from 'react';
import { getUnreadCounts, getSessions } from '@/api/tauri-api';
import { useUnreadStore } from '@/stores/unreadStore';
import { useAgentsStore } from '@/stores/agentsStore';

const POLL_INTERVAL_MS = 12_000;

/**
 * 轮询未读消息数：
 * 1. 调用 getUnreadCounts() 获取 teammate 侧未读并写入 store
 * 2. 对每个非当前选中的 agent，检查是否有新会话（更新时间 > lastSeenMap）
 *
 * @param currentAgentId 当前选中的 agent ID，轮询时跳过（用户正在查看）
 */
export function useUnreadPolling(currentAgentId: string | null): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;

      const { agents } = useAgentsStore.getState();
      if (agents.length === 0) return;

      // 1. Teammate 未读
      try {
        const counts = await getUnreadCounts();
        useUnreadStore.getState().setTeammateUnread(counts);
      } catch (err) {
        // 静默失败，不中断轮询
        console.warn('[useUnreadPolling] getUnreadCounts 失败:', err);
      }

      // 2. 用户侧会话未读
      const { lastSeenMap, setSessionUnread } = useUnreadStore.getState();

      await Promise.all(
        agents
          .filter((a) => a.id !== currentAgentId)
          .map(async (a) => {
            const lastSeenTimestamp = lastSeenMap[a.id];
            // 没有 lastSeenTimestamp 表示从未查看过，不算未读
            if (!lastSeenTimestamp) return;

            try {
              const sessions = await getSessions({ agent_id: a.id, limit: 1 });
              if (sessions.length > 0) {
                const session = sessions[0];
                const updatedAt = session.updated_at;
                if (updatedAt && updatedAt > lastSeenTimestamp) {
                  setSessionUnread(a.id, 1);
                } else {
                  setSessionUnread(a.id, 0);
                }
              }
            } catch (err) {
              // 静默失败，不中断轮询
              console.warn(`[useUnreadPolling] getSessions 失败 agentId=${a.id}:`, err);
            }
          })
      );
    };

    // 挂载时立即执行一次
    void poll();

    // 设置定时轮询
    intervalRef.current = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [currentAgentId]);
}
