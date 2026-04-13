import { useVirtualizer } from "@tanstack/react-virtual";
import {
  executeStream,
  getHealth,
  getSessionMessages,
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
  loadMessagesPaginated,
  getTotalMessageCount,
  saveMessages,
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
import { useState, useCallback, useEffect, useRef } from "react";
import {
  Lightbulb,
  FileText,
  BarChart3,
  Sparkles,
  MessageSquarePlus,
  History,
  GitBranch,
  StopCircle,
  ChevronUp,
  Bot,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { usePermissionStore, type PermissionDecision } from "@/stores/permissionStore";
import { useAgentsStore } from "@/stores/agentsStore";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { WorkingDirectorySelector } from "./WorkingDirectorySelector";

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

const SUGGESTED_PROMPTS = [
  { icon: Sparkles, label: "你好，请介绍一下你自己", prompt: "你好，请介绍一下你自己" },
  { icon: FileText, label: "总结当前工作区文档", prompt: "总结当前工作区中的文档，列出要点" },
  { icon: BarChart3, label: "生成每日简报", prompt: "生成本日的任务简报，包括待办和已完成事项" },
  { icon: Code, label: "分析代码结构", prompt: "分析当前项目的代码结构，给出架构建议" },
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
  const setChatExecuteLoading = useAppStore((s) => s.setChatExecuteLoading);
  const setChatHeaderAction = useAppStore((s) => s.setChatHeaderAction);
  const sidecarConnected = useAppStore((s) => s.sidecarConnected);
  const agentStartLoading = useAppStore((s) => s.agentStartLoading);
  const setAgentStartLoading = useAppStore((s) => s.setAgentStartLoading);
  const refreshRunningAgents = useAgentsStore((s) => s.refreshRunningAgents);
  const agentWorkingDirectory = useAppStore((s) => s.agentWorkingDirectory);
  
  // 当前 Agent 的工作目录
  const currentCwd = agentWorkingDirectory[agentId] || "";
  
  // 每个 Agent 独立的 backendSessionId（按工作目录隔离）
  const [activeBackendSessionId, setActiveBackendSessionId] = useState<string | null>(() => 
    loadPersistedBackendSession(agentId, currentCwd)
  );
  
  // 工作目录变化时，重新加载对应的会话
  useEffect(() => {
    const newSessionId = loadPersistedBackendSession(agentId, currentCwd);
    setActiveBackendSessionId(newSessionId);
  }, [agentId, currentCwd]);

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
          onClick={() => setCheckpointSheetOpen(true)}
          disabled={!activeBackendSessionId || loading}
          title={
            !activeBackendSessionId
              ? "需要已绑定后端会话（从历史选择或重开后自动恢复）后再使用 Checkpoint"
              : loading
              ? "任务进行中，请稍后再操作 Checkpoint"
              : "Checkpoint（保存 / 回滚 / 时间线）"
          }
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-all duration-200 hover:scale-105 disabled:opacity-40 disabled:pointer-events-none"
        >
          <GitBranch className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleNewChat}
          title="新建对话"
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-all duration-200 hover:scale-105"
        >
          <MessageSquarePlus className="h-4 w-4" />
        </button>
      </div>
    );
    return () => setChatHeaderAction(null);
  }, [agentId, activeBackendSessionId, loading, setChatHeaderAction, setHistorySheetOpen, setCheckpointSheetOpen]);

  // 加载会话消息
  useEffect(() => {
    // 优先从本地加载（包含未完成的对话）
    const localTotal = getTotalMessageCount(agentId, currentCwd);
    const localMessages = loadMessagesPaginated(agentId, 0, PAGE_SIZE, currentCwd);
    
    if (localMessages.length > 0) {
      // 本地有消息，优先使用本地（包含未完成的对话）
      setMessages(localMessages);
      setIsTruncated(false);
      setHasMoreMessages(localTotal > PAGE_SIZE);
      messageOffsetRef.current = PAGE_SIZE;
      backendOffsetRef.current = 0;
      
      // 如果有后端会话ID，尝试合并后端消息（但不覆盖本地）
      if (activeBackendSessionId) {
        getSessionMessages(activeBackendSessionId, agentId, { limit: PAGE_SIZE * 10 })
          .then((backendMessages) => {
            if (backendMessages.length > localMessages.length) {
              // 后端有更多消息，合并（后端消息补充本地）
              const converted = backendMessages.map((m, i) => sessionMessageToMessage(m, i));
              setMessages(converted);
            }
          })
          .catch(() => {
            // 后端加载失败，保持本地消息
          });
      }
    } else if (activeBackendSessionId) {
      // 本地没有，从后端加载
      setLoadingHistory(true);
      getSessionMessages(activeBackendSessionId, agentId, { limit: PAGE_SIZE * 10 })
        .then(async (fullList) => {
          const total = fullList.length;
          if (total <= PAGE_SIZE) {
            const converted = fullList.map((m, i) => sessionMessageToMessage(m, i));
            setMessages(converted);
            setIsTruncated(false);
            setHasMoreMessages(false);
            backendOffsetRef.current = 0;
          } else {
            const startOffset = total - PAGE_SIZE;
            const latest = await getSessionMessages(activeBackendSessionId, agentId, { offset: startOffset, limit: PAGE_SIZE });
            const converted = latest.map((m, i) => sessionMessageToMessage(m, startOffset + i));
            setMessages(converted.length > MAX_MESSAGES_IN_MEMORY ? converted.slice(-MAX_MESSAGES_IN_MEMORY) : converted);
            setIsTruncated(converted.length > MAX_MESSAGES_IN_MEMORY);
            setHasMoreMessages(startOffset > 0);
            backendOffsetRef.current = startOffset;
          }
          // 同时保存到本地
          saveMessages(agentId, fullList.map((m, i) => sessionMessageToMessage(m, i)), currentCwd);
        })
        .catch(() => {
          setMessages([]);
          savePersistedBackendSession(agentId, null, currentCwd);
          setActiveBackendSessionId(null);
          toast.error("该会话已失效，已切换为本地对话（可新建对话或从历史重新选择）");
        })
        .finally(() => setLoadingHistory(false));
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
      if (!req) return;

      const remembered = usePermissionStore.getState().getRememberedDecision(req.tool);
      if (remembered !== undefined) {
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

  // 启动 Agent
  useEffect(() => {
    setCheckpointSheetOpen(false);
    messageOffsetRef.current = PAGE_SIZE;
    backendOffsetRef.current = 0;
    setHasMoreMessages(false);
    touchSession(agentId, currentCwd);
    
    if (getLocalStorageUsagePercent() > 80) {
      cleanupOldSessions(10);
    }

    if (!sidecarConnected) {
      return;
    }

    // Agent 启动逻辑在 WorkingDirectorySelector 中处理
  }, [agentId, sidecarConnected, setCheckpointSheetOpen]);

  // Ref 保存最新消息，用于卸载时保存
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const activeBackendSessionIdRef = useRef(activeBackendSessionId);
  activeBackendSessionIdRef.current = activeBackendSessionId;
  
  // 保存消息到本地
  useEffect(() => {
    if (activeBackendSessionId) return;
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      saveMessages(agentId, messages, currentCwd);
      saveDebounceRef.current = null;
    }, 500);
    return () => {
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    };
  }, [agentId, messages, activeBackendSessionId]);
  
  // 组件卸载时立即保存消息（使用 ref 避免闭包陷阱）
  useEffect(() => {
    return () => {
      if (!activeBackendSessionIdRef.current && messagesRef.current.length > 0) {
        saveMessages(agentId, messagesRef.current, currentCwd);
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
    if (inFlightRef.current) return;
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
      if (next.length > MAX_MESSAGES_IN_MEMORY) {
        setIsTruncated(true);
        return next.slice(-MAX_MESSAGES_IN_MEMORY);
      }
      return next;
    });
    setLoading(true);

    const sessionOpts = {
      ...(activeBackendSessionId ? { backendSessionId: activeBackendSessionId } : {}),
      agentId: agentId,
    };

    try {
      await executeStream(content, sessionOpts, {
        signal: abortControllerRef.current.signal,
        onChunk: () => {},
        onEvent: (event) => {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantMsg.id) return m;
              const blocks: MessageContentBlock[] = [...(m.contentBlocks || [])];
              let completionUsage: TokenUsage | undefined;

              switch (event.type) {
                case 'text': {
                  const textEvent = event as { type: 'text'; content: string; isThinking?: boolean };
                  if (!responseTruncatedRef.current) {
                    responseSizeRef.current += textEvent.content.length;
                    if (responseSizeRef.current > MAX_RESPONSE_SIZE) {
                      responseTruncatedRef.current = true;
                      blocks.push({ type: 'text', content: '\n\n[内容已截断]' });
                      break;
                    }
                  } else {
                    break;
                  }
                  if (textEvent.isThinking) {
                    if (!textEvent.content) break;
                    const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;
                    if (lastBlock && lastBlock.type === 'thinking') {
                      blocks[blocks.length - 1] = { ...lastBlock, content: lastBlock.content + textEvent.content };
                    } else {
                      blocks.push({ type: 'thinking', content: textEvent.content });
                    }
                  } else {
                    const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;
                    if (lastBlock && lastBlock.type === 'text') {
                      blocks[blocks.length - 1] = { ...lastBlock, content: lastBlock.content + textEvent.content };
                    } else {
                      blocks.push({ type: 'text', content: textEvent.content });
                    }
                  }
                  break;
                }
                case 'tool_use': {
                  const tuEvent = event as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
                  if (blocks.length < MAX_CONTENT_BLOCKS) {
                    blocks.push({ type: 'tool_use', id: tuEvent.id, name: tuEvent.name, input: tuEvent.input || {} });
                  }
                  break;
                }
                case 'tool_result': {
                  const trEvent = event as { type: 'tool_result'; id: string; toolName: string; result: unknown; isError?: boolean; filePath?: string };
                  if (blocks.length < MAX_CONTENT_BLOCKS) {
                    blocks.push({ type: 'tool_result', toolId: trEvent.id, toolName: trEvent.toolName, result: trEvent.result, isError: trEvent.isError, filePath: trEvent.filePath });
                  }
                  break;
                }
                case 'system_message': {
                  const sysEvent = event as { type: 'system_message'; level: 'info' | 'warning' | 'error'; content: string };
                  if (sysEvent.content && blocks.length < MAX_CONTENT_BLOCKS) {
                    blocks.push({ type: 'system', level: sysEvent.level, content: sysEvent.content });
                  }
                  break;
                }
                case 'complete': {
                  const completeEvent = event as { type: 'complete'; usage?: TokenUsage; reason?: string; sessionId?: string };
                  completionUsage = completeEvent.usage;
                  if (completeEvent.sessionId && !activeBackendSessionId) {
                    savePersistedBackendSession(agentId, completeEvent.sessionId, currentCwd);
                    setActiveBackendSessionId(completeEvent.sessionId);
                  }
                  break;
                }
                case 'error': {
                  const errEvent = event as { type: 'error'; message?: string };
                  blocks.push({ type: 'system', level: 'error', content: errEvent.message || '未知错误' });
                  break;
                }
              }

              const textContent = blocks
                .filter(b => b.type === 'text')
                .map(b => (b as { type: 'text'; content: string }).content)
                .join('');

              return { ...m, contentBlocks: blocks, content: textContent, ...(completionUsage ? { usage: completionUsage } : {}) };
            })
          );
        },
        onDone: (error, aborted) => {
          inFlightRef.current = false;
          setLoading(false);
          abortControllerRef.current = null;
          if (aborted) return;
          if (error) {
            const errMsg = error.message || "未知错误";
            useLogStore.getState().addError(`execute: ${errMsg}`);
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsg.id) return m;
                const hasContent = (m.content && m.content.length > 10) || (m.contentBlocks && m.contentBlocks.length > 0);
                if (hasContent) {
                  return { ...m, content: (m.content || '') + `\n\n---\n⚠️ ${errMsg}` };
                } else {
                  return { ...m, content: `❌ ${errMsg}` };
                }
              })
            );
            toast.error(errMsg);
          } else {
            toast.success("任务执行完成");
          }
        },
      });
    } catch (e) {
      if (e instanceof Error && e.message === "STREAM_LIMIT_EXCEEDED") {
        toast.error("当前并发请求过多，请稍后重试");
        setMessages((prev) => prev.filter((m) => m.id !== userMsg.id && m.id !== assistantMsg.id));
      }
      inFlightRef.current = false;
      setLoading(false);
      abortControllerRef.current = null;
      if ((e as Error)?.name === "AbortError") return;
      const errMsg = e instanceof Error ? e.message || e.name || "未知错误" : String(e ?? "执行失败");
      useLogStore.getState().addError(`execute: ${errMsg}`);
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: `❌ ${errMsg}` } : m))
      );
      toast.error(errMsg);
    }
  }, [agentId, activeBackendSessionId, agentStartLoading]);

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
        const older = await getSessionMessages(activeBackendSessionId, agentId, { offset: newStartOffset, limit: fetchLimit });
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
        {messages.length === 0 && !loadingHistory && (
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
        {messages.length > 0 && !loadingHistory && (
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
      {loading && (
        <div className="flex justify-center px-4 pb-2">
          <button
            type="button"
            onClick={handleStop}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 hover:scale-105 active:scale-95 transition-all duration-200 animate-pulse-glow"
          >
            <StopCircle className="h-3.5 w-3.5" />
            中止
          </button>
        </div>
      )}
      <InputArea onSend={handleSend} disabled={loading} loading={loading} onStop={handleStop} />

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
