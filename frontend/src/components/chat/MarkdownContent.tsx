import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

function CodeBlock({ children, className }: { children?: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);

  const code = children?.toString() ?? "";

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silent fail
    }
  }, [code]);

  return (
    <div className="relative group my-4">
      <pre
        className={cn(
          "rounded-lg px-4 py-3 overflow-x-auto text-[13px] text-foreground/80 border-l-2 border-primary/40 bg-muted/20",
          "font-mono leading-relaxed",
          className
        )}
      >
        <code className="bg-transparent text-inherit">{children}</code>
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className={cn(
          "absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded text-[11px]",
          "bg-muted/60 border border-border/40",
          "opacity-0 group-hover:opacity-100 transition-all duration-200",
          "hover:bg-muted/80 text-muted-foreground hover:text-foreground"
        )}
        title="复制代码"
      >
        {copied ? (
          <>
            <Check size={11} className="text-green-600 dark:text-green-400" />
            <span className="text-green-600 dark:text-green-400">已复制</span>
          </>
        ) : (
          <>
            <Copy size={11} />
            <span>复制</span>
          </>
        )}
      </button>
    </div>
  );
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  if (!content) return null;

  return (
    <div
      className={cn(
        "markdown-content text-[15px] leading-[1.75] text-foreground",
        // Paragraphs - more breathing room
        "[&_p]:my-4 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
        // Headings - refined hierarchy
        "[&_h1]:text-[1.35em] [&_h1]:font-semibold [&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:tracking-tight",
        "[&_h2]:text-[1.15em] [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:tracking-tight",
        "[&_h3]:text-[1em] [&_h3]:font-medium [&_h3]:mt-4 [&_h3]:mb-1.5",
        "[&_h4]:text-[0.95em] [&_h4]:font-medium [&_h4]:mt-3 [&_h4]:mb-1",
        // Links - subtle with primary color
        "[&_a]:text-primary [&_a]:no-underline [&_a]:border-b [&_a]:border-primary/30 [&_a]:transition-all [&_a]:hover:border-primary/60 [&_a]:hover:text-primary",
        // Blockquote - editorial style
        "[&_blockquote]:border-l-[3px] [&_blockquote]:border-primary/50 [&_blockquote]:bg-primary/[0.03] [&_blockquote]:rounded-r-md [&_blockquote]:py-2.5 [&_blockquote]:px-4 [&_blockquote]:not-italic [&_blockquote]:text-muted-foreground [&_blockquote]:my-4",
        // Lists - cleaner
        "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-1 [&_li]:leading-relaxed",
        "[&_li_p]:my-1",
        // Images
        "[&_img]:max-w-full [&_img]:rounded-lg [&_img]:my-4",
        // Tables - cleaner, no vertical lines
        "[&_table]:w-full [&_table]:my-4 [&_table]:text-sm",
        "[&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground [&_th]:border-b [&_th]:border-border/30",
        "[&_td]:px-4 [&_td]:py-2.5 [&_td]:text-foreground/80 [&_td]:border-b [&_td]:border-border",
        "[&_tr]:border-b [&_tr]:border-border [&_tr]:last:border-b-0",
        "[&_tr]:hover:[&_td]:bg-muted/15",
        // HR
        "[&_hr]:border-0 [&_hr]:h-px [&_hr]:bg-gradient-to-r [&_hr]:from-transparent [&_hr]:via-border/50 [&_hr]:to-transparent [&_hr]:my-6",
        // Inline code
        "[&_code]:text-[0.9em] [&_code]:font-mono [&_code]:bg-muted/60 [&_code]:px-[0.35em] [&_code]:py-[0.15em] [&_code]:rounded [&_code]:text-foreground/90",
        // Strong
        "[&_strong]:font-semibold [&_strong]:text-foreground",
        // Em
        "[&_em]:text-muted-foreground/80",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children, ...props }) => (
            <CodeBlock {...props}>{children}</CodeBlock>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
