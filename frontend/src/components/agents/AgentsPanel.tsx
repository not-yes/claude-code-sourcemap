import { useState } from "react";
import { Bot, RefreshCw, Pencil, Save, ArrowLeft, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { useAgents } from "@/hooks/useAgents";
import { useSkills } from "@/hooks/useSkills";
import { useAgentDefinition } from "@/hooks/useAgentDefinition";
import { AgentSkillsMultiSelect } from "./AgentSkillsMultiSelect";
import {
  deleteAgent,
} from "@/api/tauri-api";
import { AgentAvatar } from "./AgentAvatar";
import { AgentMemoryPanel } from "./AgentMemoryPanel";
import { useAgentMetadataStore } from "@/stores/agentMetadataStore";

export function AgentsPanel() {
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const agentDetailViewId = useAppStore((s) => s.agentDetailViewId);
  const setAgentDetailViewId = useAppStore((s) => s.setAgentDetailViewId);
  const setSelectedAgent = useAppStore((s) => s.setSelectedAgent);
  const setAgentInfoDialogOpenId = useAppStore(
    (s) => s.setAgentInfoDialogOpenId
  );
  const { agents, loading, error, reload } = useAgents();
  const {
    skills: skillOptions,
    loading: skillsLoading,
    error: skillsError,
  } = useSkills();
  const getMeta = useAgentMetadataStore((s) => s.get);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const {
    content,
    description,
    skills,
    model,
    maxIterations,
    loading: defLoading,
    error: defError,
    dirty,
    updateContent,
    updateDescription,
    updateSkills,
    updateModel,
    updateMaxIterations,
    save,
  } = useAgentDefinition(selectedAgent ?? null);

  const [metaExpanded, setMetaExpanded] = useState(() => {
    try {
      return localStorage.getItem("agentMetaExpanded") === "true";
    } catch {
      return false;
    }
  });

  const setMetaExpandedWithPersist = (next: boolean) => {
    setMetaExpanded(next);
    try {
      localStorage.setItem("agentMetaExpanded", String(next));
    } catch {
      /* ignore */
    }
  };

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const iter = Math.min(
        1000,
        Math.max(1, Math.floor(Number(maxIterations)) || 1)
      );
      await save({
        soul: content,
        description: description.trim(),
        skills,
        model: model.trim(),
        max_iterations: iter,
      });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = () => {
    if (selectedAgent?.name !== "default") setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedAgent || selectedAgent.name === "default") return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAgent(selectedAgent.name);
      setSelectedAgent("main");
      setAgentDetailViewId(null);
      reload();
    } catch {
      setDeleteError("删除失败");
    } finally {
      setDeleting(false);
    }
  };

  if (error)
    return (
      <div className="p-4 text-destructive text-sm">
        {error}
      </div>
    );

  if (!selectedAgent) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-foreground dark:text-[hsl(0,0%,85%)]">
        <Bot size={48} className="mb-4 opacity-50 dark:opacity-70" />
        <p className="text-sm">从左侧列表选择 Agent 查看详情</p>
      </div>
    );
  }

  const meta = getMeta(selectedAgent.id);
  const displayName = meta?.displayName ?? selectedAgent.name;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b px-6 py-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            {agentDetailViewId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAgentDetailViewId(null)}
                title="返回对话"
                className="shrink-0"
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                返回对话
              </Button>
            )}
            <AgentAvatar
              agentId={selectedAgent.id}
              name={selectedAgent.name}
              size="md"
              onClick={() => setAgentInfoDialogOpenId(selectedAgent.id)}
            />
            <div>
              <h3 className="font-medium text-foreground">{displayName}</h3>
              <p className="text-xs text-muted-foreground">.{selectedAgent.ext}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="编辑 Agent 信息"
              onClick={() => setAgentInfoDialogOpenId(selectedAgent.id)}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:opacity-80 rounded transition-colors"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => reload()}
              disabled={loading}
              title="刷新"
              className="p-1.5 text-muted-foreground hover:text-foreground hover:opacity-80 rounded transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
            {selectedAgent.name !== "default" && (
              <button
                type="button"
                title="删除 Agent"
                onClick={handleDeleteClick}
                disabled={deleting}
                className="p-1.5 text-destructive hover:opacity-80 rounded transition-colors disabled:opacity-50"
              >
                <Trash2 className={cn("h-4 w-4", deleting && "animate-pulse")} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-3xl space-y-5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-foreground">Soul 定义</span>
            <Button
              size="sm"
              disabled={!dirty || defLoading || saving}
              onClick={handleSave}
            >
              <Save className="mr-1 h-4 w-4" />
              保存
            </Button>
          </div>
        {defError && (
          <p className="mb-2 text-sm text-destructive">{defError}</p>
        )}
        {saveError && (
          <p className="mb-2 text-sm text-destructive">{saveError}</p>
        )}
        {deleteError && (
          <p className="mb-2 text-sm text-destructive">{deleteError}</p>
        )}
        <ConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          title="删除 Agent"
          description={`确定删除 Agent「${selectedAgent?.name ?? ""}」？此操作不可恢复。`}
          confirmLabel="删除"
          variant="destructive"
          onConfirm={handleDeleteConfirm}
        />

        {defLoading ? (
          <p className="py-4 text-sm text-muted-foreground">加载中...</p>
        ) : (
          <>
            <Textarea
              value={content}
              onChange={(e) => updateContent(e.target.value)}
              placeholder={`Agent 定义 (${selectedAgent.ext})`}
              className="min-h-[min(20rem,50vh)] w-full resize-y font-mono text-sm shadow-none"
            />
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setMetaExpandedWithPersist(!metaExpanded)}
                className="flex items-center gap-2 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground px-1 -mx-1 py-1"
              >
                {metaExpanded ? (
                  <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 opacity-70" />
                )}
                更多属性
              </button>
              {metaExpanded && (
                <div className="rounded-xl border border-border/80 bg-muted/50 p-4 shadow-sm sm:p-5">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-x-5 sm:gap-y-4">
                    <div className="space-y-1.5 sm:col-span-2">
                      <label className="text-xs font-medium text-foreground">
                        模型 ID
                      </label>
                      <Input
                        value={model}
                        onChange={(e) => updateModel(e.target.value)}
                        placeholder="例如 gpt-4o-mini，留空则走后端默认"
                        className="font-mono shadow-none"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground">
                        最大迭代
                      </label>
                      <Input
                        type="number"
                        min={1}
                        max={1000}
                        value={maxIterations}
                        onChange={(e) =>
                          updateMaxIterations(
                            Math.min(
                              1000,
                              Math.max(1, parseInt(e.target.value, 10) || 1)
                            )
                          )
                        }
                        className="font-mono shadow-none sm:max-w-[8rem]"
                      />
                      <p className="text-[11px] text-muted-foreground">范围 1–1000</p>
                    </div>

                    <div className="space-y-1.5 sm:col-span-2">
                      <label className="text-xs font-medium text-foreground">
                        描述
                      </label>
                      <Input
                        value={description}
                        onChange={(e) => updateDescription(e.target.value)}
                        placeholder="可选，简短说明该 Agent 用途"
                        className="shadow-none"
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <label className="text-xs font-medium text-foreground">
                          Skills
                        </label>
                        <span className="text-[11px] text-muted-foreground">
                          来自后端已注册技能，可多选
                        </span>
                      </div>
                      <AgentSkillsMultiSelect
                        options={skillOptions}
                        value={skills}
                        onChange={updateSkills}
                        disabled={defLoading || saving}
                        loading={skillsLoading}
                        error={skillsError}
                      />
                    </div>

                  </div>
                  <div className="mt-5 border-t border-border/60 pt-4">
                    <p className="mb-3 text-xs font-medium text-foreground">
                      记忆管理（服务端）
                    </p>
                    <AgentMemoryPanel agentId={selectedAgent.name} />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
