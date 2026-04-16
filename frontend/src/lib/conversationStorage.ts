import type { Message, MessageContentBlock, TokenUsage } from "@/types";

const STORAGE_PREFIX = "claude_messages_";
const MAX_MESSAGES = 500;

/**
 * 生成存储 key，按工作目录隔离。
 * Claude Code CLI 默认按 cwd 隔离会话，前端保持一致行为。
 */
function makeKey(sessionId: string, cwd?: string): string {
  if (cwd) {
    const safeCwd = cwd.replace(/[:/\\]/g, '_');
    return `${STORAGE_PREFIX}${sessionId}_${safeCwd}`;
  }
  return `${STORAGE_PREFIX}${sessionId}`;
}

/** 分页加载每页消息条数 */
export const PAGE_SIZE = 50;

/** 内存中最多保留的消息条数（防止消息数组无限增长） */
export const MAX_MESSAGES_IN_MEMORY = 1000;

/** 单条用户输入最大字节数（1MB） */
export const MAX_MESSAGE_SIZE = 1_000_000;

/** 单条 assistant 响应最大字节数（50MB） */
export const MAX_RESPONSE_SIZE = 50_000_000;

/** 单条消息最多 content blocks 数 */
export const MAX_CONTENT_BLOCKS = 500;

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  contentBlocks?: MessageContentBlock[];
  usage?: TokenUsage;
  createdAt: string;
}

function toStored(m: Message): StoredMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    contentBlocks: m.contentBlocks,
    usage: m.usage,
    createdAt: m.createdAt.toISOString(),
  };
}

function fromStored(m: StoredMessage): Message {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    contentBlocks: m.contentBlocks,
    usage: m.usage,
    createdAt: new Date(m.createdAt),
  };
}

/**
 * 从 localStorage 加载指定会话的消息列表。
 * - 数据损坏（JSON 解析失败）时静默返回空数组，不崩溃。
 * - 读取时同样做 FIFO 截断，防止存储层写入时失败但已有超量旧数据。
 * - 支持按工作目录隔离（提供 cwd 参数时）
 */
export function loadMessages(sessionId: string, cwd?: string): Message[] {
  try {
    const key = makeKey(sessionId, cwd);
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredMessage[];
    return (Array.isArray(parsed) ? parsed : [])
      .slice(-MAX_MESSAGES)
      .map(fromStored);
  } catch (err) {
    // 数据损坏或 localStorage 不可用时降级为空列表
    if (import.meta.env.DEV) {
      console.warn("[conversationStorage] loadMessages failed:", err);
    }
    return [];
  }
}

/**
 * 将消息列表持久化到 localStorage。
 * - 保留最新 MAX_MESSAGES 条（FIFO，slice(-N) 保留尾部）。
 * - 捕获 QuotaExceededError：配额不足时尝试减半后重试一次；
 *   仍失败则静默放弃，保证不崩溃。
 * - 支持按工作目录隔离（提供 cwd 参数时）
 */
export function saveMessages(sessionId: string, messages: Message[], cwd?: string): void {
  const key = makeKey(sessionId, cwd);

  function tryWrite(msgs: StoredMessage[]): boolean {
    try {
      localStorage.setItem(key, JSON.stringify(msgs));
      return true;
    } catch {
      return false;
    }
  }

  try {
    const toSave = messages.slice(-MAX_MESSAGES).map(toStored);
    if (!tryWrite(toSave)) {
      // 配额不足：减半后重试一次
      const half = toSave.slice(-Math.floor(MAX_MESSAGES / 2));
      if (!tryWrite(half)) {
        if (import.meta.env.DEV) {
          console.warn(
            "[conversationStorage] saveMessages: localStorage quota exceeded, skipping save for session",
            sessionId
          );
        }
      }
    }
  } catch (err) {
    // 兜底：任何意外错误都不应导致崩溃
    if (import.meta.env.DEV) {
      console.warn("[conversationStorage] saveMessages unexpected error:", err);
    }
  }
}

/**
 * 分页加载消息（offset 从末尾计算，0 表示最新的 limit 条）。
 * - offset=0, limit=50 → 最新 50 条
 * - offset=50, limit=50 → 倒数第 51~100 条
 */
export function loadMessagesPaginated(
  sessionId: string,
  offset: number,
  limit: number,
  cwd?: string
): Message[] {
  const all = loadMessages(sessionId, cwd);
  // offset 从末尾计数
  const end = all.length - offset;
  const start = Math.max(0, end - limit);
  return all.slice(start, Math.max(0, end));
}

/**
 * 获取指定会话的消息总数。
 */
export function getTotalMessageCount(sessionId: string, cwd?: string): number {
  return loadMessages(sessionId, cwd).length;
}

/**
 * 删除指定会话的消息缓存（会话删除时调用）。
 */
export function clearMessages(sessionId: string, cwd?: string): void {
  try {
    localStorage.removeItem(makeKey(sessionId, cwd));
  } catch {
    // localStorage 不可用时静默忽略
  }
}

const SESSION_TIMESTAMP_PREFIX = 'claude_session_ts_';

/**
 * 生成时间戳 key，与 makeKey 保持一致格式。
 */
function makeTsKey(sessionId: string, cwd?: string): string {
  if (cwd) {
    const safeCwd = cwd.replace(/[:/\\]/g, '_');
    return `${SESSION_TIMESTAMP_PREFIX}${sessionId}_${safeCwd}`;
  }
  return `${SESSION_TIMESTAMP_PREFIX}${sessionId}`;
}

/**
 * 更新指定会话的最后访问时间戳。
 * - 支持按工作目录隔离（提供 cwd 参数时）
 */
export function touchSession(sessionId: string, cwd?: string): void {
  try {
    localStorage.setItem(makeTsKey(sessionId, cwd), Date.now().toString());
  } catch { /* ignore quota errors */ }
}

/**
 * 清理旧会话，仅保留最近访问的 keepCount 个会话。
 * 通过 tsKey 遍历（因为 tsKey 有 SESSION_TIMESTAMP_PREFIX 前缀，易于识别），
 * 再用 makeKey 尝试找到对应的 msgKey。
 */
export function cleanupOldSessions(keepCount: number = 10): void {
  try {
    // 从 tsKey 格式反推可能的 msgKey
    // tsKey 格式: claude_session_ts_{sessionId}_{safeCwd} 或 claude_session_ts_{sessionId}
    const sessions: { msgKey: string | null; tsKey: string; ts: number }[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const tsKey = localStorage.key(i);
      if (!tsKey || !tsKey.startsWith(SESSION_TIMESTAMP_PREFIX)) continue;

      const tsPart = tsKey.slice(SESSION_TIMESTAMP_PREFIX.length);
      const lastUnderscore = tsPart.lastIndexOf('_');
      let sessionId: string;
      let safeCwd: string | undefined;

      if (lastUnderscore > 0) {
        sessionId = tsPart.slice(0, lastUnderscore);
        safeCwd = tsPart.slice(lastUnderscore + 1);
      } else {
        sessionId = tsPart;
        safeCwd = undefined;
      }

      // 用 makeKey 尝试找到对应的 msgKey
      const msgKey = makeKey(sessionId, safeCwd);
      const msgKeyExists = localStorage.getItem(msgKey) !== null;
      const ts = parseInt(localStorage.getItem(tsKey) || '0', 10);

      sessions.push({ msgKey: msgKeyExists ? msgKey : null, tsKey, ts });
    }

    if (sessions.length <= keepCount) return;

    // 按时间戳升序排列（最旧在前）
    sessions.sort((a, b) => a.ts - b.ts);

    // 删除最旧的会话（包括 orphaned tsKey 对应的 msgKey）
    const toRemove = sessions.slice(0, sessions.length - keepCount);
    for (const s of toRemove) {
      if (s.msgKey) localStorage.removeItem(s.msgKey);
      localStorage.removeItem(s.tsKey);
    }
  } catch { /* ignore */ }
}

/**
 * 获取 localStorage 使用百分比（粗略估算，基于 5MB 限制）。
 */
export function getLocalStorageUsagePercent(): number {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const val = localStorage.getItem(key);
        total += (key.length + (val?.length || 0)) * 2;
      }
    }
    return (total / (5 * 1024 * 1024)) * 100; // assume 5MB limit
  } catch {
    return 0;
  }
}
