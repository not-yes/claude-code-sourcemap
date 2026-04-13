import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createAgent } from "@/api/tauri-api";

interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (newName?: string) => void;
}

export function CreateAgentDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateAgentDialogProps) {
  const [name, setName] = useState("");
  const [soul, setSoul] = useState("You are a helpful assistant.");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setSoul("You are a helpful assistant.");
    setDescription("");
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("名称不能为空");
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      setError("名称只能包含字母、数字、下划线和连字符");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await createAgent({
        name: trimmed,
        soul: soul.trim() || undefined,
        description: description.trim() || undefined,
      });
      reset();
      onOpenChange(false);
      onSuccess(result.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建 Agent</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium mb-1.5 block">名称 *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="researcher"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground mt-1">
              仅支持字母、数字、下划线、连字符
            </p>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">描述</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="可选"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Soul</label>
            <Textarea
              value={soul}
              onChange={(e) => setSoul(e.target.value)}
              placeholder="You are a helpful assistant."
              rows={4}
              className="font-mono text-sm resize-none"
            />
          </div>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "创建中..." : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
