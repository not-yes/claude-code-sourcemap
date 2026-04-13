import { useEffect, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useAppStore } from "@/stores/appStore";
import { Settings, MessageSquare, Terminal, BarChart3, Bot, Clock, BookMarked } from "lucide-react";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const setActiveNav = useAppStore((s) => s.setActiveNav);
  const setSelectedAgent = useAppStore((s) => s.setSelectedAgent);
  const setAgentDetailViewId = useAppStore((s) => s.setAgentDetailViewId);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="输入命令..." />
      <CommandList>
        <CommandEmpty>无匹配命令</CommandEmpty>
        <CommandGroup heading="快捷操作">
          <CommandItem
            onSelect={() => {
              setActiveNav("agents");
              setSelectedAgent("main");
              setAgentDetailViewId(null);
              setOpen(false);
            }}
          >
            <MessageSquare />
            主聊 (Master)
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setActiveNav("stats");
              setOpen(false);
            }}
          >
            <BarChart3 />
            任务统计
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setActiveNav("agents");
              setOpen(false);
            }}
          >
            <Bot />
            Agents 列表
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setActiveNav("cron");
              setOpen(false);
            }}
          >
            <Clock />
            定时任务
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setActiveNav("skills");
              setOpen(false);
            }}
          >
            <BookMarked />
            Skills
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setActiveNav("settings");
              setOpen(false);
            }}
          >
            <Settings />
            打开设置
          </CommandItem>
          <CommandItem
            onSelect={() => {
              window.dispatchEvent(new CustomEvent("run-example-task"));
              setOpen(false);
            }}
          >
            <Terminal />
            执行示例任务
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
