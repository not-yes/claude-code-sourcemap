import type { ReactNode } from "react";

/**
 * Tauri WebView 根容器（整窗客户区）。
 * 与 `ui/card` 无关：Card 仅用于应用内部内容块；勿用 Card 充当窗口壳。
 *
 * 布局铺满、无外边距，与系统坐标一致；与桌面的层次由 `shadow: true` + `set_shadow` 处理。
 */
export function AppWindow({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-background">
      {children}
    </div>
  );
}
