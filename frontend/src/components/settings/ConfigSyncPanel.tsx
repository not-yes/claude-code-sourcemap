import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Github, Download, CheckCircle, AlertCircle, Loader2, Eye, EyeOff, KeyRound, History, ChevronRight } from "lucide-react";
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

interface SyncHistoryItem {
  id: string;
  time: string;
  status: "success" | "error";
  message: string;
  details?: string[];
  expanded?: boolean;
}

function getErrorHint(error: string): { hint: string; suggestions: string[] } {
  const lowerError = error.toLowerCase();

  if (lowerError.includes("404") || lowerError.includes("not found")) {
    return {
      hint: "仓库或文件不存在",
      suggestions: [
        "检查 Token 是否有访问该仓库的权限",
        "确认仓库地址是否正确",
        "如果是私有仓库，需要 Token 有 repo 权限"
      ]
    };
  }

  if (lowerError.includes("403") || lowerError.includes("forbidden") || lowerError.includes("permission")) {
    return {
      hint: "访问权限被拒绝",
      suggestions: [
        "Token 可能缺少必要权限",
        "检查 Token 是否已勾选 repo 权限",
        "确认仓库是否是私有的"
      ]
    };
  }

  if (lowerError.includes("network") || lowerError.includes("connection") || lowerError.includes("超时")) {
    return {
      hint: "网络连接问题",
      suggestions: [
        "检查网络连接是否正常",
        "可能需要配置代理",
        "GitHub API 在某些地区可能访问受限"
      ]
    };
  }

  if (lowerError.includes("401") || lowerError.includes("unauthorized") || lowerError.includes("invalid")) {
    return {
      hint: "Token 无效或已过期",
      suggestions: [
        "检查 Token 是否正确",
        "Token 可能已过期，需要重新生成",
        "确认使用的是 Personal Access Token 而不是 OAuth token"
      ]
    };
  }

  return {
    hint: "拉取失败",
    suggestions: [
      "请查看详细错误信息",
      "检查网络连接和 Token 权限"
    ]
  };
}

export function ConfigSyncPanel() {
  const REPO_URL = "https://github.com/not-yes/config-sync-hub";

  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [tokenVisible, setTokenVisible] = useState(false);
  const [tokenSaved, setTokenSaved] = useState(false);
  const [tokenSaving, setTokenSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [syncProgress, setSyncProgress] = useState<string>("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [history, setHistory] = useState<SyncHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // 加载历史记录
  useEffect(() => {
    const loadHistory = () => {
      try {
        const saved = localStorage.getItem("config-sync-history");
        if (saved) {
          const parsed = JSON.parse(saved) as SyncHistoryItem[];
          setHistory(parsed.slice(0, 10)); // 最多显示10条
        }
      } catch (e) {
        console.error("加载历史记录失败:", e);
      }
    };
    loadHistory();
  }, []);

  // 保存历史记录
  const addHistory = (item: Omit<SyncHistoryItem, "id" | "time" | "expanded">) => {
    const newItem: SyncHistoryItem = {
      ...item,
      id: Date.now().toString(),
      time: new Date().toLocaleString("zh-CN"),
      expanded: false
    };
    const updated = [newItem, ...history].slice(0, 10);
    setHistory(updated);
    localStorage.setItem("config-sync-history", JSON.stringify(updated));
  };

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
    setSyncProgress("正在拉取配置...");

    try {
      await invoke("sync_config_pull", {
        repoUrl: REPO_URL,
        username: username.trim(),
        token: token.trim(),
      });

      const now = new Date().toLocaleString("zh-CN");
      setLastSync(now);
      setMessage({ type: "success", text: "配置拉取成功" });
      toast.success("配置拉取成功");

      addHistory({
        status: "success",
        message: "配置拉取成功"
      });
    } catch (error) {
      console.error("拉取失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const { hint, suggestions } = getErrorHint(errorMessage);

      setMessage({
        type: "error",
        text: hint
      });
      toast.error(`拉取失败: ${hint}`);

      addHistory({
        status: "error",
        message: hint,
        details: suggestions
      });
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem("config-sync-history");
    toast.success("历史记录已清除");
  };

  return (
    <div className="px-6 py-5 max-w-2xl space-y-6">

      {/* 仓库配置 */}
      <div className="border-b p-4 space-y-4">
        <SectionHeader icon={Github} title="仓库配置" />

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
      <div className="border-b p-4 space-y-4">
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

        {/* 进度显示 */}
        {loading && syncProgress && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin text-primary" />
              {syncProgress}
            </p>
          </div>
        )}

        {/* 状态显示 */}
        {message && (
          <div className={`flex items-start gap-3 p-4 rounded-lg border ${
            message.type === "success"
              ? "bg-green-50 dark:bg-green-950/80 border-green-200 dark:border-green-800"
              : "bg-red-50 dark:bg-red-950/80 border-red-200 dark:border-red-800"
          }`}>
            <div className={message.type === "success" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
              {message.type === "success" ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${message.type === "success" ? "text-green-800 dark:text-green-100" : "text-red-800 dark:text-red-100"}`}>
                {message.text}
              </p>

              {/* 错误详情 */}
              {message.type === "error" && history[0]?.details && (
                <ul className="mt-2 space-y-1">
                  {history[0].details.map((suggestion, i) => (
                    <li key={i} className="text-xs text-red-700 dark:text-red-300 flex items-start gap-1.5">
                      <span className="text-red-400">•</span>
                      {suggestion}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* 最后同步时间 */}
        {lastSync && (
          <p className="text-xs text-muted-foreground">
            最后同步: {lastSync}
          </p>
        )}
      </div>

      {/* 同步历史 */}
      {history.length > 0 && (
        <div className="p-4 border rounded-lg bg-card">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
            >
              <History size={16} className="text-muted-foreground" />
              同步历史
              <span className="text-xs text-muted-foreground font-normal">({history.length})</span>
              <ChevronRight size={14} className={`transition-transform ${showHistory ? "rotate-90" : ""}`} />
            </button>
            <button
              onClick={clearHistory}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              清除
            </button>
          </div>

          {showHistory && (
            <div className="space-y-2">
              {history.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-start gap-3 p-3 rounded-md border text-sm ${
                    item.status === "success"
                      ? "bg-green-50/50 dark:bg-green-950/30 border-green-100 dark:border-green-900"
                      : "bg-red-50/50 dark:bg-red-950/30 border-red-100 dark:border-red-900"
                  }`}
                >
                  <div className={item.status === "success" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                    {item.status === "success" ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className={item.status === "success" ? "text-green-800 dark:text-green-200" : "text-red-800 dark:text-red-200"}>
                        {item.message}
                      </p>
                      <div className="flex items-center gap-2">
                        {item.details && (
                          <button
                            onClick={() => {
                              const updated = history.map(h =>
                                h.id === item.id ? { ...h, expanded: !h.expanded } : h
                              );
                              setHistory(updated);
                              localStorage.setItem("config-sync-history", JSON.stringify(updated));
                            }}
                            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                          >
                            <ChevronRight size={12} className={`transition-transform ${item.expanded ? "rotate-90" : ""}`} />
                            {item.expanded ? "收起" : "详情"}
                          </button>
                        )}
                        <span className="text-xs text-muted-foreground shrink-0">
                          {item.time}
                        </span>
                      </div>
                    </div>
                    {item.expanded && item.details && (
                      <ul className="mt-1.5 space-y-0.5">
                        {item.details.map((detail, i) => (
                          <li key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                            <span className="text-muted-foreground/50">•</span>
                            {detail}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
