/**
 * 按前端 Agent（主聊为 "main"，否则为 agent id）持久化后端会话 ID，
 * 便于 App 重开或断线后继续用同一 session_id 对接后端。
 *
 * @deprecated 会话历史已迁移到 Sidecar 文件系统持久化层
 * （~/.claude-desktop/sessions/）。
 * 此文件中的 localStorage 调用仅用于存储「当前连接的后端会话 ID」，
 * 并非完整的会话元数据和消息历史。
 * 不要删除，保持向后兼容。
 */

const PREFIX = "claude_backend_session_";

/**
 * 生成存储 key，按 Agent 和工作目录隔离会话。
 * Claude Code CLI 默认按 cwd 隔离会话，前端保持一致行为。
 */
function makeKey(agentKey: string, cwd?: string): string {
  if (cwd) {
    const safeCwd = cwd.replace(/[:/\\]/g, '_');
    return `${PREFIX}${agentKey}_${safeCwd}`;
  }
  return `${PREFIX}${agentKey}`;
}

/**
 * 加载指定 Agent 的持久化后端会话 ID。
 * - 支持按工作目录隔离会话（提供 cwd 参数时）
 * - 读取失败时静默返回 null，不崩溃。
 */
export function loadPersistedBackendSession(agentKey: string, cwd?: string): string | null {
  try {
    // 先尝试按 cwd 加载
    if (cwd) {
      const v = localStorage.getItem(makeKey(agentKey, cwd));
      if (v != null && v !== "") return v;
    }
    // fallback：尝试不带 cwd 的 key（兼容 cwd 切换后的场景）
    const v = localStorage.getItem(makeKey(agentKey));
    if (v != null && v !== "") return v;
    return null;
  } catch {
    return null;
  }
}

/**
 * 保存或清除指定 Agent 的后端会话 ID。
 * - 支持按工作目录隔离会话（提供 cwd 参数时）
 * - 传入 null / 空字符串时删除对应 key。
 * - 写入失败（如配额溢出）时静默忽略，不崩溃。
 */
export function savePersistedBackendSession(
  agentKey: string,
  backendSessionId: string | null,
  cwd?: string
): void {
  try {
    // 保存/清除带 cwd 的 key（向后兼容）
    if (cwd) {
      const keyWithCwd = makeKey(agentKey, cwd);
      if (backendSessionId == null || backendSessionId === "") {
        localStorage.removeItem(keyWithCwd);
      } else {
        localStorage.setItem(keyWithCwd, backendSessionId);
      }
    }
    // 同时保存/清除不带 cwd 的 fallback key
    // 这样无论 cwd 如何变化，都能加载到 session ID
    const keyWithoutCwd = makeKey(agentKey);
    if (backendSessionId == null || backendSessionId === "") {
      localStorage.removeItem(keyWithoutCwd);
    } else {
      localStorage.setItem(keyWithoutCwd, backendSessionId);
    }
  } catch {
    // localStorage 不可用或配额溢出时静默忽略
    if (import.meta.env.DEV) {
      console.warn(
        "[backendSessionStorage] savePersistedBackendSession failed for agent:",
        agentKey,
        "cwd:",
        cwd
      );
    }
  }
}

/**
 * 清理属于指定 Agent + 工作目录组合之外的孤立条目（防止 localStorage 污染累积）。
 * 应在应用初始化时或 Agent 列表刚加载完毕后调用一次。
 *
 * @param knownAgentCwdPairs - 当前已知有效的 (agentKey, cwd) 组合列表。
 */
export function pruneOrphanedBackendSessions(
  knownAgentCwdPairs: { agentKey: string; cwd?: string }[]
): void {
  try {
    // 构建有效 key 集合（包含 cwd 后缀和无 cwd 的 fallback）
    const validKeys = new Set<string>();
    for (const { agentKey, cwd } of knownAgentCwdPairs) {
      if (cwd) {
        const safeCwd = cwd.replace(/[:/\\]/g, '_');
        validKeys.add(`${PREFIX}${agentKey}_${safeCwd}`);
      }
      // 同时保留无 cwd 的 fallback key（向后兼容）
      validKeys.add(`${PREFIX}${agentKey}`);
    }

    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX) && !validKeys.has(k)) {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) {
      localStorage.removeItem(k);
    }
    if (import.meta.env.DEV && toRemove.length > 0) {
      console.log(
        "[backendSessionStorage] pruned " + toRemove.length + " orphaned session key(s):",
        toRemove
      );
    }
  } catch {
    // localStorage 不可用时静默忽略
  }
}
