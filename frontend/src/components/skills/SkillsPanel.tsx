import { useState, useEffect } from "react";
import {
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
  type SkillDetail,
} from "@/api/tauri-api";
import { useSkills } from "@/hooks/useSkills";
import { useAppStore } from "@/stores/appStore";
import { SkillsMarketplace } from "./SkillsMarketplace";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ContentHeader } from "@/components/layout/ContentHeader";

/** 从 SKILL.md 格式内容解析出 guidance 和 frontmatter 字段 */
function parseSkillContent(content: string): {
  description: string;
  category: string;
  guidance: string;
  trigger_patterns: string[];
  suggested_tools: string[];
  suggested_action?: string;
} {
  const def = { description: "", category: "general", guidance: "", trigger_patterns: [] as string[], suggested_tools: [] as string[] };
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) {
    const firstLine = content.split("\n")[0]?.trim().replace(/^#\s*/, "") ?? "";
    return { ...def, description: firstLine, guidance: content };
  }
  const front = match[1];
  const body = content.slice(match[0].length).trim();
  const map: Record<string, string> = {};
  for (const line of front.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      map[k] = v;
    }
  }
  const trigger_patterns = map.trigger_patterns ? map.trigger_patterns.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const suggested_tools = map.suggested_tools ? map.suggested_tools.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const suggested_action = map.suggested_action?.trim() || undefined;
  return {
    description: map.description ?? def.description,
    category: map.category ?? def.category,
    guidance: body,
    trigger_patterns,
    suggested_tools,
    ...(suggested_action ? { suggested_action } : {}),
  };
}

/** 对含特殊字符的 YAML 值加引号，避免解析错误 */
function yamlQuote(val: string): string {
  if (!val) return val;
  const needsQuote = /[:#{}\n"'\\\u005B\u005D]/.test(val) || val.trim() !== val;
  if (!needsQuote) return val;
  return `"${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/** 从 SkillDetail 构建可编辑的完整内容 */
function buildEditableContent(d: SkillDetail): string {
  const desc = d.description || "";
  const cat = d.category || "general";
  const ver = d.version || "1.0.0";
  const lines = [
    "---",
    `name: ${yamlQuote(d.name)}`,
    `description: ${yamlQuote(desc)}`,
    `category: ${yamlQuote(cat)}`,
    `version: ${yamlQuote(ver)}`,
    `trigger_patterns: ${(d.trigger_patterns ?? []).join(", ")}`,
    `suggested_tools: ${(d.suggested_tools ?? []).join(", ")}`,
  ];
  if (d.suggested_action) {
    lines.push(`suggested_action: ${yamlQuote(d.suggested_action)}`);
  }
  lines.push("---", "");
  return lines.join("\n") + (d.guidance ?? "");
}

export function SkillsPanel() {
  const selectedSkillId = useAppStore((s) => s.selectedSkillId);
  const setSelectedSkill = useAppStore((s) => s.setSelectedSkill);
  const { skills, loading, error, reload } = useSkills();

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [content, setContent] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [deleteSkillId, setDeleteSkillId] = useState<string | null>(null);

  const selectedSkill = skills.find((s) => s.id === selectedSkillId);

  useEffect(() => {
    if (!selectedSkill) {
      setContent("");
      setContentError(null);
      return;
    }
    setContentLoading(true);
    setContentError(null);
    getSkill(selectedSkill.name)
      .then((d) => {
        setContent(buildEditableContent(d));
        setDirty(false);
      })
      .catch((e) => setContentError(e instanceof Error ? e.message : "读取失败"))
      .finally(() => setContentLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when selected skill id changes, not object ref
  }, [selectedSkill?.id]);

  const handleSave = async () => {
    if (!selectedSkill) return;
    setSaving(true);
    setSaveError(null);
    try {
      const parsed = parseSkillContent(content);
      await updateSkill(selectedSkill.name, {
        description: parsed.description,
        category: parsed.category,
        guidance: parsed.guidance,
        trigger_patterns: parsed.trigger_patterns,
        suggested_tools: parsed.suggested_tools,
        ...(parsed.suggested_action ? { suggested_action: parsed.suggested_action } : {}),
      });
      setDirty(false);
      reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    const raw = addName.trim();
    const name = raw.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!name) {
      setAddError("名称不能为空，仅支持字母、数字、中划线、下划线");
      return;
    }
    if (name.length > 64) {
      setAddError("名称长度不能超过 64 个字符");
      return;
    }
    setAddSubmitting(true);
    setAddError(null);
    try {
      await createSkill({ name });
      setAddOpen(false);
      setAddName("");
      await reload();
      setSelectedSkill(name);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setAddSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteSkillId) return;
    try {
      await deleteSkill(deleteSkillId);
      if (selectedSkillId === deleteSkillId) setSelectedSkill(null);
      setDeleteSkillId(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
      throw e;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ContentHeader
        title="Skills"
        actions={
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => reload()}
              disabled={loading}
              title="刷新"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <button
                  type="button"
                  title="新建 Skill"
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新建 Skill</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <div>
                  <label className="text-sm font-medium text-foreground">
                    Skill 名称
                  </label>
                  <Input
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder="例如: my-skill"
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    仅支持字母、数字、中划线、下划线
                  </p>
                </div>
                {addError && (
                  <p className="text-sm text-destructive">{addError}</p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>
                  取消
                </Button>
                <Button onClick={handleAdd} disabled={addSubmitting}>
                  {addSubmitting ? "创建中..." : "创建"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        }
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        {loading && skills.length === 0 ? (
          <div className="p-4 text-muted-foreground">加载中...</div>
        ) : error ? (
          <div className="p-4 text-destructive">{error}</div>
        ) : !selectedSkill ? (
          <SkillsMarketplace onInstallSuccess={reload} />
        ) : (
          <div className="flex-1 min-w-0 px-6 py-5 overflow-auto max-w-3xl">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-foreground">
                  {selectedSkill.name}
                </h4>
                <div className="flex gap-2">
                  {selectedSkill.source !== "bundled" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDeleteSkillId(selectedSkill.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saving || !dirty || selectedSkill.source === "bundled"}
                  >
                    {saving ? "保存中..." : "保存"}
                  </Button>
                </div>
              </div>
              {selectedSkill.description && (
                <p className="text-sm text-muted-foreground">
                  {selectedSkill.description}
                </p>
              )}
              <div className="text-xs text-muted-foreground">
                <span>category: {selectedSkill.category}</span>
                <span className="mx-2">|</span>
                <span>version: {selectedSkill.version}</span>
                <span className="mx-2">|</span>
                <span>source: {selectedSkill.source}</span>
              </div>
              {selectedSkill.source === "bundled" && (
                <p className="text-sm text-amber-600 dark:text-amber-500">
                  内置 Skill 不可编辑或删除
                </p>
              )}
              {saveError && (
                <p className="text-sm text-destructive">{saveError}</p>
              )}
              {contentLoading ? (
                <p className="text-sm text-muted-foreground">加载中...</p>
              ) : contentError ? (
                <p className="text-sm text-destructive">{contentError}</p>
              ) : (
                <div>
                  <label className="text-sm font-medium text-foreground block mb-2">
                    SKILL.md
                  </label>
                  <Textarea
                    value={content}
                    onChange={(e) => {
                      setContent(e.target.value);
                      setDirty(true);
                    }}
                    disabled={selectedSkill.source === "bundled"}
                    className="font-mono text-sm min-h-[300px]"
                    placeholder="---&#10;name: ...&#10;description: ...&#10;---&#10;&#10;# 技能说明"
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteSkillId}
        onOpenChange={(open) => !open && setDeleteSkillId(null)}
        title="删除 Skill"
        description="确定删除该 Skill？此操作不可恢复。"
        confirmLabel="删除"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}
