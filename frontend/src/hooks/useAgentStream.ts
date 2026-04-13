import { useState, useCallback, useRef } from "react";
import {
  executeStream,
  type ExecuteStreamSessionOptions,
} from "@/api/tauri-api";

/**
 * React Hook：管理流式执行（agent_execute）的请求状态
 *
 * - 自动维护 streaming / error 状态
 * - 支持 AbortController 取消正在进行的请求
 * - 同一时刻只允许一个流式请求（新请求会取消前一个）
 *
 * 使用示例：
 * ```tsx
 * const { streaming, error, execute, abort } = useAgentStream();
 *
 * const handleSend = async () => {
 *   await execute("帮我写个排序算法", { agentId: "main" }, (chunk) => {
 *     setOutput((prev) => prev + chunk);
 *   });
 * };
 * ```
 */
export function useAgentStream() {
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // 当前进行中的请求控制器，用于主动取消
  const abortRef = useRef<AbortController | null>(null);

  /**
   * 发起一次流式执行请求
   * @param content - 用户输入内容
   * @param sessionOpts - 会话标识（backendSessionId 或 agentId 二选一）
   * @param onChunk - 收到文本块时的回调
   * @returns Promise，流结束时 resolve，出错时 reject
   */
  const execute = useCallback(
    async (
      content: string,
      sessionOpts: ExecuteStreamSessionOptions,
      onChunk: (text: string) => void
    ): Promise<void> => {
      // 取消上一次未完成的请求（旧 controller 的 signal 触发后，旧 onDone 会被调用，
      // 但我们通过 currentController 守卫确保只有当前请求才能修改状态）
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStreaming(true);
      setError(null);

      return new Promise<void>((resolve, reject) => {
        executeStream(content, sessionOpts, {
          onChunk,
          onDone: (err, aborted) => {
            // 只有仍是当前活跃请求时才更新状态，防止旧请求的 onDone 覆盖新请求的状态
            if (abortRef.current !== controller) return;
            setStreaming(false);
            if (err && !aborted) {
              // 非主动取消的错误才上报
              setError(err);
              reject(err);
            } else {
              resolve();
            }
          },
          signal: controller.signal,
        }).catch((err: unknown) => {
          // executeStream 本身抛出的同步异常（如参数校验）
          // 同样检查是否仍是当前活跃请求
          if (abortRef.current !== controller) return;
          setStreaming(false);
          const e = err instanceof Error ? err : new Error(String(err));
          setError(e);
          reject(e);
        });
      });
    },
    []
  );

  /**
   * 主动中止当前流式请求
   * 触发 AbortSignal，executeStream 会调用 onDone(null, true)
   * onDone 内部守卫会处理 streaming=false，此处不重复设置以避免双重调用
   */
  const abort = useCallback(() => {
    abortRef.current?.abort();
    // 中止后将 abortRef 置空，使 onDone 守卫跳过状态更新（streaming 由 onDone 负责重置）
    // 但为了确保 streaming 在所有路径下都能重置（如 executeStream 不调用 onDone 的极端情况），
    // 保留此处的 setStreaming(false) 调用
    setStreaming(false);
  }, []);

  return {
    /** 是否正在进行流式请求 */
    streaming,
    /** 最近一次非取消错误，无错误时为 null */
    error,
    /** 发起流式执行 */
    execute,
    /** 中止当前请求 */
    abort,
  };
}
