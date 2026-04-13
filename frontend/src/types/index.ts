// -------- 消息内容块类型 - 对应 Sidecar 流式事件 --------

export type MessageContentBlock =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolId: string; toolName: string; result: unknown; isError?: boolean; filePath?: string }
  | { type: 'system'; level: 'info' | 'warning' | 'error'; content: string }
  | { type: 'status'; content: string; meta?: Record<string, unknown> };

// -------- Token 使用量统计 --------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

// -------- 基础消息类型 --------

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;              // 保留：纯文本内容（向后兼容）
  contentBlocks?: MessageContentBlock[];  // 新增：结构化内容块
  createdAt: Date;
  usage?: TokenUsage;           // 新增：Token 使用量
}

// -------- 重导出所有共享类型 --------

export * from "./api";
export * from "./agents";
export * from "./skills";
export * from "./permissions";
export * from "./app";
