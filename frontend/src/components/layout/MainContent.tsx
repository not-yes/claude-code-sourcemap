import { useAppStore } from "@/stores/appStore";
import { ChatArea } from "@/components/chat/ChatArea";
import { StatsPanel } from "@/components/stats/StatsPanel";
import { AgentsPanel } from "@/components/agents/AgentsPanel";
import { CronPanel } from "@/components/cron/CronPanel";
import { SkillsPanel } from "@/components/skills/SkillsPanel";
import { SettingsPanel } from "@/components/settings/SettingsPanel";

import { ContentHeader } from "@/components/layout/ContentHeader";
import { useAgents } from "@/hooks/useAgents";
import { useAgentMetadataStore } from "@/stores/agentMetadataStore";
import { cn } from "@/lib/utils";

export function MainContent() {
  const activeNav = useAppStore((s) => s.activeNav);
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const agentDetailViewId = useAppStore((s) => s.agentDetailViewId);
  const chatHeaderAction = useAppStore((s) => s.chatHeaderAction);
  const { agents } = useAgents();
  const getMeta = useAgentMetadataStore((s) => s.get);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const agentDisplayName = selectedAgent
    ? (getMeta(selectedAgent.id)?.displayName ?? selectedAgent.name)
    : "";

  const inDetailView = agentDetailViewId != null && agentDetailViewId !== "main";
  const detailAgent = agentDetailViewId
    ? agents.find((a) => a.id === agentDetailViewId)
    : null;
  const detailTitle = detailAgent
    ? (getMeta(detailAgent.id)?.displayName ?? detailAgent.name)
    : "Agent";
  const sessionTitle =
    selectedAgentId === "main"
      ? "主聊 (Master)"
      : selectedAgent
      ? agentDisplayName
      : "Agents";

  return (
    <div className="relative flex-1 flex flex-col min-w-0 min-h-0">
      {/* Agents Chat（始终挂载，用 CSS 控制显示/隐藏） */}
      <div
        className={cn("flex-1 flex flex-col min-w-0 min-h-0", {
          hidden: activeNav !== "agents" || inDetailView,
        })}
      >
        <ContentHeader title={sessionTitle} actions={chatHeaderAction} />
        <ChatArea agentId={selectedAgentId ?? "main"} />
      </div>

      {/* Agents Detail */}
      <div
        className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", {
          hidden: activeNav !== "agents" || !inDetailView,
        })}
      >
        <ContentHeader title={detailTitle} />
        <AgentsPanel />
      </div>

      {/* Stats */}
      <div
        className={cn("flex-1 flex flex-col min-w-0 min-h-0", {
          hidden: activeNav !== "stats",
        })}
      >
        <ContentHeader title="任务统计" />
        <StatsPanel />
      </div>

      {/* Cron */}
      <div
        className={cn("flex-1 flex flex-col min-w-0 min-h-0", {
          hidden: activeNav !== "cron",
        })}
      >
        <CronPanel />
      </div>

      {/* Skills */}
      <div
        className={cn("flex-1 flex flex-col min-w-0 min-h-0", {
          hidden: activeNav !== "skills",
        })}
      >
        <SkillsPanel />
      </div>

      {/* Settings */}
      <div
        className={cn("flex-1 flex flex-col min-w-0 min-h-0", {
          hidden: activeNav !== "settings",
        })}
      >
        <ContentHeader title="设置" />
        <SettingsPanel />
      </div>
    </div>
  );
}
