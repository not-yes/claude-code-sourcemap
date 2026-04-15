import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Github, Download, Upload, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

export function ConfigSyncPanel() {
  const [repoUrl, setRepoUrl] = useState("https://github.com/not-yes/config-sync-hub");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<"pull" | "push" | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const sync = async (direction: "pull" | "push") => {
    if (!repoUrl.trim()) {
      toast.error("请填写 GitHub 仓库地址");
      return;
    }
    if (!token.trim()) {
      toast.error("请填写 Personal Access Token");
      return;
    }

    setLoading(true);
    setAction(direction);
    setMessage(null);
    toast.info(direction === "pull" ? "正在从 GitHub 拉取配置..." : "正在推送到 GitHub...");

    try {
      const cmd = direction === "pull" ? "sync_config_pull" : "sync_config_push";
      await invoke(cmd, {
        repoUrl: repoUrl.trim(),
        token: token.trim()
      });

      setLastSync(new Date().toLocaleString("zh-CN"));
      const successMsg = direction === "pull" ? "配置拉取成功" : "配置推送成功";
      setMessage({ type: "success", text: successMsg });
      toast.success(successMsg);
    } catch (error) {
      console.error("同步失败:", error);
      const errorMessage = error instanceof Error ? error.message : "未知错误";
      setMessage({ type: "error", text: `同步失败: ${errorMessage}` });
      toast.error(`同步失败: ${errorMessage}`);
    } finally {
      setLoading(false);
      setAction(null);
    }
  };

  return (
    <div className="space-y-6 p-6 max-w-xl">
      {/* 标题 */}
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2 text-foreground">
          <Github className="w-5 h-5 text-primary" />
          GitHub 配置同步
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          从 GitHub 仓库同步 settings.json、agents 和 skills 配置
        </p>
      </div>

      {/* 仓库配置 */}
      <div className="space-y-4 p-4 border border-border rounded-lg bg-card/50">
        <h4 className="text-sm font-medium text-foreground">仓库配置</h4>

        <div className="space-y-2">
          <label className="text-sm text-foreground">GitHub 仓库地址</label>
          <Input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/org/repo"
            className="bg-background"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm text-foreground">Personal Access Token</label>
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_xxxxxxxxxxxx"
            className="bg-background"
          />
          <p className="text-xs text-muted-foreground">
            需要 repo 权限的 Token，仅保存在本地
          </p>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-3">
        <Button
          onClick={() => sync("pull")}
          disabled={loading}
          className="flex-1"
        >
          {loading && action === "pull" ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Download className="w-4 h-4 mr-2" />
          )}
          {loading && action === "pull" ? "拉取中..." : "从 GitHub 拉取"}
        </Button>

        <Button
          onClick={() => sync("push")}
          disabled={loading}
          variant="outline"
          className="flex-1 text-foreground dark:text-foreground"
        >
          {loading && action === "push" ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Upload className="w-4 h-4 mr-2" />
          )}
          {loading && action === "push" ? "推送中..." : "推送到 GitHub"}
        </Button>
      </div>

      {/* 状态显示 - 使用语义化颜色 */}
      {message && (
        <div className={`flex items-start gap-3 p-4 rounded-lg border ${
          message.type === "success"
            ? "bg-green-50 dark:bg-green-950/80 border-green-200 dark:border-green-800"
            : "bg-red-50 dark:bg-red-950/80 border-red-200 dark:border-red-800"
        }`}>
          <div className={message.type === "success" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
            {message.type === "success" ? <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />}
          </div>
          <div className="flex-1">
            <p className={`text-sm font-medium ${message.type === "success" ? "text-green-800 dark:text-green-100" : "text-red-800 dark:text-red-100"}`}>{message.text}</p>
          </div>
        </div>
      )}

      {/* 最后同步时间 */}
      {lastSync && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary" className="bg-secondary/50">
            最后同步: {lastSync}
          </Badge>
        </div>
      )}

      {/* 帮助信息 - 使用 muted 背景语义化配色 */}
      <div className="p-4 border border-border rounded-lg bg-muted/30 dark:bg-muted/20">
        <h4 className="text-sm font-medium mb-2 text-foreground flex items-center gap-1.5">
          <span className="text-primary">💡</span> 使用说明
        </h4>
        <ul className="text-sm space-y-2 text-muted-foreground">
          <li className="flex items-start gap-2">
            <code className="text-xs bg-background dark:bg-background/80 px-1.5 py-0.5 rounded border border-border text-foreground shrink-0 mt-0.5">拉取</code>
            <span>从 GitHub 下载配置到本地 ~/.claude/</span>
          </li>
          <li className="flex items-start gap-2">
            <code className="text-xs bg-background dark:bg-background/80 px-1.5 py-0.5 rounded border border-border text-foreground shrink-0 mt-0.5">推送</code>
            <span>将本地配置上传到 GitHub 仓库</span>
          </li>
          <li className="flex items-start gap-2">
            <code className="text-xs bg-background dark:bg-background/80 px-1.5 py-0.5 rounded border border-border text-foreground shrink-0 mt-0.5">安全</code>
            <span>Token 仅保存在本地，敏感信息不会上传</span>
          </li>
        </ul>
      </div>

      {/* 快速链接 */}
      <div className="text-center">
        <a
          href="https://github.com/not-yes/config-sync-hub"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:text-primary/80 dark:text-primary/90 dark:hover:text-primary hover:underline"
        >
          查看配置仓库 →
        </a>
      </div>
    </div>
  );
}