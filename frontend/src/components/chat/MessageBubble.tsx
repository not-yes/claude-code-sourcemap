import { useState, useCallback } from "react";
import { Brain, Wrench, XCircle, CheckCircle2, AlertCircle, AlertTriangle, Info, Copy, RotateCcw, ChevronDown, FileText, File, FileImage } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message, MessageContentBlock, TokenUsage } from "@/types";
import { MarkdownContent } from "./MarkdownContent";
import { toast } from "sonner";

interface MessageBubbleProps {
  message: Message;
  streaming?: boolean;
  onRetry?: () => void;
}

// -------- 执行过程子组件（轻量，无气泡包裹） --------

function extractThinkingSummary(content: string): string {
  // 按行分割，逐行查找有意义的文字
  const lines = content.split('\n');
  for (const line of lines) {
    // 去掉 markdown 语法符号：#、*、>、-、`、=、~
    const cleaned = line
      .replace(/^[\s#*>\-=~`]+/, '')  // 去掉行首符号
      .replace(/[*`_~#]/g, '')        // 去掉内联符号
      .trim();
    // 跳过太短或只剩符号/空格的行
    if (cleaned.length < 5) continue;
    // 截取前 80 个字符
    return cleaned.length > 80 ? cleaned.slice(0, 80) + '...' : cleaned;
  }
  return '';
}

function ThinkingBlock({ block }: { block: Extract<MessageContentBlock, { type: 'thinking' }> }) {
  if (!block.content) return null;
  const summary = block.content.length >= 10 ? extractThinkingSummary(block.content) : '';
  return (
    <details className="group/thinking border border-border/40 rounded-lg overflow-hidden bg-primary/5">
      <summary className="px-3 py-2 text-xs text-primary/80 cursor-pointer hover:bg-primary/10 select-none flex items-center gap-2 list-none transition-colors">
        <Brain className="h-3.5 w-3.5 opacity-70 shrink-0" />
        <span className="font-medium shrink-0">思考过程</span>
        {summary && (
          <span className="text-muted-foreground/70 truncate min-w-0 group-open/thinking:hidden">
            · {summary}
          </span>
        )}
        <ChevronDown className="h-3 w-3 opacity-50 ml-auto shrink-0 transition-transform group-open/thinking:rotate-180" />
      </summary>
      <div className="px-4 py-3 bg-primary/5 text-xs text-muted-foreground italic border-t border-border/30 leading-relaxed">
        <MarkdownContent content={block.content} className="text-[13px] leading-[1.6]" />
      </div>
    </details>
  );
}

function ToolUseBlock({ block }: { block: Extract<MessageContentBlock, { type: 'tool_use' }> }) {
  return (
    <details className="group/tool border border-border/40 rounded-lg overflow-hidden bg-accent/5">
      <summary className="px-3 py-2 text-xs text-accent/80 cursor-pointer hover:bg-accent/10 select-none flex items-center gap-2 list-none transition-colors">
        <Wrench className="h-3.5 w-3.5 opacity-70 shrink-0" />
        <span className="font-mono font-medium">{block.name}</span>
        <ChevronDown className="h-3 w-3 opacity-50 ml-auto transition-transform group-open/tool:rotate-180" />
      </summary>
      <pre className="px-4 py-3 text-xs overflow-auto max-h-48 bg-muted/40 text-muted-foreground border-t border-border/30 whitespace-pre-wrap break-all leading-relaxed">
        {JSON.stringify(block.input, null, 2)}
      </pre>
    </details>
  );
}

// 根据文件扩展名判断文件类型（放在组件外避免重复创建）
const getFileType = (filePath: string): 'text' | 'document' | 'image' | 'unknown' => {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const textTypes = ['md', 'txt', 'json', 'xml', 'html', 'css', 'js', 'ts', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'sh', 'bash', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'log'];
  const docTypes = ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'pdf'];
  const imageTypes = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'ico'];

  if (textTypes.includes(ext)) return 'text';
  if (docTypes.includes(ext)) return 'document';
  if (imageTypes.includes(ext)) return 'image';
  return 'unknown';
};

function ToolResultBlock({ block }: { block: Extract<MessageContentBlock, { type: 'tool_result' }> }) {
  const fileType = block.filePath ? getFileType(block.filePath) : 'unknown';

  // 根据文件类型选择图标
  const fileTypeIcon = fileType === 'document'
    ? <File className="h-3.5 w-3.5" />
    : fileType === 'image'
      ? <FileImage className="h-3.5 w-3.5" />
      : <FileText className="h-3.5 w-3.5" />;

  return (
    <details className="group/tool mb-2 border border-border/60 rounded-xl overflow-hidden bg-card/50">
      <summary className="px-4 py-2 bg-muted/50 flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer hover:bg-muted/60 select-none list-none transition-colors">
        {block.isError
          ? <XCircle className="h-4 w-4 text-destructive" />
          : <CheckCircle2 className="h-4 w-4 text-green-500 dark:text-green-400" />}
        <span>{block.toolName} 结果</span>

        {/* 文件类型指示器 */}
        {block.filePath && (
          <span className="ml-2 flex items-center gap-1 px-2 py-0.5 rounded bg-muted/60 text-muted-foreground">
            {fileTypeIcon}
            <span className="uppercase">{block.filePath.split('.').pop()}</span>
          </span>
        )}

        <ChevronDown className="h-3 w-3 opacity-50 ml-auto transition-transform group-open/tool:rotate-180" />
      </summary>

      {/* 结果内容 */}
      <pre className="px-4 py-3 text-xs overflow-auto max-h-64 bg-muted/40 text-muted-foreground whitespace-pre-wrap break-all border-t border-border/30">
        {typeof block.result === 'string' ? block.result : JSON.stringify(block.result, null, 2)}
      </pre>
    </details>
  );
}

function SystemBlock({ block }: { block: Extract<MessageContentBlock, { type: 'system' }> }) {
  if (!block.content) return null;
  return (
    <div className="px-2.5 py-1.5 rounded-md text-xs text-muted-foreground flex items-start gap-1.5">
      {block.level === 'error' && <AlertCircle className="h-3 w-3 shrink-0 text-destructive/70 mt-0.5" />}
      {block.level === 'warning' && <AlertTriangle className="h-3 w-3 shrink-0 text-yellow-500/70 dark:text-yellow-400/70 mt-0.5" />}
      {(block.level === 'info' || !block.level) && <Info className="h-3 w-3 shrink-0 opacity-50 mt-0.5" />}
      <span className="italic">{block.content}</span>
    </div>
  );
}

function UsageFooter({ usage }: { usage: TokenUsage }) {
  const allZero =
    (usage.inputTokens ?? 0) === 0 &&
    (usage.outputTokens ?? 0) === 0 &&
    (usage.cacheReadTokens ?? 0) === 0;
  if (allZero) return null;
  return (
    <div className="mt-2 pt-2 border-t border-border/30 text-xs text-muted-foreground flex gap-3">
      <span>输入: {usage.inputTokens}</span>
      <span>输出: {usage.outputTokens}</span>
      {usage.cacheReadTokens != null && <span>缓存读: {usage.cacheReadTokens}</span>}
    </div>
  );
}

function LoadingDots() {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <span className="inline-block size-1.5 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
      <span className="inline-block size-1.5 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
      <span className="inline-block size-1.5 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
    </span>
  );
}

// -------- 主组件 --------

// 执行过程块的类型
const PROCESS_BLOCK_TYPES = new Set(['thinking', 'tool_use', 'tool_result', 'system', 'status']);

function renderProcessBlock(block: MessageContentBlock, index: number) {
  switch (block.type) {
    case 'thinking':
      return <ThinkingBlock key={index} block={block} />;
    case 'tool_use':
      return <ToolUseBlock key={index} block={block} />;
    case 'tool_result':
      return <ToolResultBlock key={index} block={block} />;
    case 'system':
      return <SystemBlock key={index} block={block} />;
    default:
      return null;
  }
}

export function MessageBubble({
  message,
  streaming = false,
  onRetry,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const [hover, setHover] = useState(false);
  const isFailed = !isUser && message.content.startsWith("❌");

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      toast.success("已复制到剪贴板");
    } catch {
      toast.error("复制失败");
    }
  }, [message.content]);

  // 按原始顺序 interleaved 渲染所有块
  const renderAssistantContent = () => {
    if (message.contentBlocks && message.contentBlocks.length > 0) {
      const blocks = message.contentBlocks;
      const lastBlock = blocks[blocks.length - 1];
      const isLastBlockProcess = PROCESS_BLOCK_TYPES.has(lastBlock.type);

      // 收集所有 text 块内容
      const allTextContent = blocks
        .filter(b => b.type === 'text')
        .map(b => (b as Extract<MessageContentBlock, { type: 'text' }>).content)
        .join("\n");

      // 时间戳 + 操作按钮（复用）
      const actionBar = (
        <div className="flex items-center gap-1 mt-1">
          <span className="text-xs text-muted-foreground">
            {message.createdAt.toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {hover && !streaming && (
            <>
              <button
                type="button"
                className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground rounded"
                onClick={handleCopy}
                title="复制"
              >
                <Copy className="size-3" />
              </button>
              {isFailed && onRetry && (
                <button
                  type="button"
                  className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground rounded"
                  onClick={onRetry}
                  title="重试"
                >
                  <RotateCcw className="size-3" />
                </button>
              )}
            </>
          )}
        </div>
      );

      // 判断是否有任何 text 块
      const hasTextBlocks = allTextContent.length > 0;

      // 渲染每个块（按原始顺序）
      const renderedBlocks = blocks.map((block, i) => {
        if (PROCESS_BLOCK_TYPES.has(block.type)) {
          return (
            <div key={i} className="mb-1">
              {renderProcessBlock(block, i)}
            </div>
          );
        }
        if (block.type === 'text') {
          const isLastBlock = i === blocks.length - 1;
          return (
            <div
              key={i}
              className={cn(
                "text-sm text-foreground leading-relaxed",
                streaming && isLastBlock && "animate-cursor"
              )}
            >
              <MarkdownContent content={(block as Extract<MessageContentBlock, { type: 'text' }>).content} />
            </div>
          );
        }
        return null;
      });

      return (
        <>
          <div className="space-y-1">
            {renderedBlocks}
          </div>
          {streaming && (isLastBlockProcess || !hasTextBlocks) && <LoadingDots />}
          {message.usage && <UsageFooter usage={message.usage} />}
          {hasTextBlocks && actionBar}
        </>
      );
    }

    // 向后兼容：无 contentBlocks 时使用旧的 content 渲染（包在气泡里）
    if (message.content) {
      return (
        <>
          <MarkdownContent content={message.content} />
          {message.usage && <UsageFooter usage={message.usage} />}
        </>
      );
    }

    // streaming 中且无内容
    if (streaming) {
      return <LoadingDots />;
    }

    return null;
  };

  // assistant 消息：外层不包气泡，内部自行渲染
  if (!isUser) {
    return (
      <div
        className={cn(
          "group flex gap-2 mb-4 max-w-[85%] mr-auto animate-fade-in-up"
        )}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <div className="flex flex-col gap-0 min-w-0 w-full">
          {renderAssistantContent()}
          {/* 无 contentBlocks 的 fallback 需要时间戳 */}
          {(!message.contentBlocks || message.contentBlocks.length === 0) && (
            <div className="flex items-center gap-1 mt-1 px-1">
              <span className="text-xs text-muted-foreground">
                {message.createdAt.toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              {hover && !streaming && (
                <>
                  <button
                    type="button"
                    className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground rounded"
                    onClick={handleCopy}
                    title="复制"
                  >
                    <Copy className="size-3" />
                  </button>
                  {isFailed && onRetry && (
                    <button
                      type="button"
                      className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground rounded"
                      onClick={onRetry}
                      title="重试"
                    >
                      <RotateCcw className="size-3" />
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // user 消息：保持原有气泡样式
  return (
    <div
      className={cn(
        "group flex gap-2 mb-4 max-w-[85%] animate-fade-in-up",
        "ml-auto flex-row-reverse"
      )}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="rounded-2xl px-4 py-2.5 text-sm min-w-[100px] relative bg-primary/15 border border-primary/20 text-foreground shadow-sm shadow-primary/5">
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        <div className="flex items-center gap-1 mt-1 flex-row-reverse justify-start">
          <span className="text-xs text-muted-foreground">
            {message.createdAt.toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {hover && !streaming && (
            <button
              type="button"
              className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground rounded"
              onClick={handleCopy}
              title="复制"
            >
              <Copy className="size-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
