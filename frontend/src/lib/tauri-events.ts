import { type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { PermissionRequest, PermissionDecision } from "@/types/permissions";

/**
 * 权限请求载荷：Sidecar 请求用户授权某项工具操作
 *
 * @deprecated 使用 `@/types/permissions` 中的 {@link PermissionRequest} 替代。
 * 此类型保留以兼容外部代码引用。
 */
export type PermissionRequestPayload = PermissionRequest;

/**
 * 权限决策载荷：前端回传给 Rust 后端的授权结果
 *
 * @deprecated 使用 `@/types/permissions` 中的 {@link PermissionDecision} 替代。
 */
export type PermissionDecisionPayload = PermissionDecision;

/**
 * Sidecar 连接管理器接口
 * 负责：启动/停止 Sidecar 进程、监听全局事件、维护连接状态
 */
export interface SidecarConnection {
  /** 启动 sidecar 进程（sidecar 路径由 Rust 侧自动解析） */
  start(cwd: string): Promise<void>;
  /** 停止 sidecar 进程 */
  stop(): Promise<void>;
  /** 检查 sidecar 是否正在运行 */
  isConnected(): Promise<boolean>;
  /**
   * 注册权限请求处理器
   * 当 Rust 后端收到来自 Sidecar 的 $/permissionRequest 时，
   * 会推送 agent:permission-request 事件，此处统一拦截并回传决策
   */
  onPermissionRequest(
    handler: (
      request: PermissionRequestPayload
    ) => Promise<PermissionDecisionPayload>
  ): void;
  /** 清理所有 Tauri 事件监听器，防止内存泄漏 */
  cleanup(): void;
}

/**
 * 创建一个 Sidecar 连接管理器实例
 *
 * 典型用法：
 * ```ts
 * const conn = createSidecarConnection();
 * await conn.start("/workspace");
 * conn.onPermissionRequest(async (req) => ({ granted: true }));
 * // ... 业务逻辑 ...
 * conn.cleanup();
 * ```
 */
export function createSidecarConnection(): SidecarConnection {
  // 所有已注册的 Tauri unlisten 函数，cleanup 时统一释放
  let unlisteners: UnlistenFn[] = [];
  return {
    async start(cwd: string) {
      // 启动 Sidecar 进程（sidecar 路径由 Rust 侧自动解析）
      await invoke("agent_start", { cwd });
      // 注意：agent:permission-request 事件由 ChatArea 中的 PermissionDialog 统一处理，
      // 此处不再注册重复监听，避免双重响应冲突。
    },

    async stop() {
      await invoke("agent_stop");
    },

    async isConnected() {
      return invoke<boolean>("agent_is_running");
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onPermissionRequest(_handler: (request: PermissionRequestPayload) => Promise<PermissionDecisionPayload>) {
      // 空实现 - 权限处理已迁移至 PermissionDialog 组件
      // 保留此接口以兼容 SidecarConnection API 契约
    },

    cleanup() {
      // 释放所有 Tauri 事件监听器
      unlisteners.forEach((fn) => fn());
      unlisteners = [];
    },
  };
}
