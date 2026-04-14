import { useVirtualizer } from "@tanstack/react-virtual";
import {
  executeStream,
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
  loadMessages,
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
  
  // 工作目录就绪后（或变化时），重新加载对应的会话
  // 当 currentCwd 从空字符串变为有效值时，此 effect 会触发并正确加载 sessionId
  useEffect(() => {
    if (!currentCwd) return; // cwd 未就绪，跳过
    const newSessionId = loadPersistedBackendSession(agentId, currentCwd);
    setActiveBackendSessionId(newSessionId);
  }, [agentId, currentCwd]);
  
  // 从旧的 key（无 cwd 后缀）迁移消息到新 key（有 cwd 后缀）
  // 处理 workingDirectories 异步加载导致的存储 key 不一致问题
  useEffect(() => {
    if (!currentCwd) return;
    const oldMessages = loadMessages(agentId);
    if (oldMessages.length > 0) {
      const newMessages = loadMessages(agentId, currentCwd);
      if (newMessages.length === 0) {
        // 新 key 没有消息，迁移旧消息并删除旧 key
        saveMessages(agentId, oldMessages, currentCwd);
        saveMessages(agentId, []);
      }
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, activeBackendSessionId, loading, setChatHeaderAction, setHistorySheetOpen, setCheckpointSheetOpen]);

  // 加载会话消息
  // 使用 ref 避免在执行过程中因 activeBackendSessionId 变化而覆盖当前消息
  const isInitialLoadRef = useRef(true);
  useEffect(() => {
    // 只在首次挂载或显式 reload 时加载
    // 执行过程中 complete 事件会修改 activeBackendSessionId，此时不应重新加载
    if (!isInitialLoadRef.current && !chatHistoryReloadNonce) {
      return;
    }
    isInitialLoadRef.current = false;
    
    // 优先从本地加载（包含完整 contentBlocks 的消息）
    const localTotal = getTotalMessageCount(agentId, currentCwd);
    const localMessages = loadMessagesPaginated(agentId, 0, PAGE_SIZE, currentCwd);
    
    if (localMessages.length > 0) {
      // 本地有完整消息，直接使用（包括 contentBlocks/thinking/tool 信息）
      // 不覆盖，因为后端只保存纯文本，会丢失 UI 展示所需的 contentBlocks
      setMessages(localMessages);
      setIsTruncated(false);
      setHasMoreMessages(localTotal > PAGE_SIZE);
      messageOffsetRef.current = PAGE_SIZE;
      backendOffsetRef.current = 0;
      
      // 仅做后端会话健康检查（不覆盖本地消息）
      if (activeBackendSessionId) {
        getSessionMessages(activeBackendSessionId, agentId, { limit: 1 })
          .catch(() => {
            // 后端会话已失效，清空绑定
            savePersistedBackendSession(agentId, null, currentCwd);
            setActiveBackendSessionId(null);
          });
      }
    } else if (activeBackendSessionId) {
      // 本地没有，从后端加载（降级为纯文本）
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
        saveMessages(agentId, messagesRef.current, currentCwdRef.current);
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
      const trimmed = next.length > MAX_MESSAGES_IN_MEMORY ? next.slice(-MAX_MESSAGES_IN_MEMORY) : next;
      if (next.length > MAX_MESSAGES_IN_MEMORY) setIsTruncated(true);
      messagesRef.current = trimmed;
      return trimmed;
    });
    // 立即保存用户消息，防止发送后刷新丢失
    saveMessages(agentId, messagesRef.current, currentCwdRef.current);
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

    try {
      await executeStream(content, sessionOpts, {
        signal: abortControllerRef.current.signal,
        onChunk: () => {},
        onEvent: (event) => {
          setMessages((prev) => {
            const next = prev.map((m) => {
              if (m.id !== assistantMsg.id) return m;
              const blocks: MessageContentBlock[] = [...(m.contentBlocks || [])];
              let completionUsage: TokenUsage | undefined;

              switch (event.type) {
                case 'text': {
                  const textEvent = event as { type: 'text'; content: string; isThinking?: boolean };
                  console.log(`[ChatArea] text event: isThinking=${textEvent.isThinking}, content_len=${textEvent.content?.length || 0}`);
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
                      console.log(`[ChatArea] Adding new text block: ${textEvent.content.substring(0, 50)}...`);
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
                  console.log(`[ChatArea] complete event: reason=${completeEvent.reason}, hasUsage=${!!completeEvent.usage}`);
                  completionUsage = completeEvent.usage;
                  if (completeEvent.sessionId) {
                    // 始终保存 Sidecar 返回的 sessionId（确保与后端同步）
                    const cwdForSave = currentCwd || useAppStore.getState().agentWorkingDirectory[agentId] || useAppStore.getState().workingDirectories[0] || "";
                    if (cwdForSave) {
                      savePersistedBackendSession(agentId, completeEvent.sessionId, cwdForSave);
                    }
                    if (!activeBackendSessionId) {
                      setActiveBackendSessionId(completeEvent.sessionId);
                    }
                  }
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
            });
            
            // 同步更新 ref，确保 ref 与 state 一致
            messagesRef.current = next;
            
            // 调度保存：完成时立即保存，流式时 500ms 防抖
            if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
            const lastMsg = next[next.length - 1];
            const isCompleted = lastMsg?.role === 'assistant' && lastMsg?.usage !== undefined;
            const delay = isCompleted ? 0 : 500;
            saveDebounceRef.current = setTimeout(() => {
              saveMessages(agentId, messagesRef.current, currentCwdRef.current);
              saveDebounceRef.current = null;
            }, delay);
            
            return next;
          });
        },
        onDone: (error, aborted) => {
          inFlightRef.current = false;
          setLoading(false);
          abortControllerRef.current = null;
          
          if (aborted) {
            saveMessages(agentId, messagesRef.current, currentCwdRef.current);
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
            saveMessages(agentId, messagesRef.current, currentCwdRef.current);
            toast.error(errMsg);
          } else {
            if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
            saveMessages(agentId, messagesRef.current, currentCwdRef.current);
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
