import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GithubIcon, Download, CheckCircle, AlertCircle, Loader2, Eye, EyeOff, KeyRound } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

function SectionHeader({
  icon: Icon,
  title,
}: {
  icon: React.ElementType;
  title: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
        <Icon size={16} className="text-muted-foreground" />
        {title}
      </h4>
    </div>
  );
}

export function ConfigSyncPanel() {
  const REPO_URL = "https://github.com/not-yes/config-sync-hub";

  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [tokenVisible, setTokenVisible] = useState(false);
  const [tokenSaved, setTokenSaved] = useState(false);
  const [tokenSaving, setTokenSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    const loadCredentials = async () => {
      try {
        const config = await invoke<{ username: string | null; github_token: string | null }>("get_sync_config");
        if (config.username) setUsername(config.username);
        if (config.github_token) setToken(config.github_token);
      } catch (e) {
        console.error("加载同步配置失败:", e);
      }
    };
    loadCredentials();
  }, []);

  const saveUsername = async () => {
    if (!username.trim()) {
      toast.error("请填写用户名/组织名称");
      return;
    }
    try {
      await invoke("store_sync_username", { username: username.trim() });
      toast.success("用户名已保存");
    } catch (e) {
      console.error("保存用户名失败:", e);
      toast.error("保存用户名失败");
    }
  };

  const saveToken = async () => {
    if (!token.trim()) {
      toast.error("请填写 Token");
      return;
    }
    setTokenSaving(true);
    try {
      await invoke("store_github_token", { token: token.trim() });
      setTokenSaved(true);
      setTimeout(() => setTokenSaved(false), 2000);
      toast.success("Token 已保存到安全存储");
    } catch (e) {
      console.error("保存 GitHub Token 失败:", e);
      toast.error("保存 Token 失败");
    } finally {
      setTokenSaving(false);
    }
  };

  const pullConfig = async () => {
    if (!username.trim()) {
      toast.error("请填写用户名/组织名称");
      return;
    }
    if (!token.trim()) {
      toast.error("请填写 Personal Access Token");
      return;
    }

    try {
      await invoke("store_sync_config", {
        config: {
          username: username.trim(),
          github_token: token.trim()
        }
      });
    } catch (e) {
      console.error("保存凭据失败:", e);
    }

    setLoading(true);
    setMessage(null);
    toast.info("正在从 GitHub 拉取配置...");

    try {
      await invoke("sync_config_pull", {
        repoUrl: REPO_URL,
        username: username.trim(),
        token: token.trim()
      });

      setLastSync(new Date().toLocaleString("zh-CN"));
      setMessage({ type: "success", text: "配置拉取成功" });
      toast.success("配置拉取成功");
    } catch (error) {
      console.error("拉取失败:", error);
      const errorMessage = error instanceof Error ? error.message : "未知错误";
      setMessage({ type: "error", text: `拉取失败: ${errorMessage}` });
      toast.error(`拉取失败: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="px-6 py-5 max-w-2xl space-y-6">

      {/* 仓库配置 */}
      <div className="border-b p-4 space-y-4">
        <SectionHeader icon={GithubIcon} title="仓库配置" />

        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">GitHub 仓库地址</label>
          <Input
            value={REPO_URL}
            disabled
            className="bg-muted/50 cursor-not-allowed font-mono"
          />
          <p className="text-xs text-muted-foreground">
            配置同步仓库（固定）
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">用户名/组织名称</label>
          <div className="flex gap-2">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="例如: your-name"
              className="font-mono"
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveUsername();
              }}
            />
            <Button
              size="sm"
              onClick={() => void saveUsername()}
              disabled={!username.trim()}
              className="shrink-0"
            >
              保存
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            用于确定拉取哪个组织/用户的配置目录
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Personal Access Token</label>
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <Input
                type={tokenVisible ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxx"
                className="pr-10 font-mono"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setTokenVisible(!tokenVisible)}
                tabIndex={-1}
              >
                {tokenVisible ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <Button
              size="sm"
              onClick={saveToken}
              disabled={!token.trim() || tokenSaving}
              className="shrink-0"
            >
              {tokenSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : tokenSaved ? (
                "已保存 ✓"
              ) : (
                "保存"
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <KeyRound className="w-3 h-3" />
            需要 repo 权限的 Token，存储于系统密钥库
          </p>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="border-b p-4">
        <Button
          onClick={pullConfig}
          disabled={loading || !username.trim() || !token.trim()}
          className="w-full"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Download className="w-4 h-4 mr-2" />
          )}
          {loading ? "拉取中..." : "从 GitHub 拉取配置"}
        </Button>

        {/* 状态显示 */}
        {message && (
          <div className={`flex items-start gap-3 mt-4 p-3 rounded-md border ${
            message.type === "success"
              ? "bg-green-50 dark:bg-green-950/80 border-green-200 dark:border-green-800"
              : "bg-red-50 dark:bg-red-950/80 border-red-200 dark:border-red-800"
          }`}>
            <div className={message.type === "success" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
              {message.type === "success" ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
            </div>
            <p className={`text-sm font-medium ${message.type === "success" ? "text-green-800 dark:text-green-100" : "text-red-800 dark:text-red-100"}`}>
              {message.text}
            </p>
          </div>
        )}

        {/* 最后同步时间 */}
        {lastSync && (
          <p className="text-xs text-muted-foreground mt-3">
            最后同步: {lastSync}
          </p>
        )}
      </div>

    </div>
  );
}
