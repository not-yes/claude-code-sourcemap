import { useEffect, useRef, useState, useCallback } from "react";
import {
  createSidecarConnection,
  type SidecarConnection,
  type PermissionRequestPayload,
  type PermissionDecisionPayload,
} from "@/lib/tauri-events";

/**
 * React Hook：管理 Sidecar 连接的完整生命周期
 *
 * - 组件挂载时自动创建连接实例
 * - 组件卸载时自动清理所有 Tauri 事件监听器
 * - 提供 start / stop / checkConnection 等操作方法
 * - 以响应式状态暴露连接状态和错误信息
 */
export function useSidecar() {
  const connRef = useRef<SidecarConnection | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 挂载标志：组件卸载后阻止异步回调继续调用 setState
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    // 创建连接实例，组件整个生命周期复用同一个实例
    const conn = createSidecarConnection();
    connRef.current = conn;

    return () => {
      mountedRef.current = false;
      // 组件卸载时释放所有 Tauri 事件监听器
      conn.cleanup();
      connRef.current = null;
    };
  }, []);

  /**
   * 启动 Sidecar 进程
   * @param cwd - 工作目录（sidecar 路径由 Rust 侧自动解析）
   */
  const start = useCallback(async (cwd: string) => {
    try {
      setError(null);
      await connRef.current?.start(cwd);
      if (!mountedRef.current) return;
      setConnected(true);
    } catch (e) {
      if (!mountedRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setConnected(false);
    }
  }, []);

  /**
   * 停止 Sidecar 进程
   */
  const stop = useCallback(async () => {
    try {
      await connRef.current?.stop();
      if (!mountedRef.current) return;
      setConnected(false);
    } catch (e) {
      if (!mountedRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }, []);

  /**
   * 主动检查 Sidecar 是否正在运行，并同步更新 connected 状态
   * @returns 是否正在运行
   */
  const checkConnection = useCallback(async () => {
    const isRunning = (await connRef.current?.isConnected()) ?? false;
    if (mountedRef.current) {
      setConnected(isRunning);
    }
    return isRunning;
  }, []);

  /**
   * 注册权限请求处理器（透传给底层连接实例）
   * 调用时机：组件挂载后、start() 之前均可注册
   */
  const onPermissionRequest = useCallback(
    (
      handler: (
        request: PermissionRequestPayload
      ) => Promise<PermissionDecisionPayload>
    ) => {
      connRef.current?.onPermissionRequest(handler);
    },
    []
  );

  return {
    /** Sidecar 当前是否已连接 */
    connected,
    /** 最近一次操作的错误信息，无错误时为 null */
    error,
    /** 启动 Sidecar */
    start,
    /** 停止 Sidecar */
    stop,
    /** 检查并刷新连接状态 */
    checkConnection,
    /** 注册权限请求处理器 */
    onPermissionRequest,
    /**
     * 获取底层连接实例（高级用法）
     * 注意：此方法避免在 render 期间直接访问 ref
     */
    getConnection: () => connRef.current,
  };
}
