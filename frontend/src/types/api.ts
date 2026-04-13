// -------- Session 相关类型 --------

import type { MessageContentBlock, TokenUsage } from "./index";

export interface SessionItem {
  id: string;
  title?: string;
  task?: string;
  agent_id?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface SessionMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  contentBlocks?: MessageContentBlock[];
  usage?: TokenUsage;
  created_at?: string;
  [key: string]: unknown;
}

// -------- Checkpoint 相关类型 --------

export interface CheckpointListItem {
  id: string;
  created_at: string;
  step: number;
  tags: string[];
  size_bytes: number;
}

export interface SaveCheckpointResult {
  checkpoint_id: string;
  tag: string;
  step: number;
}

export interface RollbackCheckpointResult {
  checkpoint_id: string;
  step: number;
  todos_count: number;
  todos_done: number;
}

export interface TodoChanges {
  added: string[];
  removed: string[];
  completed: string[];
  reopened: string[];
}

export interface ContextChanges {
  messages_added: number;
  system_messages_changed: boolean;
  last_user_message: string | null;
  last_assistant_message: string | null;
}

export interface CompareCheckpointsResult {
  checkpoint_a_id: string;
  checkpoint_b_id: string;
  summary: string;
  step_diff: number;
  todo_diff: number;
  context_window_diff: number;
  todo_changes: TodoChanges;
  context_changes: ContextChanges;
}

export interface CheckpointTimelineResult {
  timeline: string;
  checkpoints: CheckpointListItem[];
}

export interface ExportCheckpointResult {
  json_data: string;
  metadata: {
    task_id: string;
    checkpoint_id: string;
    tags: string[];
    step: number;
  };
}

export interface ImportCheckpointResult {
  task_id: string;
  checkpoint_id: string;
  step: number;
  tags: string[];
}

export interface BatchDeleteCheckpointResult {
  checkpoint_id: string;
  success: boolean;
  error: string | null;
}

// -------- Cron 相关类型 --------

export interface CronLastResult {
  success: boolean;
  output: string;
  error?: string;
  duration_ms: number;
}

export interface CronJob {
  id: string;
  name: string;
  schedule_type: "cron" | "at" | "every";
  schedule: string;
  enabled: boolean;
  instruction: string;
  last_run?: number;
  next_run?: number;
  run_count: number;
  last_result?: CronLastResult;
}

export interface CronHistoryItem {
  run_id: string;
  success: boolean;
  output: string;
  error?: string;
  duration_ms: number;
  timestamp: number;
}

// -------- Tool 相关类型 --------

/** 工具描述结构（来自 sidecar listTools 方法） */
export interface ToolDefinition {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}
