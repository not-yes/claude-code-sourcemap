import { useVirtualizer } from "@tanstack/react-virtual";
import {
  executeStream,
  getSessionMessages,
  getSessions,
  abortExecution,
  buildAgentEventName,
  ensureAgent,
  type SessionMessage,
} from "@/api/tauri-api";
import { MessageBubble } from "./MessageBubble";
import { InputArea } from "./InputArea";
import { PermissionDialog } from "./PermissionDialog";
import { AskUserQuestionDialog } from "./AskUserQuestionDialog";
import { PlanApprovalDialog } from "./PlanApprovalDialog";
import { ConversationHistorySheet } from "./ConversationHistorySheet";
import { CheckpointSheet } from "./CheckpointSheet";
import {
  loadMessages,
  loadMessagesPaginated,
  getTotalMessageCount,
  saveMessages,
  clearMessages,
  MAX_MESSAGES_IN_MEMORY,
  MAX_MESSAGE_SIZE,
  MAX_RESPONSE_SIZE,
  MAX_CONTENT_BLOCKS,
  PAGE_SIZE,
  touchSession,
  cleanupOldSessions,
  getLocalStorageUsagePercent,
} from "@/lib/conversationStorage";
import {
  loadPersistedBackendSession,
  savePersistedBackendSession,
} from "@/lib/backendSessionStorage";
import type { Message, MessageContentBlock, TokenUsage } from "@/types";
import { toast } from "sonner";
import { useLogStore } from "@/stores/logStore";
import { useUnreadStore } from "@/stores/unreadStore";
import { useState, useCallback, useEffect, useRef } from "react";
import { CompactingIndicator } from "./CompactingIndicator";
import { StreamingStatus } from "./StreamingStatus";
import {
  Lightbulb,
  FileText,
  BarChart3,
  Sparkles,
  MessageSquarePlus,
  History,
  GitBranch,
  MoreVertical,
  ChevronUp,
  Bot,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { usePermissionStore, type PermissionDecision } from "@/stores/permissionStore";
import { useAgentsStore } from "@/stores/agentsStore";
import { useCronStore } from "@/stores/cronStore";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { WorkingDirectorySelector } from "./WorkingDirectorySelector";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function sessionMessageToMessage(m: SessionMessage, index: number): Message {
  return {
    id: m.id ?? `msg-${index}`,
    role: m.role,
    content: m.content ?? "",
    contentBlocks: m.contentBlocks,
    usage: m.usage,
    createdAt: m.created_at ? new Date(m.created_at) : new Date(),
  };
}

/**
 * 估算文本的 token 数量
 * 考虑中英文差异：
 * - 英文：约 4 字符 ≈ 1 token
 * - 中文：约 1.5 字符 ≈ 1 token
 * - 混合内容：加权平均
 */
function estimateTokenCount(text: string): number {
  if (!text) return 0;
  // 匹配中文字符（Unicode 范围 \u4e00-\u9fa5 是 CJK 基本块）
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const totalChars = text.length;
  const nonChineseChars = totalChars - chineseChars;

  // 中文 token 估算：约 1.5 字符/token
  const chineseTokens = chineseChars / 1.5;
  // 英文 token 估算：约 4 字符/token
  const englishTokens = nonChineseChars / 4;

  return Math.round(chineseTokens + englishTokens);
}

const SUGGESTED_PROMPTS = [
  { icon: Sparkles, label: "你好，请介绍一下你自己", prompt: "你好，请介绍一下你自己" },
  { icon: FileText, label: "总结当前工作区文档", prompt: "总结当前工作区中的文档，列出要点" },
  { icon: BarChart3, label: "生成每日简报", prompt: "生成本日的任务简报，包括待办和已完成事项" },
  { icon: Lightbulb, label: "提供创意建议", prompt: "针对 [主题] 提供 5 个创意建议" },
] as const;

interface ChatAreaProps {
  agentId: string;
}

export function ChatArea({ agentId }: ChatAreaProps) {
  // 全局状态
  const historySheetOpen = useAppStore((s) => s.historySheetOpen);
  const setHistorySheetOpen = useAppStore((s) => s.setHistorySheetOpen);
  const checkpointSheetOpen = useAppStore((s) => s.checkpointSheetOpen);
  const setCheckpointSheetOpen = useAppStore((s) => s.setCheckpointSheetOpen);
  const chatHistoryReloadNonce = useAppStore((s) => s.chatHistoryReloadNonce);
  const bumpChatHistoryReload = useAppStore((s) => s.bumpChatHistoryReload);
  const setChatExecuteLoading = useAppStore((s) => s.setChatExecuteLoading);
  const setChatHeaderAction = useAppStore((s) => s.setChatHeaderAction);
  const sidecarConnected = useAppStore((s) => s.sidecarConnected);
  const agentStartLoading = useAppStore((s) => s.agentStartLoading);
  const setAgentStartLoading = useAppStore((s) => s.setAgentStartLoading);
  useAgentsStore((s) => s.refreshRunningAgents); // keep store connected
  const agentWorkingDirectory = useAppStore((s) => s.agentWorkingDirectory);
  const workingDirectories = useAppStore((s) => s.workingDirectories);
  const setAgentWorkingDirectory = useAppStore((s) => s.setAgentWorkingDirectory);
  
  // 当前 Agent 的工作目录（确保有默认值，避免空字符串导致存储 key 不一致）
  const currentCwd = agentWorkingDirectory[agentId] || workingDirectories[0] || "";
  
  // 初始化：确保工作目录已设置（避免空 cwd 导致存储 key 不一致）
  useEffect(() => {
    if (!agentWorkingDirectory[agentId] && workingDirectories[0]) {
      setAgentWorkingDirectory(agentId, workingDirectories[0]);
    }
  }, [agentId, agentWorkingDirectory, workingDirectories, setAgentWorkingDirectory]);

  // 每个 Agent 独立的 backendSessionId（按工作目录隔离）
  // 初始化为 null，完全依赖 useEffect 加载（避免 Zustand rehydration 异步问题）
  const [activeBackendSessionId, setActiveBackendSessionId] = useState<string | null>(null);

  // 追踪上一次 cwd，用于检测 cwd 变化
  const prevCwdRef = useRef<string | null>(null);

  // 工作目录就绪后（或变化时），重新加载对应的会话
  // 当 currentCwd 从空字符串变为有效值时，此 effect 会触发并正确加载 sessionId
  useEffect(() => {
    if (!currentCwd) return; // cwd 未就绪，跳过

    // 检测 cwd 是否真正发生了变化（不是首次加载）
    const isCwdChanged = prevCwdRef.current !== null && prevCwdRef.current !== currentCwd;

    // 如果切换了目录，清空当前消息（确保新目录使用空白会话）
    if (isCwdChanged) {
      setMessages([]);
      messageOffsetRef.current = PAGE_SIZE;
      backendOffsetRef.current = 0;
      setHasMoreMessages(false);
    }

    prevCwdRef.current = currentCwd;

    const newSessionId = loadPersistedBackendSession(agentId, currentCwd);
    setActiveBackendSessionId(newSessionId);

    // 切换工作目录后必须触发消息重新加载，否则 isInitialLoadRef 为 false 会导致加载 effect 直接跳过
    if (isCwdChanged) {
      bumpChatHistoryReload();
    }

    // 标记当前 agent+cwd 为已读
    useUnreadStore.getState().markAsSeen(agentId, currentCwd);
  }, [agentId, currentCwd, bumpChatHistoryReload]);

  // 权限状态
  const pendingRequest = usePermissionStore((s) => s.pendingRequest);
  const setPendingRequest = usePermissionStore((s) => s.setPendingRequest);
  const addRememberedDecision = usePermissionStore((s) => s.addRememberedDecision);

  // 本地状态
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTruncated, setIsTruncated] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [contextPercent, setContextPercent] = useState<number | undefined>(undefined);
  const [pendingQueue, setPendingQueue] = useState<string[]>([]);
  
  // Refs
  const inFlightRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const responseSizeRef = useRef(0);
  const responseTruncatedRef = useRef(false);
  const messageOffsetRef = useRef(PAGE_SIZE);
  const backendOffsetRef = useRef(0);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const streamMetaRef = useRef<{ startTime: number; tokenEstimate: number; isThinking: boolean }>({
    startTime: 0,
    tokenEstimate: 0,
    isThinking: false,
  });
  const currentAgentIdRef = useRef(agentId);
  currentAgentIdRef.current = agentId;
  const prevAgentIdRef = useRef(agentId);

  // 设置 Header 操作按钮
  useEffect(() => {
    setChatHeaderAction(
      <div className="flex items-center gap-1">
        <WorkingDirectorySelector agentId={agentId} />
        <button
          type="button"
          onClick={() => setHistorySheetOpen(true)}
          title="历史会话"
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-all duration-200 hover:scale-105"
        >
          <History className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleNewChat}
          title="新建对话"
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-all duration-200 hover:scale-105"
        >
          <MessageSquarePlus className="h-4 w-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={!activeBackendSessionId || loading}
              title={
                !activeBackendSessionId
                  ? "需要已绑定后端会话后再使用更多操作"
                  : loading
                  ? "任务进行中，请稍后再操作"
                  : "更多操作"
              }
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-all duration-200 hover:scale-105 disabled:opacity-40 disabled:pointer-events-none"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[10rem]">
            <DropdownMenuItem
              onClick={() => setCheckpointSheetOpen(true)}
              disabled={!activeBackendSessionId || loading}
              className="gap-2"
            >
              <GitBranch className="h-4 w-4" />
              <span>Checkpoint</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
    return () => setChatHeaderAction(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, activeBackendSessionId, loading, setChatHeaderAction, setHistorySheetOpen, setCheckpointSheetOpen]);

  // 加载会话消息
  // 使用 ref 避免在执行过程中因 activeBackendSessionId 变化而覆盖当前消息
  const isInitialLoadRef = useRef(true);

  // Agent 切换时重置状态并触发重新加载
  useEffect(() => {
    if (prevAgentIdRef.current === agentId) return;

    // 停止当前正在执行的任务
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // 清除待执行的保存，防止保存到错误的 agent key
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = null;
    }
    inFlightRef.current = false;
    setLoading(false);

    // 重置状态
    setMessages([]);
    setPendingQueue([]);
    setPendingRequest(null);
    setActiveBackendSessionId(null);
    setIsTruncated(false);
    setHasMoreMessages(false);
    setCompacting(false);
    setContextPercent(undefined);
    messageOffsetRef.current = PAGE_SIZE;
    backendOffsetRef.current = 0;

    // 触发重新加载
    isInitialLoadRef.current = true;
    prevAgentIdRef.current = agentId;
  }, [agentId, setPendingRequest]);

  useEffect(() => {
    // 只在首次挂载、显式 reload 或 agent 切换时加载
    // 执行过程中 complete 事件会修改 activeBackendSessionId，此时不应重新加载
    if (!isInitialLoadRef.current && !chatHistoryReloadNonce) {
      return;
    }
    isInitialLoadRef.current = false;

    // 确定消息存储使用的 key：优先使用 activeBackendSessionId（从历史会话选择），
    // 无则使用 agentId（本地新建会话）
    const messageKey = activeBackendSessionId || agentId;

    // 优先从本地加载（包含完整 contentBlocks 的消息）
    const localTotal = getTotalMessageCount(messageKey, currentCwd);
    const localMessages = loadMessagesPaginated(messageKey, 0, PAGE_SIZE, currentCwd);

    // 判断本地最后一条 assistant 消息是否已完成（有 usage 表示已收到 complete 事件）
    const lastAssistant = localMessages.length > 0
      ? [...localMessages].reverse().find((m) => m.role === 'assistant')
      : undefined;
    const localIncomplete = !!lastAssistant && lastAssistant.usage === undefined;

    const applyLocalMessages = () => {
      setMessages(localMessages);
      setIsTruncated(false);
      setHasMoreMessages(localTotal > PAGE_SIZE);
      messageOffsetRef.current = PAGE_SIZE;
      backendOffsetRef.current = 0;
    };

    const loadFromBackend = async (sessionId: string) => {
      setLoadingHistory(true);
      try {
        const fullList = await getSessionMessages(sessionId, agentId, { limit: PAGE_SIZE * 10, cwd: currentCwd });
        const total = fullList.length;
        let converted: Message[];
        if (total <= PAGE_SIZE) {
          converted = fullList.map((m, i) => sessionMessageToMessage(m, i));
          setMessages(converted);
          setIsTruncated(false);
          setHasMoreMessages(false);
          backendOffsetRef.current = 0;
        } else {
          const startOffset = total - PAGE_SIZE;
          const latest = await getSessionMessages(sessionId, agentId, { offset: startOffset, limit: PAGE_SIZE, cwd: currentCwd });
          converted = latest.map((m, i) => sessionMessageToMessage(m, startOffset + i));
          setMessages(converted.length > MAX_MESSAGES_IN_MEMORY ? converted.slice(-MAX_MESSAGES_IN_MEMORY) : converted);
          setIsTruncated(converted.length > MAX_MESSAGES_IN_MEMORY);
          setHasMoreMessages(startOffset > 0);
          backendOffsetRef.current = startOffset;
        }
        // 同时保存到本地（使用 session ID 作为 key）
        saveMessages(sessionId, fullList.map((m, i) => sessionMessageToMessage(m, i)), currentCwd);
        // 同步 backendSessionId
        savePersistedBackendSession(agentId, sessionId, currentCwd);
        setActiveBackendSessionId(sessionId);
      } catch (err) {
        console.warn('[ChatArea] 从后端加载消息失败:', err);
        applyLocalMessages();
      } finally {
        setLoadingHistory(false);
      }
    };

    if (activeBackendSessionId && (localIncomplete || localMessages.length === 0)) {
      // 本地消息未完成或为空，从后端同步最新状态
      void loadFromBackend(activeBackendSessionId);
    } else if (!activeBackendSessionId && localIncomplete) {
      // 本地有未完成消息但没有 backendSessionId，尝试查找最新会话
      getSessions({ agent_id: agentId, cwd: currentCwd, limit: 1 })
        .then((sessions) => {
          if (sessions.length > 0) {
            void loadFromBackend(sessions[0].id);
          } else {
            applyLocalMessages();
          }
        })
        .catch((err) => {
          console.warn('[ChatArea] 查找最新会话失败:', err);
          applyLocalMessages();
        });
    } else if (localMessages.length > 0) {
      // 本地有已完成消息，直接使用（包括 contentBlocks/thinking/tool 信息）
      applyLocalMessages();

      // 仅做后端会话健康检查（不覆盖本地消息）
      if (activeBackendSessionId) {
        getSessionMessages(activeBackendSessionId, agentId, { limit: 1, cwd: currentCwd })
          .catch(() => {
            // 后端会话已失效，清空绑定
            savePersistedBackendSession(agentId, null, currentCwd);
            setActiveBackendSessionId(null);
          });
      }
    } else {
      // 空会话
      setMessages([]);
      setIsTruncated(false);
      setHasMoreMessages(false);
      messageOffsetRef.current = PAGE_SIZE;
      backendOffsetRef.current = 0;
    }
  }, [activeBackendSessionId, agentId, chatHistoryReloadNonce, currentCwd]);

  // 设置 loading 状态
  useEffect(() => {
    setChatExecuteLoading(loading);
    return () => setChatExecuteLoading(false);
  }, [loading, setChatExecuteLoading]);

  // 权限监听
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let unmounted = false;

    if (typeof window === 'undefined' || !('__TAURI__' in window)) {
      return;
    }

    const eventName = buildAgentEventName(agentId, "permission-request");
    listen(eventName, (event) => {
      const req = event.payload as Parameters<typeof setPendingRequest>[0];
      console.warn(`[ChatArea:permission] 收到权限请求: tool=${req?.tool}, requestId=${req?.requestId}, agentId=${agentId}`);
      if (!req) return;

      const remembered = usePermissionStore.getState().getRememberedDecision(req.tool);
      // ExitPlanMode 和 AskUserQuestion 每次都需要用户确认，不使用记住的决策
      if (remembered !== undefined && req.tool !== "ExitPlanMode" && req.tool !== "AskUserQuestion") {
        invoke("agent_permission_response", {
          requestId: req.requestId,
          decision: { granted: remembered },
          agentId: agentId,
        }).catch(() => {});
        return;
      }

      setPendingRequest(req);
    }).then((fn) => {
      if (!unmounted) {
        unlisten = fn;
      }
    });

    return () => {
      unmounted = true;
      unlisten?.();
    };
  }, [agentId, setPendingRequest]);

  // Compacting 状态监听
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let unmounted = false;

    if (typeof window === 'undefined' || !('__TAURI__' in window)) {
      return;
    }

    const eventName = buildAgentEventName(agentId, "compacting");
    listen<{ contextPercent: number }>(eventName, (event) => {
      if (unmounted) return;
      const { contextPercent } = event.payload;
      setContextPercent(contextPercent);
      setCompacting(true);
    }).then((fn) => {
      if (!unmounted) {
        unlisten = fn;
      }
    });

    return () => {
      unmounted = true;
      unlisten?.();
    };
  }, [agentId]);

  // Compacting 完成监听
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let unmounted = false;

    if (typeof window === 'undefined' || !('__TAURI__' in window)) {
      return;
    }

    const eventName = buildAgentEventName(agentId, "compacting-complete");
    listen(eventName, () => {
      if (unmounted) return;
      setCompacting(false);
      // 不清除 contextPercent，保留最后一个值作为常驻显示
    }).then((fn) => {
      if (!unmounted) {
        unlisten = fn;
      }
    });

    return () => {
      unmounted = true;
      unlisten?.();
    };
  }, [agentId]);

  // 启动 Agent
  useEffect(() => {
    setCheckpointSheetOpen(false);
    messageOffsetRef.current = PAGE_SIZE;
    backendOffsetRef.current = 0;
    setHasMoreMessages(false);
    if (currentCwd) {
      touchSession(agentId, currentCwd);
    }

    if (getLocalStorageUsagePercent() > 80) {
      cleanupOldSessions(10);
    }

    if (!sidecarConnected) {
      return;
    }

    // Agent 启动逻辑在 WorkingDirectorySelector 中处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, sidecarConnected, setCheckpointSheetOpen]);

  // Ref 保存最新状态和消息，用于卸载时保存（避免闭包陷阱）
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const activeBackendSessionIdRef = useRef(activeBackendSessionId);
  activeBackendSessionIdRef.current = activeBackendSessionId;
  const currentCwdRef = useRef(currentCwd);
  currentCwdRef.current = currentCwd;
  
  // 组件卸载时立即保存消息（使用 ref 避免闭包陷阱）
  useEffect(() => {
    return () => {
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
      if (messagesRef.current.length > 0) {
        saveMessages(activeBackendSessionIdRef.current || agentId, messagesRef.current, currentCwdRef.current);
      }
    };
  }, [agentId]);

  const handleNewChat = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    savePersistedBackendSession(agentId, null, currentCwd);
    setActiveBackendSessionId(null);
    setMessages([]);
    saveMessages(agentId, [], currentCwd);
    setHasMoreMessages(false);
    messageOffsetRef.current = PAGE_SIZE;
    backendOffsetRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setTimeout(() => {
      if (inFlightRef.current) {
        inFlightRef.current = false;
        setLoading(false);
        abortControllerRef.current = null;
      }
    }, 500);
    abortExecution().catch(() => {});
  }, []);

  const handlePermissionDecision = useCallback((requestId: string, decision: PermissionDecision) => {
    if (decision.remember && pendingRequest) {
      addRememberedDecision(pendingRequest.tool, decision.granted);
    }
    setPendingRequest(null);
    invoke("agent_permission_response", { requestId, decision, agentId }).catch(() => {
      toast.error("权限决策回传失败");
    });
  }, [pendingRequest, setPendingRequest, addRememberedDecision, agentId]);

  const handleSend = useCallback(async (content: string) => {
    if (inFlightRef.current) {
      setPendingQueue(prev => [...prev, content]);
      toast.info(`已加入队列（${pendingQueue.length + 1} 条待发送）`);
      return;
    }
    if (agentStartLoading[agentId]) {
      toast.error("Agent 正在启动中，请稍后再试");
      return;
    }
    if (content.length > MAX_MESSAGE_SIZE) {
      toast.error("消息过长，请缩短后重试");
      return;
    }

    inFlightRef.current = true;
    abortControllerRef.current = new AbortController();
    responseSizeRef.current = 0;
    responseTruncatedRef.current = false;
    streamMetaRef.current = { startTime: Date.now(), tokenEstimate: 0, isThinking: false };

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date(),
    };
    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      contentBlocks: [],
      createdAt: new Date(),
    };

    setMessages((prev) => {
      const next = [...prev, userMsg, assistantMsg];
      const trimmed = next.length > MAX_MESSAGES_IN_MEMORY ? next.slice(-MAX_MESSAGES_IN_MEMORY) : next;
      if (next.length > MAX_MESSAGES_IN_MEMORY) setIsTruncated(true);
      messagesRef.current = trimmed;
      return trimmed;
    });
    // 立即保存用户消息，防止发送后刷新丢失
    saveMessages(activeBackendSessionIdRef.current || agentId, messagesRef.current, currentCwdRef.current);
    setLoading(true);

    // 获取最新 cwd（防止闭包中 currentCwd 为空字符串）
    const latestCwd = currentCwd || useAppStore.getState().agentWorkingDirectory[agentId] || useAppStore.getState().workingDirectories[0] || "";
    if (!latestCwd) {
      toast.error("请先选择工作目录");
      inFlightRef.current = false;
      setLoading(false);
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id && m.id !== assistantMsg.id));
      return;
    }

    const sessionOpts = {
      ...(activeBackendSessionId ? { backendSessionId: activeBackendSessionId } : {}),
      agentId: agentId,
      cwd: latestCwd,
    };

    let streamFinished = false;

    try {
      await executeStream(content, sessionOpts, {
        signal: abortControllerRef.current.signal,
        onChunk: () => {},
        onEvent: (event) => {
          // Agent 已切换，忽略旧 stream 的事件
          if (currentAgentIdRef.current !== agentId) return;

          // 如果之前因超时提前结束，但后续事件仍到达（LLM 只是极慢），复活流式状态
          if (streamFinished) {
            streamFinished = false;
            inFlightRef.current = true;
            setLoading(true);
            // 清除 onDone 可能追加的错误文本
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsg.id) return m;
                const cleanContent = (m.content || '')
                  .replace(/\n\n---\n⚠️ .*/, '')
                  .replace(/^❌ .*/, '');
                return { ...m, content: cleanContent };
              })
            );
          }
          setMessages((prev) => {
            const next = prev.map((m) => {
              if (m.id !== assistantMsg.id) return m;
              const blocks: MessageContentBlock[] = [...(m.contentBlocks || [])];
              let completionUsage: TokenUsage | undefined;

              // 辅助函数：清理临时 heartbeat system block
              const removeHeartbeatBlocks = () => {
                return blocks.filter(b => !(b.type === 'system' && b.content === '正在分析问题，请稍候...'));
              };

              switch (event.type) {
                case 'text': {
                  const textEvent = event as { type: 'text'; content: string; isThinking?: boolean };
                  console.log(`[ChatArea] text event: isThinking=${textEvent.isThinking}, content_len=${textEvent.content?.length || 0}`);
                  if (!responseTruncatedRef.current) {
                    responseSizeRef.current += textEvent.content.length;
                    streamMetaRef.current.tokenEstimate += estimateTokenCount(textEvent.content);
                    streamMetaRef.current.isThinking = !!textEvent.isThinking;
                    if (responseSizeRef.current > MAX_RESPONSE_SIZE) {
                      responseTruncatedRef.current = true;
                      const cleaned = removeHeartbeatBlocks();
                      cleaned.push({ type: 'text', content: '\n\n[内容已截断]' });
                      blocks.length = 0;
                      blocks.push(...cleaned);
                      break;
                    }
                  } else {
                    break;
                  }
                  if (textEvent.isThinking) {
                    if (!textEvent.content) break;
                    const cleaned = removeHeartbeatBlocks();
                    const lastBlock = cleaned.length > 0 ? cleaned[cleaned.length - 1] : null;
                    if (lastBlock && lastBlock.type === 'thinking') {
                      cleaned[cleaned.length - 1] = { ...lastBlock, content: lastBlock.content + textEvent.content };
                    } else {
                      cleaned.push({ type: 'thinking', content: textEvent.content });
                    }
                    // 写回 blocks（通过清空+push 保持引用更新）
                    blocks.length = 0;
                    blocks.push(...cleaned);
                  } else {
                    const cleaned = removeHeartbeatBlocks();
                    const lastBlock = cleaned.length > 0 ? cleaned[cleaned.length - 1] : null;
                    if (lastBlock && lastBlock.type === 'text') {
                      cleaned[cleaned.length - 1] = { ...lastBlock, content: lastBlock.content + textEvent.content };
                    } else {
                      console.log(`[ChatArea] Adding new text block: ${textEvent.content.substring(0, 50)}...`);
                      cleaned.push({ type: 'text', content: textEvent.content });
                    }
                    blocks.length = 0;
                    blocks.push(...cleaned);
                  }
                  break;
                }
                case 'tool_use': {
                  const tuEvent = event as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
                  streamMetaRef.current.isThinking = false;
                  if (blocks.length < MAX_CONTENT_BLOCKS) {
                    const cleaned = removeHeartbeatBlocks();
                    cleaned.push({ type: 'tool_use', id: tuEvent.id, name: tuEvent.name, input: tuEvent.input || {} });
                    blocks.length = 0;
                    blocks.push(...cleaned);
                  }
                  break;
                }
                case 'tool_result': {
                  const trEvent = event as { type: 'tool_result'; id: string; toolName: string; result: unknown; isError?: boolean; filePath?: string };
                  streamMetaRef.current.isThinking = false;
                  if (blocks.length < MAX_CONTENT_BLOCKS) {
                    const cleaned = removeHeartbeatBlocks();
                    cleaned.push({ type: 'tool_result', toolId: trEvent.id, toolName: trEvent.toolName, result: trEvent.result, isError: trEvent.isError, filePath: trEvent.filePath });
                    blocks.length = 0;
                    blocks.push(...cleaned);
                  }
                  break;
                }
                case 'system_message': {
                  const sysEvent = event as { type: 'system_message'; level: 'info' | 'warning' | 'error'; content: string };
                  streamMetaRef.current.isThinking = false;
                  if (sysEvent.content && blocks.length < MAX_CONTENT_BLOCKS) {
                    blocks.push({ type: 'system', level: sysEvent.level, content: sysEvent.content });
                  }
                  break;
                }
                case 'complete': {
                  const completeEvent = event as { type: 'complete'; usage?: TokenUsage; reason?: string; sessionId?: string };
                  streamMetaRef.current.isThinking = false;
                  console.log(`[ChatArea] complete event: reason=${completeEvent.reason}, hasUsage=${!!completeEvent.usage}`);
                  completionUsage = completeEvent.usage;
                  if (completeEvent.sessionId) {
                    // 始终保存 Sidecar 返回的 sessionId（确保与后端同步）
                    const cwdForSave = currentCwd || useAppStore.getState().agentWorkingDirectory[agentId] || useAppStore.getState().workingDirectories[0] || "";
                    if (cwdForSave) {
                      savePersistedBackendSession(agentId, completeEvent.sessionId, cwdForSave);
                    }
                    if (!activeBackendSessionId) {
                      // 【关键修复】首次获得 sessionId 时，将之前以 agentId 为 key 保存的本地消息
                      // 迁移到 sessionId key 下，避免刷新后 key 不匹配导致消息"消失"
                      const oldMessages = loadMessages(agentId, currentCwd);
                      if (oldMessages.length > 0) {
                        saveMessages(completeEvent.sessionId, oldMessages, currentCwd);
                        clearMessages(agentId, currentCwd);
                      }
                      setActiveBackendSessionId(completeEvent.sessionId);
                    }
                  }
                  // 如果本次对话中创建了定时任务，自动刷新 CronPanel 的任务列表
                  const hasCronCreate = messagesRef.current.some(
                    msg => msg.role === 'user' && msg.contentBlocks?.some(
                      b => b.type === 'tool_result' && b.toolName === 'SidecarCronCreate'
                    )
                  );
                  if (hasCronCreate) {
                    useCronStore.getState().reload();
                  }
                  // 完成时移除 heartbeat
                  const cleaned = removeHeartbeatBlocks();
                  blocks.length = 0;
                  blocks.push(...cleaned);
                  // 检查是否有 text 内容，如果没有，添加提示
                  const hasTextBlock = blocks.some(b => b.type === 'text');
                  const hasThinkingBlock = blocks.some(b => b.type === 'thinking');
                  console.log(`[ChatArea] complete check: hasTextBlock=${hasTextBlock}, hasThinkingBlock=${hasThinkingBlock}, totalBlocks=${blocks.length}`);
                  if (!hasTextBlock) {
                    console.warn('[ChatArea] 执行完成但没有文本回复，reason:', completeEvent.reason);
                    blocks.push({ type: 'system', level: 'info', content: `任务执行完成（${completeEvent.reason || '无回复'}）` });
                  }
                  break;
                }
                case 'status': {
                  const statusEvent = event as { type: 'status'; content: string; meta?: { tokens?: number; elapsed?: number; isThinking?: boolean } };
                  console.log(`[ChatArea] status event:`, JSON.stringify(statusEvent));
                  if (statusEvent.content && blocks.length < MAX_CONTENT_BLOCKS) {
                    blocks.push({ type: 'status', content: statusEvent.content, meta: statusEvent.meta });
                  }
                  break;
                }
                case 'error': {
                  const errEvent = event as { type: 'error'; message?: string };
                  streamMetaRef.current.isThinking = false;
                  blocks.push({ type: 'system', level: 'error', content: errEvent.message || '未知错误' });
                  break;
                }
              }

              const textContent = blocks
                .filter(b => b.type === 'text')
                .map(b => (b as { type: 'text'; content: string }).content)
                .join('');

              return { ...m, contentBlocks: blocks, content: textContent, ...(completionUsage ? { usage: completionUsage } : {}) };
            });
            
            // 同步更新 ref，确保 ref 与 state 一致
            messagesRef.current = next;
            
            // 调度保存：完成时立即保存，流式时 500ms 防抖
            if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
            const lastMsg = next[next.length - 1];
            const isCompleted = lastMsg?.role === 'assistant' && lastMsg?.usage !== undefined;
            const delay = isCompleted ? 0 : 500;
            saveDebounceRef.current = setTimeout(() => {
              saveMessages(activeBackendSessionIdRef.current || agentId, messagesRef.current, currentCwdRef.current);
              saveDebounceRef.current = null;
            }, delay);
            
            return next;
          });
        },
        onDone: (error, aborted) => {
          // Agent 已切换，忽略旧 stream 的完成事件
          if (currentAgentIdRef.current !== agentId) return;

          streamFinished = true;
          inFlightRef.current = false;
          setLoading(false);
          abortControllerRef.current = null;
          
          if (aborted) {
            saveMessages(activeBackendSessionIdRef.current || agentId, messagesRef.current, currentCwdRef.current);
            return;
          }
          
          if (error) {
            const errMsg = error.message || "未知错误";
            useLogStore.getState().addError(`execute: ${errMsg}`);
            setMessages((prev) => {
              const next = prev.map((m) => {
                if (m.id !== assistantMsg.id) return m;
                const hasContent = (m.content && m.content.length > 10) || (m.contentBlocks && m.contentBlocks.length > 0);
                if (hasContent) {
                  return { ...m, content: (m.content || '') + `\n\n---\n⚠️ ${errMsg}` };
                } else {
                  return { ...m, content: `❌ ${errMsg}` };
                }
              });
              messagesRef.current = next;
              return next;
            });
            // 错误状态更新后立刻保存
            if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
            saveMessages(activeBackendSessionIdRef.current || agentId, messagesRef.current, currentCwdRef.current);
            toast.error(errMsg);
          } else {
            if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
            saveMessages(activeBackendSessionIdRef.current || agentId, messagesRef.current, currentCwdRef.current);
            toast.success("任务执行完成");
          }
        },
      });
    } catch (e) {
      if (e instanceof Error && e.message === "STREAM_LIMIT_EXCEEDED") {
        toast.error("当前并发请求过多，请稍后再试");
        setMessages((prev) => prev.filter((m) => m.id !== userMsg.id && m.id !== assistantMsg.id));
      }
      inFlightRef.current = false;
      setLoading(false);
      abortControllerRef.current = null;
      if ((e as Error)?.name === "AbortError") return;
      
      const errMsg = e instanceof Error ? e.message || e.name || "未知错误" : String(e ?? "执行失败");
      
      // 检测到 Agent 已停止，尝试自动重启
      if (errMsg.includes("SIDECAR_NOT_RUNNING") || errMsg.includes("channel 已关闭") || errMsg.includes("channel closed")) {
        console.warn(`[ChatArea] Agent ${agentId} 未运行，尝试自动重启...`);
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: "Agent 连接断开，正在重新启动..." } : m))
        );
        
        // 异步重启 agent
        (async () => {
          setAgentStartLoading(agentId, true);
          try {
            await ensureAgent(agentId, currentCwd);
            toast.success("Agent 已重启，请重新发送消息");
            // 移除临时提示消息
            setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id && m.id !== userMsg.id));
          } catch (restartErr) {
            const restartMsg = restartErr instanceof Error ? restartErr.message : String(restartErr);
            console.error(`[ChatArea] Agent ${agentId} 重启失败:`, restartErr);
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: `❌ Agent 重启失败: ${restartMsg}` } : m))
            );
            toast.error(`Agent 重启失败: ${restartMsg}`);
          } finally {
            setAgentStartLoading(agentId, false);
          }
        })();
        return;
      }
      
      useLogStore.getState().addError(`execute: ${errMsg}`);
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: `❌ ${errMsg}` } : m))
      );
      toast.error(errMsg);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, activeBackendSessionId, agentStartLoading]);

  // 任务完成后自动消费队列中的待发送消息
  const pendingQueueRef = useRef(pendingQueue);
  pendingQueueRef.current = pendingQueue;
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;
  useEffect(() => {
    if (!loading && pendingQueueRef.current.length > 0) {
      const nextContent = pendingQueueRef.current[0];
      setPendingQueue(prev => prev.slice(1));
      const timer = setTimeout(() => {
        handleSendRef.current(nextContent);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  const handleDeleteQueueItem = useCallback((index: number) => {
    setPendingQueue(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleRetry = useCallback((userContent: string) => {
    setMessages((prev) => {
      const next = [...prev];
      const lastIdx = next.length - 1;
      if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
        next.pop();
        if (lastIdx >= 1 && next[lastIdx - 1].role === "user") {
          next.pop();
        }
      }
      return next;
    });
    handleSend(userContent);
  }, [handleSend]);

  const loadMoreMessages = useCallback(async () => {
    if (loadingMore || !hasMoreMessages) return;
    setLoadingMore(true);
    if (scrollRef.current) {
      prevScrollHeightRef.current = scrollRef.current.scrollHeight;
    }
    try {
      if (!activeBackendSessionId) {
        const currentOffset = messageOffsetRef.current;
        const older = loadMessagesPaginated(agentId, currentOffset, PAGE_SIZE, currentCwd);
        if (older.length === 0) {
          setHasMoreMessages(false);
        } else {
          messageOffsetRef.current = currentOffset + older.length;
          setMessages((prev) => [...older, ...prev]);
          const total = getTotalMessageCount(agentId, currentCwd);
          setHasMoreMessages(messageOffsetRef.current < total);
        }
      } else {
        const currentStartOffset = backendOffsetRef.current;
        if (currentStartOffset <= 0) {
          setHasMoreMessages(false);
          return;
        }
        const newStartOffset = Math.max(0, currentStartOffset - PAGE_SIZE);
        const fetchLimit = currentStartOffset - newStartOffset;
        const older = await getSessionMessages(activeBackendSessionId, agentId, { offset: newStartOffset, limit: fetchLimit, cwd: currentCwd });
        if (older.length === 0) {
          setHasMoreMessages(false);
        } else {
          backendOffsetRef.current = newStartOffset;
          setMessages((prev) => [...older.map((m, i) => sessionMessageToMessage(m, newStartOffset + i)), ...prev]);
          setHasMoreMessages(newStartOffset > 0);
        }
      }
    } finally {
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMore, hasMoreMessages, agentId, activeBackendSessionId]);

  // 虚拟列表
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 200,
    measureElement: (el) => el?.getBoundingClientRect().height ?? 200,
  });
  const virtualItems = virtualizer.getVirtualItems();

  // 自动滚动
  const lastScrollRef = useRef(0);
  useEffect(() => {
    if (messages.length === 0) return;
    const now = Date.now();
    if (!loading || now - lastScrollRef.current > 150) {
      lastScrollRef.current = now;
      virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
    }
  }, [messages.length, loading, virtualizer]);

  // 加载更多后恢复滚动位置
  useEffect(() => {
    if (!loadingMore && prevScrollHeightRef.current > 0 && scrollRef.current) {
      const diff = scrollRef.current.scrollHeight - prevScrollHeightRef.current;
      if (diff > 0) {
        scrollRef.current.scrollTop += diff;
      }
      prevScrollHeightRef.current = 0;
    }
  }, [loadingMore, messages.length]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto px-6 py-4 relative custom-scrollbar scroll-smooth"
      >
        {hasMoreMessages && !loadingHistory && messages.length > 0 && (
          <div className="flex justify-center py-2">
            <button
              type="button"
              onClick={loadMoreMessages}
              disabled={loadingMore}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-muted/50 text-muted-foreground hover:bg-muted/70 hover:text-foreground border border-border/60 hover:border-primary/30 hover:shadow-sm transition-all duration-200 disabled:opacity-50"
            >
              {loadingMore ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
              {loadingMore ? "加载中..." : "加载更早的消息"}
            </button>
          </div>
        )}
        {isTruncated && !hasMoreMessages && !loadingHistory && messages.length > 0 && (
          <p className="text-center text-xs text-muted-foreground py-2">更早的消息已被省略</p>
        )}
        {loadingHistory && (
          <p className="absolute top-4 left-1/2 -translate-x-1/2 text-sm text-muted-foreground">加载会话中...</p>
        )}
        {agentStartLoading[agentId] && (
          <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent mr-2 shrink-0" />
            正在启动 Agent...
          </div>
        )}
        {!currentCwd && (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent shrink-0" />
              正在加载工作目录...
            </div>
          </div>
        )}
        {messages.length === 0 && !loadingHistory && currentCwd && (
          <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-6 shadow-lg shadow-primary/10 animate-scale-in">
              <Bot size={32} className="text-primary/70" />
            </div>
            <p className="text-center text-lg font-medium text-foreground mb-2 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
              发送消息开始对话
            </p>
            <p className="text-center text-sm text-muted-foreground mb-8 animate-fade-in-up" style={{ animationDelay: '150ms' }}>
              或选择一个建议任务快速开始
            </p>
            <div className="grid gap-3 w-full max-w-md stagger-children">
              {SUGGESTED_PROMPTS.map(({ icon: Icon, label, prompt }) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => handleSend(prompt)}
                  className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-border/60 bg-card/50 dark:bg-card/30 hover:bg-muted/60 dark:hover:bg-muted/70 hover:border-primary/30 hover:shadow-md hover:shadow-primary/5 hover:scale-[1.02] text-left text-sm transition-all duration-200 group"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                    <Icon className="h-4 w-4 text-primary/70" />
                  </div>
                  <span className="truncate text-foreground font-medium">{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.length > 0 && !loadingHistory && currentCwd && (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: "relative",
              width: "100%",
            }}
          >
            {virtualItems.map((virtualRow) => {
              const m = messages[virtualRow.index];
              const i = virtualRow.index;
              return (
                <div
                  key={m.id}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  data-index={virtualRow.index}
                >
                  <div className="pb-1">
                    <MessageBubble
                      message={m}
                      streaming={loading && m.role === "assistant" && i === messages.length - 1}
                      onRetry={
                        m.role === "assistant" && m.content.startsWith("❌") && i > 0
                          ? () => handleRetry(messages[i - 1].content)
                          : undefined
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {messages.length > 0 && (
        <div className="flex justify-center py-2 -mt-2">
          <CompactingIndicator contextPercent={contextPercent} compacting={compacting} />
        </div>
      )}
      {loading && messages.length > 0 && (
        <div className="flex justify-center -mt-1 mb-1">
          <StreamingStatus
            startTime={streamMetaRef.current.startTime}
            tokenEstimate={streamMetaRef.current.tokenEstimate}
          />
        </div>
      )}
      {pendingRequest?.tool === "ExitPlanMode" && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 bg-purple-50 dark:bg-purple-950/20 border-t border-purple-200 dark:border-purple-800">
          <span className="text-sm text-purple-700 dark:text-purple-300 font-medium">
            计划等待审批中，请在弹窗中查看并确认
          </span>
        </div>
      )}
      <InputArea
        agentId={agentId}
        onSend={handleSend}
        disabled={agentStartLoading[agentId] || false}
        loading={loading}
        onStop={handleStop}
        queueItems={pendingQueue}
        onDeleteQueueItem={handleDeleteQueueItem}
      />

      {pendingRequest?.tool === "AskUserQuestion" ? (
        <AskUserQuestionDialog request={pendingRequest} onDecision={handlePermissionDecision} />
      ) : pendingRequest?.tool === "ExitPlanMode" ? (
        <PlanApprovalDialog request={pendingRequest} onDecision={handlePermissionDecision} />
      ) : (
        <PermissionDialog request={pendingRequest} onDecision={handlePermissionDecision} />
      )}
      
      {/* 历史会话选择 */}
      <ConversationHistorySheet
        open={historySheetOpen}
        onOpenChange={setHistorySheetOpen}
        agentId={agentId}
        onSelectSession={(id) => {
          savePersistedBackendSession(agentId, id, currentCwd);
          setActiveBackendSessionId(id);
          // 触发消息重新加载
          bumpChatHistoryReload();
          setHistorySheetOpen(false);
        }}
      />
      
      {/* Checkpoint 管理 */}
      {activeBackendSessionId && (
        <CheckpointSheet
          open={checkpointSheetOpen}
          onOpenChange={setCheckpointSheetOpen}
          sessionId={activeBackendSessionId}
          agentId={agentId}
          executeBusy={loading}
        />
      )}
    </div>
  );
}
