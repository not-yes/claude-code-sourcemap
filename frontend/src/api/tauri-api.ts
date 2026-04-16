import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { runtimePanelStore } from '../stores/runtimePanelStore';
import { useAppStore } from '../stores/appStore';
import type {
  SessionItem,
  SessionMessage,
  CheckpointListItem,
  SaveCheckpointResult,
  RollbackCheckpointResult,
  CompareCheckpointsResult,
  CheckpointTimelineResult,
  ExportCheckpointResult,
  ImportCheckpointResult,
  BatchDeleteCheckpointResult,
  CronJob,
  CronHistoryItem,
  ToolDefinition,
} from "@/types/api";
import type {
  AgentInfo,
  AgentDetail,
  AgentMemoryStatsResult,
  AgentMemoryEntry,
  AgentTopologyOption,
} from "@/types/agents";
import type {
  SkillInfo,
  SkillDetail,
  RemoteSkillItem,
} from "@/types/skills";

// 重导出共享类型，保持对外 API 兼容
export type {
  SessionItem,
  SessionMessage,
  CheckpointListItem,
  SaveCheckpointResult,
  RollbackCheckpointResult,
  CompareCheckpointsResult,
  CheckpointTimelineResult,
  ExportCheckpointResult,
  ImportCheckpointResult,
  BatchDeleteCheckpointResult,
  CronJob,
  CronHistoryItem,
  ToolDefinition,
  AgentInfo,
  AgentDetail,
  AgentMemoryStatsResult,
  AgentMemoryEntry,
  SkillInfo,
  SkillDetail,
  RemoteSkillItem,
} from "@/types/index";
export { AGENT_TOPOLOGY_OPTIONS } from "@/types/agents";
export type { AgentTopologyOption } from "@/types/agents";

// -------- Agent 事件命名空间工具 --------

/**
 * 构建带 agent 命名空间的事件名
 * 格式：`agent:{agentId}:{event}`，例如 `agent:main:stream:xxx`
 * @param agentId - Agent 实例 ID，默认为 "main"
 * @param event - 基础事件名（不含 agent: 前缀）
 */
export function buildAgentEventName(agentId: string | undefined, event: string): string {
  return `agent:${agentId || 'main'}:${event}`;
}

// -------- 自定义错误类 --------

/**
 * 超时错误：当 Tauri IPC 或 Sidecar 请求超时时抛出
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

// -------- Tauri 环境检测与统一调用包装 --------

/**
 * 检查当前环境是否在 Tauri WebView 中运行
 */
function isTauriAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

/**
 * 等待 Tauri API 准备就绪
 */
async function waitForTauri(maxRetries = 50, intervalMs = 100): Promise<boolean> {
  if (isTauriAvailable()) return true;

  for (let i = 0; i < maxRetries; i++) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    if (isTauriAvailable()) return true;
  }

  // 最终检测：即使等待后仍未就绪，也返回false而不是抛出错误
  return isTauriAvailable();
}

/**
 * 安全的 invoke 包装函数：
 * - 非 Tauri 环境下不抛出未定义错误
 * - Sidecar 未启动时给出友好提示
 * - 分类处理 SIDECAR_NOT_RUNNING / RPC_ERROR / IPC_ERROR
 */
async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriAvailable()) {
    const available = await waitForTauri();
    if (!available) {
      console.warn(`[tauri-api] Tauri not available after waiting, skipping: ${cmd}`);
      throw new Error('TAURI_NOT_AVAILABLE: 请确保应用通过 Tauri 启动 (npm run tauri:dev)');
    }
  }
  try {
    return await invoke<T>(cmd, args);
  } catch (error: unknown) {
    // 提取错误消息：优先字符串，其次 Error 对象 message，最后 String 转换
    const msg =
      typeof error === 'string'
        ? error
        : error instanceof Error
          ? error.message
          : String(error);

    // 特殊处理：如果是Tauri相关错误，提供更详细的提示
    if (msg?.includes('TAURI_NOT_AVAILABLE') || msg?.includes('invoke')) {
      console.error(`[tauri-api] Invoke failed for ${cmd}:`, msg);
      throw new Error(`Tauri IPC 调用失败: ${cmd}。请检查后端是否正常启动。`);
    }

    if (msg?.startsWith('SIDECAR_NOT_RUNNING')) {
      throw new Error('SIDECAR_NOT_RUNNING: Sidecar 未启动，请先连接');
    }
    if (msg?.startsWith('RPC_ERROR:')) {
      // Sidecar 返回了 JSON-RPC 错误响应，剥离前缀后抛出
      throw new Error(msg.slice('RPC_ERROR:'.length).trim());
    }
    if (msg?.startsWith('IPC_ERROR:')) {
      // 发送/接收消息失败（超时、channel 关闭等），剥离前缀后抛出
      const innerMsg = msg.slice('IPC_ERROR:'.length).trim();
      if (
        innerMsg.includes('timeout') ||
        innerMsg.includes('timed out') ||
        innerMsg.includes('请求超时')
      ) {
        throw new TimeoutError(`[TimeoutError] ${innerMsg}`);
      }
      throw new Error(innerMsg);
    }
    // 兜底：检查原始消息是否含超时关键字
    if (
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('请求超时')
    ) {
      throw new TimeoutError(`[TimeoutError] ${msg}`);
    }
    throw error;
  }
}

/**
 * 带自动重试的 Tauri invoke 包装，用于 Sidecar RPC 调用。
 * 针对 TimeoutError、SIDECAR_NOT_RUNNING、IPC_ERROR 等瞬态错误自动重试，
 * 使用指数退避策略。
 */
async function retryableInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
  options: { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 500, maxDelayMs = 5000 } = options;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await safeInvoke<T>(cmd, args);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const msg = lastError.message;

      // 判断是否为可重试的瞬态错误
      const isRetryable =
        e instanceof TimeoutError ||
        msg.includes('SIDECAR_NOT_RUNNING') ||
        msg.includes('IPC_ERROR') ||
        msg.includes('Sidecar 未启动') ||
        msg.includes('stdin writer channel') ||
        msg.includes('CONCURRENT_LIMIT') ||
        msg.includes('concurrent limit') ||
        msg.includes('agent limit');

      if (!isRetryable || attempt >= maxRetries) {
        throw lastError;
      }

      // 指数退避
      const delayMs = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      console.warn(
        `[tauri-api] RPC 请求失败 (attempt ${attempt + 1}/${maxRetries + 1})，` +
        `${delayMs}ms 后重试: ${msg}`
      );
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError!;
}

// -------- 核心执行 --------

/**
 * 同步执行指令，返回文本结果
 */
export async function execute(
  content: string,
  options?: { sessionId?: string; agentId?: string }
): Promise<string> {
  // sessionId 和 agentId 是不同语义：
  // sessionId 是后端持久会话 ID，agentId 是 agent 配置标识
  // 两者分别传递，不互相覆盖
  return safeInvoke<string>("agent_execute_once", {
    content,
    options: {
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options?.agentId ? { agentId: options.agentId } : {}),
    },
  });
}

export type StreamEventPayload =
  | { type: "text"; content: string; isThinking?: boolean }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; toolName: string; result: unknown; isError?: boolean; filePath?: string }
  | { type: "system_message"; level: "info" | "warning" | "error"; content: string }
  | { type: "context_compact"; preTokenCount: number; postTokenCount: number }
  | { type: "error"; message?: string; code?: string }
  /**
   * Complete event now includes usage, reason, and sessionId fields.
   * Emitted from Rust IPC bridge after $/complete notification.
   */
  | { type: "complete"; usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number }; reason?: string; sessionId?: string }
  | { type: string; [key: string]: unknown };  // 底安：未知事件类型

export type ExecuteStreamCallbacks = {
  onChunk: (text: string) => void;
  onDone: (error: Error | null, aborted?: boolean) => void;
  onEvent?: (event: StreamEventPayload) => void;  // 新增：完整事件回调
};

export type ExecuteStreamOptions = ExecuteStreamCallbacks & {
  signal?: AbortSignal;
};

export type ExecuteStreamSessionOptions = {
  /** 后端持久会话 ID（存在时优先用于会话绑定） */
  backendSessionId?: string;
  /** Agent 配置标识（用于加载 soul 和 skills），独立于 backendSessionId */
  agentId?: string;
  /** 工作目录（Agent 启动时使用） */
  cwd?: string;
  /** 权限模式（默认由 sidecar entry.ts 保持 interactive） */
  permissionMode?: 'auto-approve' | 'interactive' | 'plan-only' | 'deny-all';
};

/**
 * 流式执行指令：通过 Tauri IPC 发送请求，监听 agent:stream:{streamId} 事件获取结果
 */
export async function executeStream(
  content: string,
  sessionOpts: ExecuteStreamSessionOptions,
  callbacks: ExecuteStreamOptions
): Promise<void> {
  const { onChunk, onDone, signal } = callbacks;
  // sessionId 和 agentId 是不同语义：
  // sessionId 是后端持久会话 ID，agentId 是 agent 配置标识
  // 两者可同时传递，分别用于不同目的
  const sessionId = sessionOpts.backendSessionId;
  const agentId = sessionOpts.agentId;
  console.warn(`[executeStream] 进入, agentId=${agentId}, backendSessionId=${sessionId}`);

  // 已中止则直接返回
  if (signal?.aborted) {
    onDone(null, true);
    return;
  }

  try {
    // 1. 向 Rust 后端发送执行请求，获取流 ID
    // Rust IPC 层会将 options 原样透传到 Sidecar JSON-RPC params

    // 如果指定了非 main 的 agentId，获取其 soul 作为 systemPrompt 传给 LLM
    // agent 配置存在文件系统上，任意运行中的 sidecar 都能读取——直接用 main sidecar
    let agentSystemPrompt: string | undefined
    if (agentId && agentId !== "main") {
      console.warn(`[executeStream] 开始 getAgent, agentId=${agentId}`);
      try {
        // agent 配置读自文件，不依赖特定 sidecar 实例——直接用 main sidecar
        const agentDetail = await retryableInvoke<AgentDetail>("agent_send_request", {
          method: "getAgent",
          params: { name: agentId },
        })
        console.log(`[executeStream] getAgent(${agentId}): soul长度=${agentDetail?.soul?.length ?? 0}, soul有值=${!!agentDetail?.soul}`);
        if (agentDetail?.soul) {
          agentSystemPrompt = agentDetail.soul
          console.log(`[executeStream] agent soul 已加载: agentId=${agentId}, soul前100字符="${agentSystemPrompt.slice(0, 100)}"`)
        } else {
          console.warn(`[executeStream] getAgent(${agentId}) 返回空 soul，将依赖 sidecar 内部 loadAgentSoul 备用路径`);
        }
        console.warn(`[executeStream] getAgent 完成, agentId=${agentId}, hasSoul=${!!agentSystemPrompt}`);
      } catch (e) {
        // 获取失败（main sidecar 未启动），依赖 AgentCore.execute 内部的 loadAgentSoul
        console.warn(`[executeStream] getAgent(${agentId}) 失败（依赖 sidecar 内部备用路径）: ${e}`);
      }
    }

    // 1. 前端生成 streamId，确保先注册监听再 invoke，消除竞态条件
    const streamId = crypto.randomUUID();

    // 2. 构建事件名（需在注册监听器前就确定）
    const doneEventName = buildAgentEventName(agentId, `stream:${streamId}:done`);
    const streamEventName = buildAgentEventName(agentId, `stream:${streamId}`);

    const execOptions = {
      ...(sessionId ? { sessionId } : {}),
      ...(agentId ? { agentId } : {}),
      ...(agentSystemPrompt ? { systemPrompt: agentSystemPrompt } : {}),
      ...(sessionOpts.cwd ? { cwd: sessionOpts.cwd } : {}),
      ...(sessionOpts.permissionMode ? { permissionMode: sessionOpts.permissionMode } : {}),
      streamId,  // 将前端生成的 streamId 传给 Rust
    };
    console.log(`[executeStream] 发起 agent_execute: agentId=${agentId ?? 'main'}, sessionId=${sessionId}, 有systemPrompt=${!!agentSystemPrompt}, streamId=${streamId}, options=`, JSON.stringify(execOptions));

    let unlisten: UnlistenFn | null = null;
    let unlistenDone: UnlistenFn | null = null;
    let done = false;
    let eventCount = 0;

    // 10 秒超时检查：如果没收到任何事件则发出警告
    const timeoutHandle = setTimeout(() => {
      if (!done && eventCount === 0) {
        console.warn(
          `[executeStream] 警告: streamId=${streamId} 已过 10 秒仍未收到任何流式事件!` +
          ` 请检查 Rust 日志确认 dispatch_message 是否被调用。`
        );
      }
    }, 10_000);

    // 双层超时保护：空闲超时（每次收到事件重置）+ 绝对超时（总上限）
    const IDLE_TIMEOUT_MS = 600_000;           // 空闲超时：600 秒无事件（应对 LLM 首 token 极慢的场景）
    const ABSOLUTE_TIMEOUT_MS = 30 * 60 * 1000; // 绝对超时：30 分钟总上限

    const idleTimeout = { handle: undefined as ReturnType<typeof setTimeout> | undefined };
    const absoluteTimeout = { handle: undefined as ReturnType<typeof setTimeout> | undefined };

    const cleanup = () => {
      clearTimeout(timeoutHandle);
      if (idleTimeout.handle !== undefined) clearTimeout(idleTimeout.handle);
      if (absoluteTimeout.handle !== undefined) clearTimeout(absoluteTimeout.handle);
      unlisten?.();
      unlistenDone?.();
      unlisten = null;
      unlistenDone = null;
    };

    const resetIdleTimeout = () => {
      if (idleTimeout.handle) clearTimeout(idleTimeout.handle);
      idleTimeout.handle = setTimeout(async () => {
        if (!done) {
          console.error(
            `[executeStream] 空闲超时 streamId=${streamId}: 连续 ${IDLE_TIMEOUT_MS / 1000} 秒未收到事件, eventCount=${eventCount}`
          );
          done = true;

          try {
            await abortExecution(streamId);
          } catch (abortErr) {
            console.warn(`[executeStream] abortExecution 失败:`, abortErr);
          }

          cleanup();

          const timeoutError = new TimeoutError(
            eventCount === 0
              ? `Agent 在 ${IDLE_TIMEOUT_MS / 1000} 秒内没有响应，可能是某个工具或网络请求阻塞了（streamId=${streamId}）`
              : `执行空闲超时：连续 ${IDLE_TIMEOUT_MS / 1000} 秒未收到事件 (streamId=${streamId}, eventCount=${eventCount})`
          );
          Object.assign(timeoutError, { cause: { streamId, eventCount, recoverable: true, type: 'idle' } });
          onDone(timeoutError, false);
        }
      }, IDLE_TIMEOUT_MS);
    };

    // 初始启动空闲超时
    resetIdleTimeout();

    // 绝对超时（30 分钟总上限）
    absoluteTimeout.handle = setTimeout(async () => {
      if (!done) {
        console.error(
          `[executeStream] 绝对超时 streamId=${streamId}: 超过 ${ABSOLUTE_TIMEOUT_MS / 1000 / 60} 分钟, eventCount=${eventCount}`
        );
        done = true;

        try {
          await abortExecution(streamId);
        } catch (abortErr) {
          console.warn(`[executeStream] abortExecution 失败:`, abortErr);
        }

        cleanup();

        const timeoutError = new TimeoutError(
          `执行总超时：超过 ${ABSOLUTE_TIMEOUT_MS / 1000 / 60} 分钟 (streamId=${streamId}, eventCount=${eventCount})`
        );
        Object.assign(timeoutError, { cause: { streamId, eventCount, recoverable: true, type: 'absolute' } });
        onDone(timeoutError, false);
      }
    }, ABSOLUTE_TIMEOUT_MS);

    // 处理中止信号
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          console.log(`[executeStream] abort 信号触发 streamId=${streamId} done=${done}`);
          if (!done) {
            done = true;
            cleanup();
            onDone(null, true);
          }
        },
        { once: true }
      );
    }

    // 3. 先注册监听器（关键：在 invoke 前注册，消除竞态）
    console.log(`[executeStream] 注册监听器（invoke 前）: doneEvent=${doneEventName}, streamEvent=${streamEventName}`);

    unlistenDone = await listen<{ done: boolean }>(
      doneEventName,
      () => {
        console.log(`[executeStream] 收到 done 事件 streamId=${streamId}, 共接收 ${eventCount} 个流事件`);
        if (!done) {
          done = true;
          cleanup();
          onDone(null);
        }
      }
    );

    // 监听 Tauri 流式事件
    unlisten = await listen<StreamEventPayload>(
      streamEventName,
      (event) => {
        if (done) return;
        eventCount++;
        resetIdleTimeout(); // 收到事件，重置空闲超时
        const data = event.payload;
        console.log(`[executeStream] 收到流事件 #${eventCount} streamId=${streamId} type=${data.type}`);

        // 先调用完整事件回调（新增）
        if (callbacks.onEvent) {
          // 添加日志：特别关注可能触发权限请求的工具
          if (data.type === 'tool_use') {
            const toolData = data as { type: 'tool_use'; name: string };
            console.warn(`[executeStream] tool_use 事件: name=${toolData.name}, agentId=${agentId}`);
          }
          callbacks.onEvent(data);
        }

        // 将流式事件分发到 RuntimePanel store
        runtimePanelStore.getState().pushStreamEvent(data);

        // 自动展开面板（仅在折叠状态且当前在 agents 页时）
        const appState = useAppStore.getState();
        if (appState.runtimePanelCollapsed && appState.activeNav === 'agents') {
          appState.showRuntimePanel();
        }

        if (data.type === "text" && "content" in data) {
          // 文本块回调（向后兼容，仅处理非 thinking 的文本）
          onChunk((data as { type: "text"; content: string; isThinking?: boolean }).content);
        } else if (data.type === "error") {
          // 流错误（$/streamError 通道推送）
          done = true;
          cleanup();
          const errorData = data as { type: "error"; message?: string; code?: string };
          const errorCode = errorData.code ?? 'UNKNOWN';
          const errorMsg = errorData.message ?? "Stream error";
          const fullMsg = errorCode !== 'UNKNOWN' ? `[${errorCode}] ${errorMsg}` : errorMsg;
          onDone(new Error(fullMsg));
        }
        // 注：Rust ipc_bridge 的 $/complete 只关闭 mpsc channel，不会 push type=complete 事件
        // 流完成信号由 agent:stream:{streamId}:done 事件处理
      }
    );

    // 4. 监听器已就位，最后才 invoke（此时任何推送的事件都不会丢失）
    console.warn(`[executeStream] 即将调用 agent_execute, streamId=${streamId}, agentId=${agentId}`);
    await safeInvoke<void>("agent_execute", {
      content,
      options: execOptions,
    });

    console.log(`[executeStream] invoke 完成, streamId=${streamId}, sessionId=${sessionId}, agentId=${agentId}`);

  } catch (e) {
    onDone(e instanceof Error ? e : new Error(String(e)));
  }
}

// -------- 状态/健康 --------

// ─── StatsResult 类型定义（与后端 sessionHandler.ts 完全对应）─────────────────

export interface ModelUsageEntry {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
}

export interface MemoryUsage {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

export interface StatsResult {
  // LLM 成本
  totalCostUsd: number;
  modelUsage: Record<string, ModelUsageEntry>;
  // Token 统计
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  // 性能耗时
  apiDurationMs: number;
  apiDurationWithoutRetriesMs: number;
  toolDurationMs: number;
  // 代码变更
  linesAdded: number;
  linesRemoved: number;
  // 会话
  totalSessions: number;
  activeSession: boolean;
  uptime: number;
  // 系统
  memoryUsage: MemoryUsage;
}

/** 单条会话成本记录 */
export interface SessionCostRecord {
  sessionId: string
  timestamp: number
  date: string
  week: string
  month: string
  costUSD: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  linesAdded: number
  linesRemoved: number
  durationMs: number
  modelUsage: Record<string, { inputTokens: number; outputTokens: number; costUSD: number }>
}

/** 按时间段聚合的统计 */
export interface PeriodStats {
  costUSD: number
  inputTokens: number
  outputTokens: number
  sessions: number
}

/** 成本历史查询结果 */
export interface CostHistoryResult {
  history: SessionCostRecord[]
  byMonth: Record<string, PeriodStats>
  byWeek: Record<string, PeriodStats>
}

/**
 * 获取成本历史记录（按月/按周聚合）
 */
export async function getCostHistory(): Promise<CostHistoryResult> {
  return retryableInvoke<CostHistoryResult>("agent_send_request", {
    method: "getCostHistory",
    params: {},
  });
}

/**
 * 获取 Agent 统计信息
 */
export async function getStats(): Promise<StatsResult> {
  return retryableInvoke<StatsResult>("agent_send_request", {
    method: "getStats",
    params: {},
  });
}

/**
 * 获取 Agent 状态信息
 * @deprecated This method is not connected to the backend. Will be removed in future versions.
 */
export async function getStatus(): Promise<Record<string, unknown>> {
  return retryableInvoke<Record<string, unknown>>("agent_send_request", {
    method: "getStatus",
    params: {},
  });
}

/**
 * 检查 Agent 是否正在运行
 */
export async function getHealth(): Promise<boolean> {
  return safeInvoke<boolean>("agent_is_running");
}

/**
 * 获取所有正在运行的 Agent ID 列表
 */
export async function getRunningAgents(): Promise<string[]> {
  return (await safeInvoke<string[]>("agent_get_running")) ?? [];
}

// -------- Session API --------


/**
 * 获取会话列表
 * @param params.agentId - 目标 Agent 实例 ID，用于路由到对应 Sidecar（默认 "main"）
 * @param params.cwd - 工作目录，用于过滤该目录下的会话
 */
export async function getSessions(params?: {
  agent_id?: string;
  cwd?: string;
  limit?: number;
  /** 是否包含系统会话（Heartbeat/Cron）。默认 false */
  include_system?: boolean;
}): Promise<SessionItem[]> {
  // 将 agent_id 提升为 agentId 传给 Rust 层，用于路由到正确 sidecar
  const { agent_id, ...rpcParams } = params ?? {};
  const agentId = agent_id ?? "main";
  try {
    // 非 main agent 使用 safeInvoke（不重试），避免等待 SIDECAR_NOT_RUNNING 重试延迟
    const invoker = agentId === "main" ? retryableInvoke : safeInvoke;
    return await invoker<SessionItem[]>("agent_send_request", {
      agentId,
      method: "getSessions",
      params: rpcParams,
    });
  } catch (e) {
    // 非 main agent 的 sidecar 可能尚未启动，优雅降级返回空数组
    const msg = e instanceof Error ? e.message : String(e);
    if (agentId !== "main" && msg.includes("SIDECAR_NOT_RUNNING")) {
      console.debug(`[getSessions] agent=${agentId} sidecar 未启动，返回空会话列表`);
      return [];
    }
    throw e;
  }
}

/**
 * 获取会话消息列表
 * @param sessionId - 会话 ID
 * @param agentId - Agent 实例 ID（默认为 "main"），用于路由到正确的 Sidecar
 * @param opts - 分页选项和 cwd
 */
export async function getSessionMessages(
  sessionId: string,
  agentId?: string,
  opts?: { offset?: number; limit?: number; cwd?: string }
): Promise<SessionMessage[]> {
  return retryableInvoke<SessionMessage[]>("agent_send_request", {
    agentId: agentId ?? "main",
    method: "getSessionMessages",
    params: { sessionId, ...(opts ?? {}) },
  });
}

/**
 * 删除会话
 * @param sessionId - 会话 ID
 * @param agentId - Agent 实例 ID（默认为 "main"），用于路由到正确的 Sidecar
 */
export async function deleteSession(
  sessionId: string,
  agentId?: string
): Promise<void> {
  return retryableInvoke<void>("agent_send_request", {
    agentId: agentId ?? "main",
    method: "deleteSession",
    params: { sessionId },
  });
}

// -------- Checkpoints API --------


/**
 * 获取检查点列表
 * @param params - 查询参数
 * @param agentId - Agent 实例 ID（默认为 "main"），用于路由到正确的 Sidecar
 */
export async function listCheckpoints(
  params: {
    sessionId: string;
    limit?: number;
    offset?: number;
  },
  agentId?: string
): Promise<CheckpointListItem[]> {
  return retryableInvoke<CheckpointListItem[]>("agent_send_request", {
    agentId: agentId ?? "main",
    method: "listCheckpoints",
    params,
  });
}

/**
 * 保存检查点
 * @param params - 保存参数
 * @param agentId - Agent 实例 ID（默认为 "main"），用于路由到正确的 Sidecar
 */
export async function saveCheckpoint(
  params: {
    sessionId: string;
    tag: string;
    comment?: string;
  },
  agentId?: string
): Promise<SaveCheckpointResult> {
  return retryableInvoke<SaveCheckpointResult>("agent_send_request", {
    agentId: agentId ?? "main",
    method: "saveCheckpoint",
    params,
  });
}

/**
 * 回滚到指定检查点
 * @param params - 回滚参数
 * @param agentId - Agent 实例 ID（默认为 "main"），用于路由到正确的 Sidecar
 */
export async function rollbackCheckpoint(
  params: {
    sessionId: string;
    checkpointId: string;
  },
  agentId?: string
): Promise<RollbackCheckpointResult> {
  return retryableInvoke<RollbackCheckpointResult>("agent_send_request", {
    agentId: agentId ?? "main",
    method: "rollbackCheckpoint",
    params,
  });
}

/**
 * 对比两个检查点
 * @param params - 对比参数
 * @param agentId - Agent 实例 ID（默认为 "main"），用于路由到正确的 Sidecar
 */
export async function compareCheckpoints(
  params: {
    sessionId: string;
    checkpointIdA: string;
    checkpointIdB: string;
  },
  agentId?: string
): Promise<CompareCheckpointsResult> {
  return retryableInvoke<CompareCheckpointsResult>("agent_send_request", {
    agentId: agentId ?? "main",
    method: "compareCheckpoints",
    params,
  });
}

/**
 * 获取检查点时间线
 * @param params - 查询参数
 * @param agentId - Agent 实例 ID（默认为 "main"），用于路由到正确的 Sidecar
 */
export async function getCheckpointTimeline(
  params: {
    sessionId: string;
    limit?: number;
    offset?: number;
  },
  agentId?: string
): Promise<CheckpointTimelineResult> {
  return retryableInvoke<CheckpointTimelineResult>("agent_send_request", {
    agentId: agentId ?? "main",
    method: "getCheckpointTimeline",
    params,
  });
}

/**
 * 导出检查点
 * @param params - 导出参数
 * @param agentId - Agent 实例 ID（默认为 "main"），用于路由到正确的 Sidecar
 */
export async function exportCheckpoint(
  params: {
    sessionId: string;
    checkpointId: string;
  },
  agentId?: string
): Promise<ExportCheckpointResult> {
  return retryableInvoke<ExportCheckpointResult>("agent_send_request", {
    agentId: agentId ?? "main",
    method: "exportCheckpoint",
    params,
  });
}

/**
 * 导入检查点
 * @param params - 导入参数
 * @param agentId - Agent 实例 ID（默认为 "main"），用于路由到正确的 Sidecar
 */
export async function importCheckpoint(
  params: {
    jsonData: string;
  },
  agentId?: string
): Promise<ImportCheckpointResult> {
  return retryableInvoke<ImportCheckpointResult>("agent_send_request", {
    agentId: agentId ?? "main",
    method: "importCheckpoint",
    params,
  });
}

/**
 * 批量删除检查点
 * @param params - 删除参数
 * @param agentId - Agent 实例 ID（默认为 "main"），用于路由到正确的 Sidecar
 */
export async function batchDeleteCheckpoints(
  params: {
    sessionId: string;
    checkpointIds: string[];
  },
  agentId?: string
): Promise<BatchDeleteCheckpointResult[]> {
  return retryableInvoke<BatchDeleteCheckpointResult[]>("agent_send_request", {
    agentId: agentId ?? "main",
    method: "batchDeleteCheckpoints",
    params,
  });
}

export type CheckpointEventsOptions = {
  /** 仅接收该会话相关事件；不传则接收全部 checkpoint 事件 */
  sessionId?: string;
  /** Agent 实例 ID，默认为 "main" */
  agentId?: string;
  signal: AbortSignal;
  onEvent?: (payload: unknown) => void;
};

/**
 * 订阅检查点事件流，通过 Tauri listen 接收后端推送的 checkpoint 事件
 */
export async function subscribeCheckpointEvents(
  opts: CheckpointEventsOptions
): Promise<void> {
  // Phase 0: 使用 buildAgentEventName 构建带命名空间的事件名
  const baseEvent = opts.sessionId
    ? `checkpoint:events:${opts.sessionId}`
    : "checkpoint:events";
  const eventName = buildAgentEventName(opts.agentId, baseEvent);

  // 注意: signal 已中止则不起动监听
  if (opts.signal.aborted) return;

  let unlisten: UnlistenFn | null = null;
  let aborted = false;

  const cleanup = () => {
    aborted = true;
    unlisten?.();
    unlisten = null;
  };

  // 提前注册 abort 监听器，确保就算 listen() 还未完成也能正确 cleanup
  opts.signal.addEventListener("abort", cleanup, { once: true });

  unlisten = await listen<unknown>(eventName, (event) => {
    if (opts.onEvent) {
      opts.onEvent(event.payload);
    }
  });

  // listen 完成后，如果 abort 已经触发，立即清理
  if (aborted) {
    unlisten();
    unlisten = null;
    return;
  }

  // 返回后保持监听，直到 signal 中止
  return new Promise<void>((resolve) => {
    opts.signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

// -------- Cron API --------


/**
 * 获取定时任务列表
 */
export async function getCronJobs(): Promise<CronJob[]> {
  return retryableInvoke<CronJob[]>("agent_send_request", {
    method: "getCronJobs",
    params: {},
  });
}

/**
 * 添加定时任务
 */
export async function addCronJob(params: {
  name: string;
  schedule: string;
  schedule_type?: "cron" | "at" | "every";
  instruction: string;
  enabled?: boolean;
}): Promise<{ job_id: string }> {
  return retryableInvoke<{ job_id: string }>("agent_send_request", {
    method: "addCronJob",
    params,
  });
}

/**
 * 更新定时任务
 */
export async function updateCronJob(
  id: string,
  params: {
    name?: string;
    schedule?: string;
    schedule_type?: "cron" | "at" | "every";
    instruction?: string;
    enabled?: boolean;
  }
): Promise<void> {
  return retryableInvoke<void>("agent_send_request", {
    method: "updateCronJob",
    params: { id, ...params },
  });
}

/**
 * 删除定时任务
 */
export async function deleteCronJob(id: string): Promise<void> {
  return retryableInvoke<void>("agent_send_request", {
    method: "deleteCronJob",
    params: { id },
  });
}

/**
 * 立即运行定时任务
 */
export async function runCronJob(id: string): Promise<void> {
  return retryableInvoke<void>("agent_send_request", {
    method: "runCronJob",
    params: { id },
  });
}

/**
 * 获取定时任务执行历史
 */
export async function getCronHistory(id: string): Promise<CronHistoryItem[]> {
  return retryableInvoke<CronHistoryItem[]>("agent_send_request", {
    method: "getCronHistory",
    params: { id },
  });
}

// -------- Agents API --------

/** GET 返回的 topology 多为 Rust Debug（如 ReAct），转为 API 可写回的值 */
export function normalizeAgentTopology(raw: string | undefined): AgentTopologyOption {
  if (!raw) return "react";
  const s = raw.trim().toLowerCase();
  if (s.includes("dag")) return "dag";
  if (s.includes("linear")) return "linear";
  return "react";
}

/**
 * 获取 Agent 列表
 */
export async function getAgents(): Promise<AgentInfo[]> {
  return retryableInvoke<AgentInfo[]>("agent_send_request", {
    agentId: "main",  // Agent 定义是全局的，始终从 main sidecar 获取
    method: "getAgents",
    params: {},
  });
}

/**
 * 获取所有 agent 的 teammate 未读消息数量
 */
export async function getUnreadCounts(): Promise<Record<string, number>> {
  return retryableInvoke<Record<string, number>>("agent_send_request", {
    method: "getUnreadCounts",
    params: {},
  });
}

/**
 * 获取单个 Agent 详情
 */
export async function getAgent(name: string): Promise<AgentDetail> {
  return retryableInvoke<AgentDetail>("agent_send_request", {
    method: "getAgent",
    params: { name },
  });
}

/**
 * 创建 Agent
 */
export async function createAgent(params: {
  name: string;
  soul?: string;
  description?: string;
  skills?: string[];
  handoffs?: string[];
}): Promise<{ name: string }> {
  return retryableInvoke<{ name: string }>("agent_send_request", {
    method: "createAgent",
    params,
  });
}

/**
 * 更新 Agent 配置
 */
export async function updateAgent(
  name: string,
  params: Partial<
    Pick<
      AgentDetail,
      | "soul"
      | "description"
      | "skills"
      | "handoffs"
      | "model"
      | "max_iterations"
      | "topology"
    >
  >
): Promise<void> {
  return retryableInvoke<void>("agent_send_request", {
    method: "updateAgent",
    params: { name, ...params },
  });
}

/**
 * 删除 Agent
 */
export async function deleteAgent(name: string): Promise<void> {
  return retryableInvoke<void>("agent_send_request", {
    method: "deleteAgent",
    params: { name },
  });
}

// -------- Agent Memory API --------

/**
 * 获取 Agent 记忆统计
 */
export async function getAgentMemoryStats(
  name: string
): Promise<AgentMemoryStatsResult> {
  return retryableInvoke<AgentMemoryStatsResult>("agent_send_request", {
    method: "getAgentMemoryStats",
    params: { name },
  });
}

/**
 * 搜索 Agent 记忆
 */
export async function searchAgentMemory(
  name: string,
  params: { q: string; limit?: number }
): Promise<{ agent: string; query: string; results: AgentMemoryEntry[] }> {
  return retryableInvoke<{ agent: string; query: string; results: AgentMemoryEntry[] }>(
    "agent_send_request",
    {
      method: "searchAgentMemory",
      params: { name, ...params },
    }
  );
}

/**
 * 获取 Agent 最近记忆
 */
export async function getAgentMemoryRecent(
  name: string,
  params?: { limit?: number }
): Promise<{ agent: string; results: AgentMemoryEntry[] }> {
  return retryableInvoke<{ agent: string; results: AgentMemoryEntry[] }>(
    "agent_send_request",
    {
      method: "getAgentMemoryRecent",
      params: { name, ...(params ?? {}) },
    }
  );
}

/**
 * 清除 Agent 全部记忆
 */
export async function clearAgentMemory(name: string): Promise<void> {
  return retryableInvoke<void>("agent_send_request", {
    method: "clearAgentMemory",
    params: { name },
  });
}

/**
 * 确保指定 Agent 已启动（幂等）
 */
export async function ensureAgent(agentId: string, cwd: string): Promise<void> {
  await retryableInvoke<void>("agent_ensure", { agentId, cwd }, {
    maxRetries: 2,       // 最多重试 2 次（共 3 次尝试）
    baseDelayMs: 1000,   // 首次重试等 1 秒
    maxDelayMs: 3000,    // 最长等 3 秒
  });
}

/**
 * 停止指定 Agent
 */
export async function stopAgent(agentId: string): Promise<void> {
  await safeInvoke<void>("agent_stop", { agentId });
}

// -------- Skills API --------

/**
 * 获取技能列表
 */
export async function getSkills(): Promise<SkillInfo[]> {
  return retryableInvoke<SkillInfo[]>("agent_send_request", {
    method: "getSkills",
    params: {},
  });
}

/**
 * 获取单个技能详情
 */
export async function getSkill(name: string): Promise<SkillDetail> {
  return retryableInvoke<SkillDetail>("agent_send_request", {
    method: "getSkill",
    params: { name },
  });
}

/**
 * 搜索远程技能市场
 */
export async function searchRemoteSkills(params: {
  q: string;
  limit?: number;
  source?: string;
}): Promise<RemoteSkillItem[]> {
  return retryableInvoke<RemoteSkillItem[]>("agent_send_request", {
    method: "searchRemoteSkills",
    params,
  });
}

/**
 * 创建新技能
 */
export async function createSkill(params: {
  name: string;
  description?: string;
  category?: string;
  guidance?: string;
  trigger_patterns?: string[];
  suggested_tools?: string[];
}): Promise<SkillInfo> {
  return retryableInvoke<SkillInfo>("agent_send_request", {
    method: "createSkill",
    params,
  });
}

/**
 * 从远程安装技能
 */
export async function installSkill(params: {
  skill_id: string;
  source?: string;
}): Promise<SkillInfo> {
  return retryableInvoke<SkillInfo>("agent_send_request", {
    method: "installSkill",
    params,
  });
}

/**
 * 更新技能配置
 */
export async function updateSkill(
  name: string,
  params: {
    description?: string;
    category?: string;
    guidance?: string;
    trigger_patterns?: string[];
    suggested_tools?: string[];
    suggested_action?: string;
  }
): Promise<SkillDetail> {
  return retryableInvoke<SkillDetail>("agent_send_request", {
    method: "updateSkill",
    params: { name, ...params },
  });
}

/**
 * 删除技能
 */
export async function deleteSkill(name: string): Promise<void> {
  return retryableInvoke<void>("agent_send_request", {
    method: "deleteSkill",
    params: { name },
  });
}

// -------- 工具 / 健康检查 / 中止 --------

/**
 * 获取所有可用工具列表
 */
export async function listTools(): Promise<ToolDefinition[]> {
  const result = await retryableInvoke<{ tools: ToolDefinition[] }>("agent_send_request", {
    method: "listTools",
    params: {},
  });
  return result.tools;
}

/**
 * 中止当前执行（不指定 executeId 则中止所有）
 */
export async function abortExecution(executeId?: string): Promise<{
  aborted: boolean;
  executeId?: string;
  count?: number;
}> {
  return retryableInvoke<{ aborted: boolean; executeId?: string; count?: number }>(
    "agent_send_request",
    {
      method: "abort",
      params: executeId ? { executeId } : {},
    }
  );
}

/**
 * 健康检查（心跳）
 */
export async function ping(): Promise<{ status: string; timestamp: number }> {
  return retryableInvoke<{ status: string; timestamp: number }>("agent_send_request", {
    method: "ping",
    params: {},
  });
}

// -------- MCP API --------

/**
 * 列出已配置的 MCP 服务器及其状态
 */
export async function listMcpServers(): Promise<{ servers: Array<{ name: string; uri: string; status: string; tools?: string[] }> }> {
  return retryableInvoke<{ servers: Array<{ name: string; uri: string; status: string; tools?: string[] }> }>("agent_send_request", {
    method: "listMcpServers",
    params: {},
  });
}

/**
 * 获取 MCP 连接状态汇总
 */
export async function getMcpStatus(): Promise<{ connected: number; total: number; servers: Array<{ name: string; uri: string; status: string }> }> {
  return retryableInvoke<{ connected: number; total: number; servers: Array<{ name: string; uri: string; status: string }> }>("agent_send_request", {
    method: "getMcpStatus",
    params: {},
  });
}

/**
 * 连接到新的 MCP 服务器（框架 - 尚未完整实现）
 */
export async function connectMcpServer(name: string, uri: string): Promise<{ success: boolean; error?: string }> {
  return retryableInvoke<{ success: boolean; error?: string }>("agent_send_request", {
    method: "connectMcpServer",
    params: { name, uri },
  });
}

/**
 * 断开 MCP 服务器连接（框架 - 尚未完整实现）
 */
export async function disconnectMcpServer(name: string): Promise<{ success: boolean; error?: string }> {
  return retryableInvoke<{ success: boolean; error?: string }>("agent_send_request", {
    method: "disconnectMcpServer",
    params: { name },
  });
}

// -------- Claude 配置文件管理 --------

/**
 * 读取 Claude 配置文件 (config.toml / exec-approvals.json)
 * 通过 Rust 后端读取,避免前端直接操作文件系统
 */
export async function getClaudeConfig(configName: "config" | "approvals"): Promise<string> {
  return safeInvoke<string>("get_claude_config", { config_name: configName });
}

/**
 * 写入 Claude 配置文件 (config.toml / exec-approvals.json)
 * 通过 Rust 后端写入,确保目录存在并统一错误处理
 */
export async function saveClaudeConfig(
  configName: "config" | "approvals",
  content: string
): Promise<void> {
  await safeInvoke("save_claude_config", {
    config_name: configName,
    content,
  });
}

// -------- Cron 完成事件 --------

/** Cron 任务完成后 Tauri 发出的事件 payload */
export interface CronCompleteEvent {
  type: "job_complete";
  jobId: string;
  jobName: string;
  success: boolean;
  output: string;
  error?: string | null;
  duration_ms: number;
  timestamp: number;
}

/**
 * 监听 Cron 任务完成事件 (`agent:{agentId}:cron-complete`)
 * 返回 unlisten 函数，组件卸载时应调用以清理监听器
 * @param callback - 事件回调函数
 * @param agentId - Agent 实例 ID，默认为 "main"
 */
export async function listenCronComplete(
  callback: (payload: CronCompleteEvent) => void,
  agentId?: string,
): Promise<UnlistenFn> {
  const eventName = buildAgentEventName(agentId, "cron-complete");
  return listen<CronCompleteEvent>(eventName, (event) => {
    callback(event.payload);
  });
}
