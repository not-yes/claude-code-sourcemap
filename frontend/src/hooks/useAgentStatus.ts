import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * 追踪指定 Agent 的运行状态
 * @param agentId - 要追踪的 Agent ID
 * @param pollInterval - 轮询间隔（毫秒），默认 5000
 */
export function useAgentStatus(agentId?: string, pollInterval = 5000) {
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    if (!agentId) return;

    setLoading(true);
    try {
      const isRunning = await invoke<boolean>("agent_is_running", {
        agentId,
      });
      setRunning(isRunning);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (!agentId) {
      setRunning(false);
      setError(null);
      return;
    }

    // 立即检查一次
    checkStatus();

    // 定时轮询
    const interval = setInterval(checkStatus, pollInterval);
    return () => clearInterval(interval);
  }, [agentId, pollInterval, checkStatus]);

  return { running, loading, error, refresh: checkStatus };
}
