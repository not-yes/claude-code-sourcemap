import { useCallback, useRef } from "react";
import { useAppStore } from "@/stores/appStore";

export function ResizableDivider() {
  const listWidth = useAppStore((s) => s.contentListWidthByNav[s.activeNav]);
  const setContentListWidth = useAppStore((s) => s.setContentListWidth);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      startWidthRef.current = listWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startXRef.current;
        setContentListWidth(startWidthRef.current + delta);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [listWidth, setContentListWidth]
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className="w-2 shrink-0 cursor-col-resize flex-shrink-0 group relative"
      onMouseDown={handleMouseDown}
      style={{ touchAction: "none" }}
    >
      {/* 分隔线主体 - 默认透明，hover 时显示 */}
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/0 group-hover:bg-border/50 transition-all duration-200" />
      {/* hover 指示器 - 圆形 */}
      <div className="absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 bg-primary/0 group-hover:bg-primary/30 rounded-full transition-all duration-200" />
    </div>
  );
}
