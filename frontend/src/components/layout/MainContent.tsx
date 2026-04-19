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

  if (activeNav === "stats") {
    return (
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <ContentHeader title="任务统计" />
        <StatsPanel />
      </div>
    );
  }

  if (activeNav === "agents") {
    const inDetailView = agentDetailViewId != null && agentDetailViewId !== "main";
    const detailAgent = agentDetailViewId
      ? agents.find((a) => a.id === agentDetailViewId)
      : null;
    const detailTitle = detailAgent
      ? (getMeta(detailAgent.id)?.displayName ?? detailAgent.name)
      : "Agent";

    if (inDetailView) {
      return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ContentHeader title={detailTitle} />
          <AgentsPanel />
        </div>
      );
    }
    const sessionTitle =
      selectedAgentId === "main"
        ? "主聊 (Master)"
        : selectedAgent
        ? agentDisplayName
        : "Agents";
    return (
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <ContentHeader title={sessionTitle} actions={chatHeaderAction} />
        <ChatArea agentId={selectedAgentId ?? "main"} />
      </div>
    );
  }

  if (activeNav === "cron") {
    return (
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <CronPanel />
      </div>
    );
  }

  if (activeNav === "skills") {
    return (
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <SkillsPanel />
      </div>
    );
  }

  if (activeNav === "settings") {
    return (
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <ContentHeader title="设置" />
        <SettingsPanel />
      </div>
    );
  }

  return null;
}
