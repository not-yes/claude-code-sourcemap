import type { ReactNode } from "react";

/** 第三列顶栏：高度/内边距与第二列搜索条对齐；标题区可拖拽移动窗口（Tauri） */
export function ContentHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-6">
      <h2
        className="min-w-0 flex-1 cursor-default select-none font-semibold text-foreground"
        data-tauri-drag-region
      >
        {title}
      </h2>
      {actions && (
        <div
          className="flex shrink-0 items-center"
          data-tauri-drag-region="false"
        >
          {actions}
        </div>
      )}
    </header>
  );
}
