// -------- 权限相关类型（统一定义，供 permissionStore 和 tauri-events 共同使用） --------

/**
 * 权限请求数据结构（对应 Sidecar $/permissionRequest 的 params）
 */
export interface PermissionRequest {
  /** 全局唯一请求 ID */
  requestId: string;
  /** 工具名称，如 bash、file_write */
  tool: string;
  /** 具体动作描述 */
  action: string;
  /** 涉及的文件路径（可选） */
  path?: string;
  /** 操作说明（可选） */
  description?: string;
  /** 工具输入参数（可选） */
  toolInput?: Record<string, unknown>;
}

/**
 * 权限决策结构
 */
export interface PermissionDecision {
  /** 是否授权 */
  granted: boolean;
  /** 是否记住本次决策 */
  remember?: boolean;
  /** 拒绝原因（仅 granted=false 时有意义） */
  denyReason?: string;
  /** AskUserQuestion 工具收集的用户答案 */
  answers?: Record<string, string>;
  /** ExitPlanMode 工具的更新输入 */
  updatedInput?: Record<string, unknown>;
}
