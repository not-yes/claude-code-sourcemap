import { useEffect, useState } from 'react';
import { toast } from 'sonner';

/**
 * 全局Tauri环境检测Hook
 * 仅检测 Tauri 宿主环境是否存在，不做 Sidecar 健康检查。
 * Sidecar 健康状态由 App.tsx 的启动流程（useSidecar）统一管理。
 */
export function useTauriEnvironmentCheck() {
  const [isTauriReady, setIsTauriReady] = useState(false);

  useEffect(() => {
    // 检查 Tauri 宿主环境（异步包装以避免 effect 内直接 setState）
    const check = async () => {
      if (typeof window === 'undefined' || !('__TAURI__' in window)) {
        console.error('[TauriEnv] Tauri environment not detected in window object');
        toast.error('Tauri环境未检测到，请确保通过 npm run tauri:dev 启动应用');
        return;
      }

      console.log('[TauriEnv] Tauri environment detected');
      setIsTauriReady(true);
    };

    void check();
  }, []);

  return { isTauriReady };
}
