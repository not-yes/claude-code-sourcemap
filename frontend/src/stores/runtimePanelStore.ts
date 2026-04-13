import { create } from "zustand";
import type { StreamEventPayload } from "@/api/tauri-api";

// ─── 类型定义 ──────────────────────────────────────────────────────────────

/** 统一时间线日志条目 */
export interface RuntimeLogEntry {
  id: string;
  type:
    | "thinking"
    | "text"
    | "tool_use"
    | "tool_result"
    | "system"
    | "context_compact"
    | "complete";
  timestamp: number;
  // thinking / text
  content?: string;
  // tool_use
  toolName?: string;
  toolId?: string;
  input?: Record<string, unknown>;
  // tool_result
  result?: string;
  isError?: boolean;
  // system
  level?: "info" | "warning" | "error";
  // context_compact
  preTokenCount?: number;
  postTokenCount?: number;
  // complete
  usage?: { inputTokens?: number; outputTokens?: number };
  reason?: string;
}

// ─── 常量 ──────────────────────────────────────────────────────────────────

const MAX_LOG_ENTRIES = 500;
let _idCounter = 0;
const genId = () => `rt-${Date.now()}-${++_idCounter}`;

// ─── Store 接口 ────────────────────────────────────────────────────────────

interface RuntimePanelState {
  /** 统一时间线日志条目列表 */
  logEntries: RuntimeLogEntry[];

  /** 是否有新内容（用于触发自动显示）*/
  hasNewContent: boolean;

  // Actions
  pushStreamEvent: (event: StreamEventPayload) => void;
  clearSession: () => void;
  setHasNewContent: (v: boolean) => void;
}

// ─── RAF 批处理基础设施 ───────────────────────────────────────────────────

let _pendingEvents: StreamEventPayload[] = [];
let _rafId: number | null = null;

// ─── 工具名查找（用于 tool_result 关联 tool_use name）────────────────────

function findToolNameById(
  logEntries: RuntimeLogEntry[],
  toolId: string
): string | undefined {
  for (let i = logEntries.length - 1; i >= 0; i--) {
    const e = logEntries[i];
    if (e.type === "tool_use" && e.toolId === toolId) {
      return e.toolName;
    }
  }
  return undefined;
}

// ─── 批量处理逻辑 ─────────────────────────────────────────────────────────

function processBatch(
  batch: StreamEventPayload[],
  get: () => RuntimePanelState,
  set: (partial: Partial<RuntimePanelState>) => void
) {
  if (batch.length === 0) return;

  const state = get();
  let logEntries = [...state.logEntries];

  for (const event of batch) {
    switch (event.type) {
      // ── 思考流 / 文本流 ──────────────────────────────────────────
      case "text": {
        const isThinking = Boolean(event.isThinking);
        const entryType = isThinking ? "thinking" : "text";
        const content = String(event.content ?? "");

        // 合并到最后一条同类型条目（避免每个 token 一个条目）
        const last = logEntries[logEntries.length - 1];
        if (last && last.type === entryType) {
          logEntries[logEntries.length - 1] = {
            ...last,
            content: (last.content ?? "") + content,
          };
        } else {
          logEntries.push({
            id: genId(),
            type: entryType,
            timestamp: Date.now(),
            content,
          });
        }
        break;
      }

      // ── 工具调用 ─────────────────────────────────────────────────
      case "tool_use": {
        logEntries.push({
          id: genId(),
          type: "tool_use",
          timestamp: Date.now(),
          toolName: String(event.name ?? ""),
          toolId: String(event.id ?? genId()),
          input: (event.input as Record<string, unknown>) ?? {},
        });
        break;
      }

      // ── 工具结果 ─────────────────────────────────────────────────
      case "tool_result": {
        const toolId = String(event.id ?? "");
        const isErr = Boolean(event.isError);
        const resultStr =
          typeof event.result === "string"
            ? event.result
            : event.result !== undefined
            ? JSON.stringify(event.result)
            : "";
        const toolName = findToolNameById(logEntries, toolId);
        logEntries.push({
          id: genId(),
          type: "tool_result",
          timestamp: Date.now(),
          toolId,
          toolName,
          result: resultStr,
          isError: isErr,
        });
        break;
      }

      // ── 系统消息 ─────────────────────────────────────────────────
      case "system_message": {
        const content = String(event.content ?? "");
        if (!content) break;
        logEntries.push({
          id: genId(),
          type: "system",
          timestamp: Date.now(),
          content,
          level: "info",
        });
        break;
      }

      // ── 上下文压缩 ───────────────────────────────────────────────
      case "context_compact": {
        logEntries.push({
          id: genId(),
          type: "context_compact",
          timestamp: Date.now(),
          preTokenCount: Number(event.preTokenCount ?? 0),
          postTokenCount: Number(event.postTokenCount ?? 0),
        });
        break;
      }

      // ── 完成事件 ─────────────────────────────────────────────────
      case "complete": {
        logEntries.push({
          id: genId(),
          type: "complete",
          timestamp: Date.now(),
          usage: event.usage
            ? {
                inputTokens: (event.usage as { inputTokens?: number }).inputTokens,
                outputTokens: (event.usage as { outputTokens?: number }).outputTokens,
              }
            : undefined,
          reason: event.reason ? String(event.reason) : undefined,
        });
        break;
      }

      default:
        break;
    }
  }

  // FIFO 上限 500 条
  if (logEntries.length > MAX_LOG_ENTRIES) {
    logEntries = logEntries.slice(-MAX_LOG_ENTRIES);
  }

  set({ logEntries, hasNewContent: true });
}

// ─── Store 创建 ────────────────────────────────────────────────────────────

export const useRuntimePanelStore = create<RuntimePanelState>((set, get) => ({
  // ── 初始状态 ─────────────────────────────────────────────────
  logEntries: [],
  hasNewContent: false,

  // ── Actions ──────────────────────────────────────────────────
  setHasNewContent: (v) => set({ hasNewContent: v }),

  /**
   * pushStreamEvent：RAF 批处理入口。
   * 将事件缓冲至下一帧，批量处理以减少 re-render 次数。
   */
  pushStreamEvent: (event) => {
    _pendingEvents.push(event);
    if (_rafId === null) {
      _rafId = requestAnimationFrame(() => {
        const batch = _pendingEvents;
        _pendingEvents = [];
        _rafId = null;
        processBatch(batch, get, (partial) =>
          set((s) => ({ ...s, ...partial }))
        );
      });
    }
  },

  clearSession: () => {
    // 取消待处理的 RAF
    if (_rafId !== null) {
      cancelAnimationFrame(_rafId);
      _rafId = null;
    }
    _pendingEvents = [];
    set({
      logEntries: [],
      hasNewContent: false,
    });
  },
}));

/** 裸 store（供非 React 环境访问，如事件监听器）*/
export const runtimePanelStore = useRuntimePanelStore;
