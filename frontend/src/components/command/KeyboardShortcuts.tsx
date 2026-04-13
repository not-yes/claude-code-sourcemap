import { useEffect } from "react";
import { useAppStore } from "@/stores/appStore";

const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "metaKey" : "ctrlKey";

export function KeyboardShortcuts() {
  const setActiveNav = useAppStore((s) => s.setActiveNav);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e[mod as keyof KeyboardEvent] && e.key >= "1" && e.key <= "4") {
        const nav = (["agents", "stats", "cron", "settings"] as const)[
          parseInt(e.key, 10) - 1
        ];
        if (nav) {
          e.preventDefault();
          setActiveNav(nav);
        }
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [setActiveNav]);

  return null;
}
