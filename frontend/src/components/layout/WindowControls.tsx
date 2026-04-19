import { useEffect, useState } from "react";
import { checkIsTauri } from "@/lib/utils";
import { X, Minus, Square, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function WindowControls() {
  const [isTauri, setIsTauri] = useState(false);
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);

  useEffect(() => {
    setIsTauri(checkIsTauri());
  }, []);

  if (!isTauri) return null;

  const handleClose = () => {
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().close();
    });
  };

  const handleMinimize = () => {
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().minimize();
    });
  };

  const handleMaximize = () => {
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().toggleMaximize();
    });
  };

  const buttons = [
    {
      id: "close",
      icon: X,
      label: "关闭",
      color: "bg-[#ff5f57] hover:bg-[#ff7b74]",
      iconColor: "text-white/80 group-hover:text-white",
      onClick: handleClose,
    },
    {
      id: "minimize",
      icon: Minus,
      label: "最小化",
      color: "bg-[#febc2e] hover:bg-[#fecf5a]",
      iconColor: "text-[#8a6000]/80 group-hover:text-[#8a6000]",
      onClick: handleMinimize,
    },
    {
      id: "maximize",
      icon: Square,
      label: "最大化",
      color: "bg-[#28c840] hover:bg-[#4fd657]",
      iconColor: "text-[#1a8a1a]/80 group-hover:text-[#1a8a1a]",
      onClick: handleMaximize,
    },
  ];

  return (
    <div className="flex items-center justify-center gap-2 py-2 shrink-0">
      {buttons.map(({ id, icon: Icon, label, color, iconColor, onClick }) => (
        <button
          key={id}
          type="button"
          onClick={onClick}
          onMouseEnter={() => setHoveredBtn(id)}
          onMouseLeave={() => setHoveredBtn(null)}
          className={cn(
            "group relative w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200",
            color,
            hoveredBtn === id && "scale-110"
          )}
          title={label}
        >
          <Icon
            size={12}
            className={cn("transition-all duration-200", iconColor)}
            strokeWidth={2.5}
            style={{
              opacity: hoveredBtn === id ? 1 : 0,
              transform: hoveredBtn === id ? "scale(1)" : "scale(0.5)",
            }}
          />
          <span
            className={cn(
              "absolute text-[10px] font-medium text-white/90 transition-all duration-200",
              hoveredBtn === id ? "opacity-100 -bottom-5" : "opacity-0 -bottom-3"
            )}
          >
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}
