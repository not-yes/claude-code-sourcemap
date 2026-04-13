import { useMemo, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAgentMetadataStore } from "@/stores/agentMetadataStore";
import { AvatarSelector } from "./AvatarSelector";
import { generateDiceBearUrl } from "@/lib/dicebear";
import type { AgentItem } from "@/hooks/useAgents";

interface AgentInfoDialogProps {
  agent: AgentItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface AgentFormData {
  displayName: string;
  avatarLetter: string;
  avatarImage?: string;
}

function useAgentFormData(agent: AgentItem | null): AgentFormData {
  const get = useAgentMetadataStore((s) => s.get);
  return useMemo(() => {
    if (!agent) {
      return { displayName: "", avatarLetter: "" };
    }
    const meta = get(agent.id);
    return {
      displayName: meta?.displayName ?? agent.name,
      avatarLetter: meta?.avatarLetter ?? "",
      avatarImage: meta?.avatarImage,
    };
  }, [agent, get]);
}

const FALLBACK_BG = "#6366f1"; // Indigo-500

function AgentInfoForm({
  agent,
  onSave,
  onCancel,
}: {
  agent: AgentItem;
  onSave: (data: AgentFormData) => void;
  onCancel: () => void;
}) {
  const initialData = useAgentFormData(agent);
  const [displayName, setDisplayName] = useState(initialData.displayName);
  const [avatarLetter, setAvatarLetter] = useState(initialData.avatarLetter);
  const [avatarImage, setAvatarImage] = useState<string | undefined>(initialData.avatarImage);

  // Reset form when initial data changes (agent changes)
  useEffect(() => {
    setDisplayName(initialData.displayName);
    setAvatarLetter(initialData.avatarLetter);
    setAvatarImage(initialData.avatarImage);
  }, [initialData]);

  const handleSave = () => {
    onSave({
      displayName: displayName.trim() || initialData.displayName,
      avatarLetter: avatarLetter.trim() || initialData.avatarLetter,
      avatarImage,
    });
  };

  // 生成 DiceBear 头像 URL
  const dicebearAvatarUrl = generateDiceBearUrl({
    seed: agent.id,
    style: 'toon-head',
    size: 128,
    radius: 50,
  });

  // 预览头像
  const renderAvatarPreview = () => {
    // 优先显示自定义图片
    if (avatarImage) {
      return (
        <img
          src={avatarImage}
          alt="Preview"
          className="w-full h-full object-cover"
        />
      );
    }

    // 其次显示 DiceBear 头像
    if (!avatarLetter) {
      return (
        <img
          src={dicebearAvatarUrl}
          alt="DiceBear avatar"
          className="w-full h-full object-cover"
        />
      );
    }

    // 最后显示字母
    const letter = avatarLetter.toUpperCase().slice(0, 2) || "?";
    return <span>{letter}</span>;
  };

  return (
    <div className="flex flex-col max-h-[70vh]">
      <div className="flex-1 overflow-y-auto space-y-6 py-2 pr-2 pointer-events-auto">
        {/* Agent 信息 */}
        <div className="space-y-3 p-4 bg-muted/30 rounded-lg">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Agent 名称</p>
            <p className="text-sm font-medium">{agent.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Agent ID</p>
            <p className="text-xs font-mono bg-background px-2 py-1 rounded inline-block">
              {agent.id}
            </p>
          </div>
        </div>

        {/* 头像和显示名称 */}
        <div className="flex items-center gap-4">
          {/* 头像预览 */}
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center font-semibold shrink-0 text-white overflow-hidden"
            style={{ backgroundColor: FALLBACK_BG }}
          >
            {renderAvatarPreview()}
          </div>
          
          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">显示名称</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={agent.name}
              className="pointer-events-auto"
            />
            <p className="text-xs text-muted-foreground">
              留空则使用 Agent 名称
            </p>
          </div>
        </div>

        {/* 头像选择器 */}
        <div>
          <label className="text-sm font-medium block mb-2">
            头像设置
          </label>
          <AvatarSelector
            agentId={agent.id}
            agentName={agent.name}
            currentImage={avatarImage}
            onImageSelect={(image) => {
              setAvatarImage(image);
              setAvatarLetter("");
            }}
            onClear={() => {
              setAvatarImage(undefined);
            }}
          />
        </div>

        {/* 字母头像设置 */}
        <div>
          <label className="text-sm font-medium block mb-2">
            或自定义字母头像
          </label>
          <div className="flex items-center gap-3">
            <Input
              value={avatarLetter}
              onChange={(e) => {
                setAvatarLetter(e.target.value.slice(0, 2).toUpperCase());
                setAvatarImage(undefined);
              }}
              placeholder={agent.name.slice(0, 2)}
              maxLength={2}
              className="w-24 text-center pointer-events-auto"
            />
            <p className="text-xs text-muted-foreground">
              输入 1-2 个字母
            </p>
          </div>
        </div>
      </div>
      <DialogFooter className="border-t pt-4 mt-4">
        <Button variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button onClick={handleSave}>保存</Button>
      </DialogFooter>
    </div>
  );
}

export function AgentInfoDialog({
  agent,
  open,
  onOpenChange,
}: AgentInfoDialogProps) {
  const setMeta = useAgentMetadataStore((s) => s.set);

  const handleSave = (data: AgentFormData) => {
    if (!agent) return;
    setMeta(agent.id, {
      displayName: data.displayName || undefined,
      avatarLetter: data.avatarLetter || undefined,
      avatarImage: data.avatarImage,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Agent 信息</DialogTitle>
        </DialogHeader>
        {agent && (
          <AgentInfoForm
            key={agent.id}
            agent={agent}
            onSave={handleSave}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
