import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from "@/components/ui/popover";
import { Send, Square, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgents } from "@/hooks/useAgents";
import { useAgentMetadataStore } from "@/stores/agentMetadataStore";

interface InputAreaProps {
  onSend: (content: string) => Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  onStop?: () => void;
}

/** Parse @mention state: returns { query, startIndex } when in @ mode */
function parseMention(value: string): { query: string; startIndex: number } | null {
  const match = value.match(/@([\w-]*)$/);
  if (!match) return null;
  return { query: match[1].toLowerCase(), startIndex: match.index ?? 0 };
}

export function InputArea({
  onSend,
  disabled,
  loading = false,
  onStop,
}: InputAreaProps) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastEnterTimeRef = useRef<number>(0);
  const valueRef = useRef<string>("");

  const { agents } = useAgents();
  const getMeta = useAgentMetadataStore((s) => s.get);

  const mentionState = parseMention(value);
  const filteredAgents = useMemo(() => {
    const state = parseMention(value);
    if (!state) return [];
    const allAgents = [{ id: "main", name: "main" }, ...agents];
    return allAgents.filter((a) =>
      a.name.toLowerCase().includes(state.query)
    );
  }, [value, agents]);

  useEffect(() => {
    if (mentionState && filteredAgents.length > 0) {
      setMentionOpen(true);
      setMentionSelectedIndex(0);
    } else {
      setMentionOpen(false);
    }
  }, [mentionState, filteredAgents.length]);

  const insertMention = useCallback(
    (agentName: string) => {
      if (!mentionState) return;
      const before = value.slice(0, mentionState.startIndex);
      const newValue = `${before}@${agentName} `;
      setValue(newValue);
      setMentionOpen(false);
      textareaRef.current?.focus();
    },
    [value, mentionState]
  );

  const handleSend = useCallback(async (overrideValue?: string) => {
    const rawValue = overrideValue ?? valueRef.current ?? '';
    const trimmed = typeof rawValue === 'string' ? rawValue.trim() : '';
    console.warn(`[InputArea:handleSend] 进入, sending=${sending}, disabled=${disabled}, loading=${loading}, value长度=${trimmed.length}`);
    if (!trimmed || sending || disabled || loading) {
      console.warn(`[InputArea:handleSend] 被阻止! trimmed=${!!trimmed}, sending=${sending}, disabled=${disabled}, loading=${loading}`);
      return;
    }
    setSending(true);
    try {
      await onSend(trimmed);
      setValue("");
      valueRef.current = "";
    } finally {
      setSending(false);
    }
  }, [onSend, sending, disabled, loading]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (mentionOpen && filteredAgents.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionSelectedIndex((i) =>
            i < filteredAgents.length - 1 ? i + 1 : 0
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionSelectedIndex((i) =>
            i > 0 ? i - 1 : filteredAgents.length - 1
          );
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const agent = filteredAgents[mentionSelectedIndex];
          if (agent) insertMention(agent.name);
          return;
        }
        if (e.key === "Escape") {
          setMentionOpen(false);
          return;
        }
      }

      // Shift+Enter → 发送
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        handleSend();
        return;
      }

      // Cmd/Ctrl+Enter → 发送
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSend();
        return;
      }

      // 单次 Enter → 换行（默认行为）
      // 双击 Enter（300ms内连按两次）→ 删除第一次换行并发送
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const now = Date.now();
        const elapsed = now - lastEnterTimeRef.current;
        if (elapsed < 300) {
          // 双击 Enter：阻止第二次换行，删除第一次插入的换行，然后发送
          e.preventDefault();
          lastEnterTimeRef.current = 0;
          // 删除第一次 Enter 插入的换行符（当前光标前一个字符）
          const el = textareaRef.current;
          const currentValue = valueRef.current;
          const pos = el ? el.selectionStart : currentValue.length;
          let sendContent = currentValue;
          if (pos > 0 && currentValue[pos - 1] === "\n") {
            sendContent = currentValue.slice(0, pos - 1) + currentValue.slice(pos);
          }
          setValue(sendContent);
          valueRef.current = sendContent;
          handleSend(sendContent);
        } else {
          // 第一次 Enter：记录时间，允许默认换行
          lastEnterTimeRef.current = now;
        }
      }
    },
    [
      mentionOpen,
      filteredAgents,
      mentionSelectedIndex,
      insertMention,
      handleSend,
    ]
  );

  const canSend =
    value.trim().length > 0 && !sending && !disabled && !loading;
  const showStop = loading && onStop;

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const h = Math.min(Math.max(el.scrollHeight, 36), 96);
    el.style.height = `${h}px`;
  }, []);

  useLayoutEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  return (
    <div className="px-4 py-4">
      <Popover open={mentionOpen} onOpenChange={setMentionOpen}>
        <PopoverAnchor asChild>
          <div
            className={cn(
              "flex items-end gap-2 rounded-2xl border border-border/70 bg-muted/30 dark:bg-muted/50 px-3 py-2 transition-all duration-200",
              "focus-within:border-primary/60 focus-within:bg-muted/40 focus-within:ring-2 focus-within:ring-primary/20 focus-within:shadow-lg focus-within:shadow-primary/15",
              "dark:focus-within:bg-muted/50"
            )}
          >
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                valueRef.current = e.target.value;
              }}
              placeholder="输入任务指令，输入 @ 提及 Agent，Shift+Enter 或双击 Enter 发送..."
              className="min-h-9 max-h-[6rem] resize-none border-0 bg-transparent px-1 py-2 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground placeholder:text-muted-foreground/70 placeholder:dark:text-muted-foreground/60"
              rows={1}
              disabled={disabled}
              onKeyDown={handleKeyDown}
            />
            {showStop ? (
              <button
                type="button"
                onClick={onStop}
                title="停止生成"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/90 text-destructive-foreground hover:bg-destructive transition-colors"
              >
                <Square className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-200",
                  canSend
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-110 hover:shadow-lg hover:shadow-primary/25 active:scale-95"
                    : "bg-muted/50 text-muted-foreground cursor-not-allowed"
                )}
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
        </PopoverAnchor>
        <PopoverContent
          side="top"
          align="start"
          className="w-[var(--radix-popover-trigger-width)] max-h-48 overflow-auto p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {filteredAgents.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              无匹配 Agent
            </p>
          ) : (
            <div className="py-1">
              {filteredAgents.map((agent, i) => {
                const meta = getMeta(agent.id);
                const displayName =
                  agent.name === "main"
                    ? meta?.displayName ?? "主聊 (Master)"
                    : meta?.displayName ?? agent.name;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 rounded-sm transition-colors ${
                      i === mentionSelectedIndex
                        ? "bg-accent"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => insertMention(agent.name)}
                    onMouseEnter={() => setMentionSelectedIndex(i)}
                  >
                    <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{displayName}</span>
                  </button>
                );
              })}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
