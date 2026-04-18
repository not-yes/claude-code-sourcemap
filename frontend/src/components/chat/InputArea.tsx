import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from "@/components/ui/popover";
import { Send, Square, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { SLASH_COMMANDS } from "@/constants/slashCommands";
import { useAppStore } from "@/stores/appStore";
import { transcribeAudio } from "@/api/tauri-api";

interface InputAreaProps {
  agentId: string;
  onSend: (content: string) => Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  onStop?: () => void;
}

/** Parse slash-command state based on cursor position */
function parseSlash(value: string, cursorPos: number): { query: string; startIndex: number } | null {
  const beforeCursor = value.slice(0, cursorPos);
  // Trigger when / is preceded by start-of-string or whitespace
  const match = beforeCursor.match(/(^|\s)\/([\p{L}\p{N}_-]*)$/u);
  if (!match) return null;
  const startIndex = beforeCursor.lastIndexOf("/", beforeCursor.length - 1);
  return { query: match[2].toLowerCase(), startIndex };
}

export function InputArea({
  agentId,
  onSend,
  disabled,
  loading = false,
  onStop,
}: InputAreaProps) {
  const agentInputDrafts = useAppStore((s) => s.agentInputDrafts);
  const setAgentInputDraft = useAppStore((s) => s.setAgentInputDraft);
  const [value, setValue] = useState(() => agentInputDrafts[agentId] ?? "");
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"slash" | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastEnterTimeRef = useRef<number>(0);
  const valueRef = useRef<string>(agentInputDrafts[agentId] ?? "");
  const lastSlashQueryRef = useRef<string | null>(null);
  // 语音录制状态
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const slashState = parseSlash(value, cursorPos);

  const filteredSlashCommands = useMemo(() => {
    if (!slashState) return [];
    return SLASH_COMMANDS.filter((c) =>
      c.name.toLowerCase().includes(slashState.query) ||
      c.aliases?.some((a) => a.toLowerCase().includes(slashState.query))
    );
  }, [slashState]);

  useEffect(() => {
    if (slashState && filteredSlashCommands.length > 0) {
      const shouldResetIndex = pickerMode !== "slash" || lastSlashQueryRef.current !== slashState.query;
      lastSlashQueryRef.current = slashState.query;
      setPickerOpen(true);
      setPickerMode("slash");
      if (shouldResetIndex) setPickerIndex(0);
    } else {
      setPickerOpen(false);
      setPickerMode(null);
      lastSlashQueryRef.current = null;
    }
  }, [slashState, filteredSlashCommands.length, pickerMode]);

  // 组件卸载时清理 MediaRecorder 和音频流
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const insertSlash = useCallback(
    (cmdName: string, startIndex: number) => {
      const before = value.slice(0, startIndex);
      const after = value.slice(cursorPos);
      const newValue = `${before}/${cmdName} ${after}`;
      setValue(newValue);
      valueRef.current = newValue;
      setAgentInputDraft(agentId, newValue);
      setPickerOpen(false);
      // Move cursor after the inserted command + space
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          const pos = startIndex + cmdName.length + 2;
          el.setSelectionRange(pos, pos);
          el.focus();
        }
      });
    },
    [value, cursorPos, agentId, setAgentInputDraft]
  );

  const handleSend = useCallback(async () => {
    const rawValue = valueRef.current ?? '';
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
      setAgentInputDraft(agentId, "");
    } finally {
      setSending(false);
    }
  }, [onSend, sending, disabled, loading]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (pickerOpen && pickerMode === "slash" && filteredSlashCommands.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setPickerIndex((i) => (i < filteredSlashCommands.length - 1 ? i + 1 : 0));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setPickerIndex((i) => (i > 0 ? i - 1 : filteredSlashCommands.length - 1));
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const cmd = filteredSlashCommands[pickerIndex];
          const ss = parseSlash(value, cursorPos);
          if (cmd && ss) insertSlash(cmd.name, ss.startIndex);
          return;
        }
        if (e.key === "Escape") {
          setPickerOpen(false);
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
          handleSend();
        } else {
          // 第一次 Enter：记录时间，允许默认换行
          lastEnterTimeRef.current = now;
        }
      }
    },
    [
      pickerOpen,
      pickerMode,
      filteredSlashCommands,
      pickerIndex,
      insertSlash,
      handleSend,
      value,
      cursorPos,
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

  // 语音输入：开始/停止录制
  const handleVoiceInput = useCallback(async () => {
    // 检查浏览器是否支持 mediaDevices
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      console.error("[InputArea] 麦克风不可用: navigator.mediaDevices.getUserMedia is undefined");
      setVoiceError("桌面应用暂不支持语音输入，请使用浏览器版本访问");
      return;
    }

    // 如果正在录音，则停止并转写
    if (isRecording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsProcessingVoice(true);
      return;
    }

    // 开始录音
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 兼容 Safari 等不支持 audio/webm 的浏览器
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : 'audio/ogg';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      const detectedMimeType = mimeType; // 保存实际使用的 mimeType 用于 Blob
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // 停止所有音轨
        stream.getTracks().forEach((track) => track.stop());

        // 合并音频数据
        const audioBlob = new Blob(audioChunksRef.current, { type: detectedMimeType });

        // 转为 base64
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const dataUrl = reader.result as string;

          try {
            const text = await transcribeAudio(dataUrl);
            if (text && text.trim()) {
              // 将转写文本追加到输入框
              const currentValue = valueRef.current || "";
              const newValue = currentValue + (currentValue ? " " : "") + text.trim();
              setValue(newValue);
              valueRef.current = newValue;
              setAgentInputDraft(agentId, newValue);
              // 聚焦输入框
              textareaRef.current?.focus();
            }
          } catch (err) {
            console.error("[InputArea] 语音转写失败:", err);
            setVoiceError(`语音转写失败: ${err instanceof Error ? err.message : String(err)}`);
            setIsProcessingVoice(false);
          } finally {
            setIsProcessingVoice(false);
          }
        };
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("[InputArea] 无法访问麦克风:", err);
      setVoiceError(`无法访问麦克风: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [isRecording, agentId, setAgentInputDraft]);

  // Auto-scroll picker to keep the active item in view
  useEffect(() => {
    if (!pickerOpen) return;
    // small delay to ensure DOM has updated
    const id = setTimeout(() => {
      const activeEl = document.querySelector('[data-active="true"]') as HTMLElement | null;
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }, 0);
    return () => clearTimeout(id);
  }, [pickerIndex, pickerMode, pickerOpen]);

  return (
    <div className="px-4 py-4">
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
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
              placeholder="输入任务指令，/ 使用快捷命令，Shift+Enter 或双击 Enter 发送..."
              className="min-h-9 max-h-[6rem] resize-none border-0 bg-transparent px-1 py-2 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground placeholder:text-muted-foreground/70 placeholder:dark:text-muted-foreground/60"
              rows={1}
              disabled={disabled}
              onChange={(e) => {
                setValue(e.target.value);
                valueRef.current = e.target.value;
                setCursorPos(e.target.selectionStart ?? 0);
                setAgentInputDraft(agentId, e.target.value);
              }}
              onKeyUp={(e) => {
                setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? 0);
              }}
              onClick={(e) => {
                setCursorPos(e.currentTarget.selectionStart ?? 0);
              }}
              onKeyDown={handleKeyDown}
            />
            {/* 语音输入按钮 */}
            {(isRecording || isProcessingVoice) ? (
              <button
                type="button"
                disabled={isProcessingVoice}
                title={isRecording ? "停止录音" : "处理中..."}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/90 text-destructive-foreground transition-colors"
              >
                {isProcessingVoice ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleVoiceInput}
                title="语音输入"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/50 text-muted-foreground hover:bg-primary/20 hover:text-primary transition-colors"
              >
                <Mic className="h-4 w-4" />
              </button>
            )}
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
            {/* 语音输入错误提示 */}
            {voiceError && (
              <div className="mt-2 px-1 text-xs text-destructive flex items-center gap-1">
                <span>{voiceError}</span>
                <button
                  type="button"
                  onClick={() => setVoiceError(null)}
                  className="ml-auto hover:underline"
                >
                  关闭
                </button>
              </div>
            )}
          </div>
        </PopoverAnchor>
        <PopoverContent
          side="top"
          align="start"
          className="w-[var(--radix-popover-trigger-width)] max-h-48 overflow-auto p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {pickerMode === "slash" && (
            <>
              {filteredSlashCommands.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">
                  无匹配命令
                </p>
              ) : (
                <div className="py-1">
                  {filteredSlashCommands.map((cmd, i) => (
                    <div
                      key={cmd.name}
                      data-active={i === pickerIndex}
                      className={`w-full px-3 py-2 text-left text-sm flex flex-col gap-0.5 rounded-sm cursor-pointer transition-colors ${
                        i === pickerIndex
                          ? "bg-accent"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => {
                        const ss = parseSlash(value, cursorPos);
                        if (ss) insertSlash(cmd.name, ss.startIndex);
                      }}
                      onMouseEnter={() => setPickerIndex(i)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium">/{cmd.name}</span>
                        {cmd.aliases && cmd.aliases.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            别名: {cmd.aliases.join(", ")}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground truncate">
                        {cmd.description}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
