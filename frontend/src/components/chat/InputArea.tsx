import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from "@/components/ui/popover";
import { Send, Square, Mic, Trash2, Pencil, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SLASH_COMMANDS } from "@/constants/slashCommands";
import { useAppStore } from "@/stores/appStore";
import { openSystemPreferences, transcribeAudio, initAsr, getAsrStatus } from "@/api/tauri-api";

interface InputAreaProps {
  agentId: string;
  onSend: (content: string) => Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  onStop?: () => void;
  queueItems?: string[];
  onDeleteQueueItem?: (index: number) => void;
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
  queueItems = [],
  onDeleteQueueItem,
}: InputAreaProps) {
  const agentInputDrafts = useAppStore((s) => s.agentInputDrafts);
  const setAgentInputDraft = useAppStore((s) => s.setAgentInputDraft);
  const [value, setValue] = useState(() => agentInputDrafts[agentId] ?? "");
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"slash" | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const [queuePanelOpen, setQueuePanelOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastEnterTimeRef = useRef<number>(0);
  const valueRef = useRef<string>(agentInputDrafts[agentId] ?? "");

  // Agent 切换时同步输入框 draft
  useEffect(() => {
    const draft = agentInputDrafts[agentId] ?? "";
    if (valueRef.current !== draft) {
      setValue(draft);
      valueRef.current = draft;
    }
    setQueuePanelOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);
  const lastSlashQueryRef = useRef<string | null>(null);
  // 语音录制状态
  const [isRecording, setIsRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [asrStatusMessage, setAsrStatusMessage] = useState<string | null>(null);
  const [volumeBars, setVolumeBars] = useState<number[]>([0.2, 0.3, 0.2, 0.3, 0.2]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const volumeAudioCtxRef = useRef<AudioContext | null>(null);
  const volumeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ASR 模型静默预加载（进入页面就后台 init，避免首次录音卡顿）
  useEffect(() => {
    let cancelled = false;
    getAsrStatus().then(status => {
      if (cancelled) return;
      if (!status.initialized && !status.initializing) {
        console.log("[InputArea] 预加载 ASR 模型...");
        initAsr().catch(err => {
          console.warn("[InputArea] ASR 预加载失败（将在首次使用时重试）:", err);
        });
      }
    });
    return () => { cancelled = true; };
  }, []);

  // 组件卸载时停止录音并清理音频分析资源
  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      if (volumeIntervalRef.current) {
        clearInterval(volumeIntervalRef.current);
      }
      if (volumeAudioCtxRef.current) {
        volumeAudioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

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
    if (!trimmed || sending || disabled) {
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
    value.trim().length > 0 && !sending && !disabled;

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

  // 语音输入：使用本地 ASR（Rust 后端）
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  /**
   * 将音频 Blob 解码为 16kHz 单声道 16-bit PCM
   * 使用 Web Audio API 解码（支持 webm/opus/mp4 等浏览器格式）
   */
  async function decodeAudioToPcm16(blob: Blob): Promise<Int16Array> {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new AudioContext({ sampleRate: 16000 });
    try {
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const numChannels = audioBuffer.numberOfChannels;
      const srcRate = audioBuffer.sampleRate;
      const srcLength = audioBuffer.length;

      // 混音为单声道
      const mono = new Float32Array(srcLength);
      for (let i = 0; i < srcLength; i++) {
        let sum = 0;
        for (let ch = 0; ch < numChannels; ch++) {
          sum += audioBuffer.getChannelData(ch)[i];
        }
        mono[i] = sum / numChannels;
      }

      // 如果源采样率不是 16kHz，线性插值重采样
      let resampled: Float32Array;
      if (srcRate !== 16000) {
        const ratio = 16000 / srcRate;
        const newLength = Math.floor(srcLength * ratio);
        resampled = new Float32Array(newLength);
        for (let i = 0; i < newLength; i++) {
          const srcIdx = i / ratio;
          const i0 = Math.floor(srcIdx);
          const i1 = Math.min(i0 + 1, srcLength - 1);
          const frac = srcIdx - i0;
          resampled[i] = mono[i0] * (1 - frac) + mono[i1] * frac;
        }
      } else {
        resampled = mono;
      }

      // 转换为 16-bit PCM
      const pcm = new Int16Array(resampled.length);
      for (let i = 0; i < resampled.length; i++) {
        const clamped = Math.max(-1, Math.min(1, resampled[i]));
        pcm[i] = Math.floor(clamped * 32767);
      }
      return pcm;
    } finally {
      await audioCtx.close();
    }
  }

  const handleVoiceInput = useCallback(async () => {
    console.log("[InputArea] handleVoiceInput called, isRecording=", isRecording);

    // 如果正在录音，则停止并处理
    if (isRecording) {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      // 计时器在 onstop 中清理
      return;
    }

    // 检查麦克风权限
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setVoiceError("浏览器不支持麦克风访问");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // 创建 MediaRecorder，使用 webm 编码（Safari 14.1+ 支持 webm）
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        console.log("[InputArea] Recording stopped, processing audio...");

        // 停止计时器和音量分析
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        if (volumeIntervalRef.current) {
          clearInterval(volumeIntervalRef.current);
          volumeIntervalRef.current = null;
        }
        if (volumeAudioCtxRef.current) {
          volumeAudioCtxRef.current.close().catch(() => {});
          volumeAudioCtxRef.current = null;
        }
        analyserRef.current = null;
        setIsRecording(false);

        // 停止所有 track
        stream.getTracks().forEach(track => track.stop());

        // 检查是否有音频数据
        if (audioChunksRef.current.length === 0) {
          console.log("[InputArea] No audio data recorded");
          return;
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });

        try {
          if (!mountedRef.current) return;
          setIsTranscribing(true);

          // 解码并重采样为 16kHz PCM
          const pcmData = await decodeAudioToPcm16(audioBlob);
          if (!mountedRef.current) return;
          console.log("[InputArea] PCM samples:", pcmData.length, "duration:", (pcmData.length / 16000).toFixed(1) + "s");

          // 转换为 base64（小端序 16-bit PCM）
          const bytes = new Uint8Array(pcmData.buffer);
          const base64 = btoa(
            Array.from(bytes)
              .map(b => String.fromCharCode(b))
              .join('')
          );

          // 检查 ASR 状态，必要时初始化
          let asrStatus: { initialized: boolean; initializing: boolean; downloadProgress: number } | null = null;
          try {
            asrStatus = await getAsrStatus();
          } catch {
            // ignore
          }

          if (!asrStatus?.initialized && !asrStatus?.initializing) {
            console.log("[InputArea] Initializing ASR...");
            setAsrStatusMessage("正在初始化语音识别模型...");
            try {
              await initAsr();
            } catch (err) {
              console.error("[InputArea] initAsr failed:", err);
              setVoiceError("语音识别模型初始化失败");
              setAsrStatusMessage(null);
              setIsTranscribing(false);
              return;
            }
          }

          if (asrStatus?.initializing) {
            setAsrStatusMessage(`正在下载语音模型: ${Math.round(asrStatus.downloadProgress)}%`);
          }

          // 调用本地 ASR
          console.log("[InputArea] Calling transcribeAudio...");
          const result = await transcribeAudio(base64);
          if (!mountedRef.current) return;
          setVoiceError(null);
          setAsrStatusMessage(null);

          if (result?.text && result.text !== '[未能识别语音]') {
            const currentValue = valueRef.current || "";
            const newValue = currentValue + (currentValue ? " " : "") + result.text.trim();
            setValue(newValue);
            valueRef.current = newValue;
            setAgentInputDraft(agentId, newValue);
            textareaRef.current?.focus();
          } else {
            setVoiceError("未能识别语音，请重试");
          }
        } catch (err) {
          if (!mountedRef.current) return;
          console.error("[InputArea] Transcription failed:", err);
          setVoiceError(`转写失败: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          if (mountedRef.current) {
            setIsTranscribing(false);
          }
        }
      };

      recorder.onerror = (event: any) => {
        console.error("[InputArea] MediaRecorder error:", event.error);
        setVoiceError(`录音错误: ${event.error?.message || event.error}`);
        setIsRecording(false);
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        if (volumeIntervalRef.current) {
          clearInterval(volumeIntervalRef.current);
          volumeIntervalRef.current = null;
        }
        if (volumeAudioCtxRef.current) {
          volumeAudioCtxRef.current.close().catch(() => {});
          volumeAudioCtxRef.current = null;
        }
        analyserRef.current = null;
        stream.getTracks().forEach(track => track.stop());
      };

      // 开始录音
      recorder.start(1000);  // 每秒收集一次数据
      setIsRecording(true);
      setRecordingDuration(0);
      setVoiceError(null);
      console.log("[InputArea] Recording started, mimeType=", mimeType);

      // 启动计时器
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => {
          const next = prev + 1;
          // 最大录音时长 60 秒
          if (next >= 60) {
            const recorder = mediaRecorderRef.current;
            if (recorder && recorder.state !== 'inactive') {
              recorder.stop();
            }
          }
          return next;
        });
      }, 1000);

      // 启动音量分析（用于波形动画）
      try {
        const audioCtx = new AudioContext();
        volumeAudioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.8;
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        volumeIntervalRef.current = setInterval(() => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          const normalized = average / 255;
          // 生成 5 根跳动的音量柱
          setVolumeBars(Array.from({ length: 5 }, (_, i) => {
            const noise = Math.sin(Date.now() / 100 + i) * 0.15;
            const height = Math.max(0.15, Math.min(1, normalized * 0.9 + noise + 0.1));
            return height;
          }));
        }, 100);
      } catch (e) {
        console.warn("[InputArea] 音量分析启动失败:", e);
      }

    } catch (permErr) {
      console.error("[InputArea] Microphone permission denied:", permErr);
      setVoiceError("麦克风权限被拒绝，请在系统偏好设置中允许访问");
    }
  }, [agentId, setAgentInputDraft, isRecording]);

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
      {/* 队列面板 */}
      {queuePanelOpen && queueItems.length > 0 && (
        <div className="mb-2 max-h-48 overflow-y-auto rounded-2xl border border-border/70 bg-muted/30 dark:bg-muted/50 p-2.5 space-y-1.5 animate-fade-in-up">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-medium text-muted-foreground">
              待发送队列 ({queueItems.length})
            </span>
            <button
              type="button"
              onClick={() => setQueuePanelOpen(false)}
              className="rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-all duration-200"
            >
              收起
            </button>
          </div>
          {queueItems.map((item, i) => (
            <div
              key={i}
              className="group flex items-center gap-2 rounded-xl bg-muted/30 dark:bg-muted/40 p-2 hover:bg-muted/50 dark:hover:bg-muted/60 transition-all duration-200"
            >
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{i + 1}.</span>
              <span className="min-h-[1.5rem] flex-1 break-words rounded-lg px-2 py-1 text-xs text-foreground">
                {item}
              </span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200">
                <button
                  type="button"
                  onClick={() => {
                    setValue(item);
                    valueRef.current = item;
                    setAgentInputDraft(agentId, item);
                    onDeleteQueueItem?.(i);
                    setQueuePanelOpen(false);
                    requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                  title="移到输入框编辑"
                  className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-200"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteQueueItem?.(i)}
                  title="删除"
                  className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-200"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {/* 语音输入状态提示 */}
      {asrStatusMessage && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted/50 border border-border/50 px-3 py-2 text-xs animate-in fade-in slide-in-from-top-1">
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
          <span className="text-muted-foreground flex-1">{asrStatusMessage}</span>
        </div>
      )}
      {isTranscribing && !voiceError && !asrStatusMessage && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-primary/10 border border-primary/20 px-3 py-2 text-xs animate-in fade-in slide-in-from-top-1">
          <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
          <span className="text-primary flex-1">正在识别语音...</span>
        </div>
      )}
      {voiceError && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs animate-in fade-in slide-in-from-top-1">
          <span className="text-destructive flex-1">{voiceError}</span>
          <button
            type="button"
            onClick={() => {
              openSystemPreferences("microphone");
              setVoiceError(null);
            }}
            className="text-primary hover:text-primary/80 underline transition-colors"
          >
            打开设置
          </button>
          <button
            type="button"
            onClick={() => setVoiceError(null)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            ✕
          </button>
        </div>
      )}
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
            {/* 录音音量波形 */}
            {isRecording && (
              <div className="flex items-end gap-[3px] h-5 pb-1.5 shrink-0">
                {volumeBars.map((h, i) => (
                  <div
                    key={i}
                    className="w-[3px] rounded-full bg-destructive/80 transition-all duration-75"
                    style={{ height: `${Math.max(4, h * 18)}px` }}
                  />
                ))}
              </div>
            )}
            {/* 语音输入按钮 */}
            {isRecording ? (
              <button
                type="button"
                onClick={handleVoiceInput}
                title="停止录音"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/90 text-destructive-foreground hover:bg-destructive transition-all duration-200 hover:scale-110 active:scale-95 relative"
              >
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-medium text-destructive tabular-nums whitespace-nowrap">
                  {Math.floor(recordingDuration / 60)}:{String(recordingDuration % 60).padStart(2, '0')}
                </span>
                <Square className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleVoiceInput}
                title="语音输入"
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-200",
                  isTranscribing
                    ? "bg-primary/20 text-primary hover:bg-primary/30"
                    : "bg-muted/50 text-muted-foreground hover:bg-primary/20 hover:text-primary hover:scale-110 hover:shadow-lg hover:shadow-primary/10 active:scale-95"
                )}
              >
                {isTranscribing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </button>
            )}
            {/* 单个按钮：根据输入状态自动切换发送/停止 */}
            <div className="relative">
              {loading && value.trim().length === 0 && onStop ? (
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
              {queueItems.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setQueuePanelOpen(v => !v);
                  }}
                  className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white hover:bg-destructive/80 z-10"
                  title="查看队列"
                >
                  {queueItems.length}
                </button>
              )}
            </div>
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
