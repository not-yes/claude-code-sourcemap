import type { SessionItem } from "@/api/tauri-api";

/**
 * 匹配 XML-like `<tag>…</tag>` 块（小写标签名，可选属性，多行内容）。
 * 与 CLI utils/displayTags.ts 中的 XML_TAG_BLOCK_PATTERN 一致，
 * 用于清理系统注入的 wrapper tags（如 <command-name>、<ide_opened_file>、
 * <bash-input> 等），避免它们出现在会话标题中。
 */
const XML_TAG_BLOCK_PATTERN = /<([a-z][\w-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>\n?/g;

/**
 * 去除 display-unfriendly 的 XML 标签块。
 * 如果去除后结果为空，返回原始文本（保证至少显示点什么）。
 */
function stripDisplayTags(text: string): string {
  const result = text.replace(XML_TAG_BLOCK_PATTERN, "").trim();
  return result || text;
}

/**
 * 去除 display-unfriendly 的 XML 标签块。
 * 如果去除后结果为空，返回空字符串（用于 fallback 链检测）。
 */
function stripDisplayTagsAllowEmpty(text: string): string {
  return text.replace(XML_TAG_BLOCK_PATTERN, "").trim();
}

/**
 * 检测文本是否只有 slash command（如 "/clear"）。
 */
function extractSlashCommand(text: string): string | null {
  const stripped = stripDisplayTagsAllowEmpty(text);
  if (!stripped) return null;
  // 匹配 /command 或 /command args
  const match = stripped.match(/^\/(\S+)(?:\s+(.*))?$/);
  if (!match) return null;
  const [, name, args] = match;
  // 如果有有意义的参数，显示完整命令
  if (args?.trim()) {
    return `/${name} ${args.trim()}`;
  }
  return `/${name}`;
}

/**
 * 检测并提取 bash input。
 */
function extractBashInput(text: string): string | null {
  const bashMatch = text.match(/<bash-input>([\s\S]*?)<\/bash-input>/);
  if (bashMatch && bashMatch[1]) {
    const input = bashMatch[1].trim();
    if (input) return `! ${input}`;
  }
  return null;
}

/**
 * 获取会话的显示标题。
 *
 * 借鉴 CLI /resume 的 getLogDisplayTitle 逻辑：
 * 1. 优先使用 session.title（customTitle / summary / metadata.name）
 * 2. 其次使用 session.task（firstPrompt），清理 XML tags、处理 slash command / bash input
 * 3. 再次使用 preview（首条用户消息预览），同样清理 tags
 * 4. 最后 fallback 到 session ID 前 8 位（与 CLI 一致）
 *
 * @param session 会话对象
 * @param preview 可选的首条用户消息预览
 * @param maxLength 最大显示长度，超出时截断并添加 "…"
 */
export function getSessionDisplayTitle(
  session: SessionItem,
  preview?: string,
  maxLength = 40
): string {
  // 1. 优先使用 title
  if (session.title?.trim()) {
    const title = stripDisplayTags(session.title.trim());
    if (title) {
      return title.length > maxLength
        ? title.slice(0, maxLength) + "…"
        : title;
    }
  }

  // 2. 使用 task（firstPrompt）
  if (session.task?.trim()) {
    let taskText = session.task.trim();

    // 2a. 尝试提取 bash input
    const bashInput = extractBashInput(taskText);
    if (bashInput) {
      return bashInput.length > maxLength
        ? bashInput.slice(0, maxLength) + "…"
        : bashInput;
    }

    // 2b. 尝试识别 slash command
    const slashCmd = extractSlashCommand(taskText);
    if (slashCmd) {
      return slashCmd.length > maxLength
        ? slashCmd.slice(0, maxLength) + "…"
        : slashCmd;
    }

    // 2c. 清理 display tags 后取第一行
    const stripped = stripDisplayTagsAllowEmpty(taskText);
    if (stripped) {
      const firstLine = stripped.split("\n")[0].trim();
      if (firstLine) {
        return firstLine.length > maxLength
          ? firstLine.slice(0, maxLength) + "…"
          : firstLine;
      }
    }
  }

  // 3. 使用 preview（首条用户消息）
  if (preview?.trim()) {
    const stripped = stripDisplayTagsAllowEmpty(preview.trim());
    if (stripped) {
      const singleLine = stripped.replace(/\s+/g, " ").trim();
      return singleLine.length > maxLength
        ? singleLine.slice(0, maxLength) + "…"
        : singleLine;
    }
  }

  // 4. 最后 fallback 到 session ID（与 CLI /resume 一致，取前 8 位）
  return session.id?.slice(0, 8) ?? "无标题会话";
}
