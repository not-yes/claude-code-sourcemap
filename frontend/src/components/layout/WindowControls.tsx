import { useEffect, useState } from "react";
import { checkIsTauri } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function WindowControls() {
  const [isTauri, setIsTauri] = useState(false);

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

  return (
    <div className="flex items-center justify-center gap-1.5 py-2 shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleClose}
            className="w-3 h-3 rounded-full bg-[#ff5f57] hover:bg-[#ff7b74] transition-all duration-200"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8} className="text-xs">
          关闭
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleMinimize}
            className="w-3 h-3 rounded-full bg-[#febc2e] hover:bg-[#fecf5a] transition-all duration-200"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8} className="text-xs">
          最小化
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleMaximize}
            className="w-3 h-3 rounded-full bg-[#28c840] hover:bg-[#4fd657] transition-all duration-200"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={8} className="text-xs">
          最大化
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
