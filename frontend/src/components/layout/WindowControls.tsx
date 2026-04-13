import { useEffect, useState } from "react";
import { checkIsTauri } from "@/lib/utils";

export function WindowControls() {
  const [isTauri, setIsTauri] = useState(false);

  useEffect(() => {
    setIsTauri(checkIsTauri());
  }, []);

  if (!isTauri) return null;

  const handleClose = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().close();
  };

  const handleMinimize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().minimize();
  };

  const handleMaximize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().toggleMaximize();
  };

  return (
    <div className="flex items-center justify-center gap-1 py-2 shrink-0">
      <button
        type="button"
        onClick={handleClose}
        className="w-3 h-3 rounded-full bg-[#ff5f57] hover:bg-[#ff7b74] transition-colors"
        title="关闭"
      />
      <button
        type="button"
        onClick={handleMinimize}
        className="w-3 h-3 rounded-full bg-[#febc2e] hover:bg-[#fecf5a] transition-colors"
        title="最小化"
      />
      <button
        type="button"
        onClick={handleMaximize}
        className="w-3 h-3 rounded-full bg-[#28c840] hover:bg-[#4fd657] transition-colors"
        title="最大化"
      />
    </div>
  );
}
