import { useState, useEffect } from "react";
import { checkIsTauri } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Cpu,
  Zap,
  FileCode,
  Key,
  Eye,
  EyeOff,
  Monitor,
  Sun,
  Moon,
  Settings2,
  Variable,
  Bell,
  Mic,
} from "lucide-react";
import { cn } from "@/lib/utils";
import toml from "toml";
import * as TOML from "@iarna/toml";
import { useAppStore } from "@/stores/appStore";
import { invoke } from "@tauri-apps/api/core";
import { getClaudeConfig, saveClaudeConfig, storeAsrApiKey, getAsrApiKey, deleteAsrApiKey } from "@/api/tauri-api";
import { ConfigSyncPanel } from "./ConfigSyncPanel";

type SettingsCategory =
  | "model-api"
  | "appearance"
  | "session"
  | "notifications"
  | "env"
  | "advanced"
  | "sync-config"
  | "voice";

function SectionHeader({
  icon: Icon,
  title,
  action,
}: {
  icon: React.ElementType;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
        <Icon size={16} className="text-muted-foreground" />
        {title}
      </h4>
      {action}
    </div>
  );
}

/** 开关行组件 */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(!!v)}
        disabled={disabled}
      />
    </div>
  );
}

export function SettingsPanel() {
  const selectedCategory = useAppStore((s) => s.selectedSettingsCategory) as
    | SettingsCategory
    | null;

  // API Key / 模型 / 主题
  const setApiKeyConfigured = useAppStore((s) => s.setApiKeyConfigured);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [apiKeyMask, setApiKeyMask] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeySaved, setApiKeySaved] = useState(false);

  // Base URL 状态
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [baseUrlConfigured, setBaseUrlConfigured] = useState(false);
  const [baseUrlSaving, setBaseUrlSaving] = useState(false);
  const [baseUrlSaved, setBaseUrlSaved] = useState(false);

  // Model 状态
  const [customModel, setCustomModel] = useState("");
  const [customModelSaved, setCustomModelSaved] = useState(false);

  // 场景模型状态
  const [smallFastModel, setSmallFastModel] = useState("");
  const [sonnetModel, setSonnetModel] = useState("");
  const [opusModel, setOpusModel] = useState("");
  const [haikuModel, setHaikuModel] = useState("");
  const [showAdvancedModels, setShowAdvancedModels] = useState(false);

  // 场景模型保存反馈
  const [smallFastModelSaved, setSmallFastModelSaved] = useState(false);
  const [sonnetModelSaved, setSonnetModelSaved] = useState(false);
  const [opusModelSaved, setOpusModelSaved] = useState(false);
  const [haikuModelSaved, setHaikuModelSaved] = useState(false);

  // 语音识别 API Key 状态
  const [asrApiKeyInput, setAsrApiKeyInput] = useState("");
  const [asrApiKeyMask, setAsrApiKeyMask] = useState("");
  const [asrApiKeyVisible, setAsrApiKeyVisible] = useState(false);
  const [asrApiKeySaving, setAsrApiKeySaving] = useState(false);
  const [asrApiKeySaved, setAsrApiKeySaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 通用场景模型保存函数
  const saveSceneModel = async (
    cmd: string,
    model: string,
    setSaved: (v: boolean) => void
  ) => {
    if (!checkIsTauri() || !model.trim()) return;
    try {
      await invoke(cmd, { model: model.trim() });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error(`保存模型失败 (${cmd}):`, e);
    }
  };

  // config.toml 相关状态
  const [editedContent, setEditedContent] = useState("");
  const [configContent, setConfigContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isTauri, setIsTauri] = useState(false);

  // 各分类保存成功反馈
  const [appearanceSaved, setAppearanceSaved] = useState(false);
  const [sessionSaved, setSessionSaved] = useState(false);
  const [notificationsSaved, setNotificationsSaved] = useState(false);
  const [advancedSaved, setAdvancedSaved] = useState(false);

  // 加载已存储的 API Key、Base URL、模型
  useEffect(() => {
    const isTauri = checkIsTauri();
    console.log("SettingsPanel: checkIsTauri =", isTauri);
    if (!isTauri) return;

    const loadSettings = async () => {
      try {
        console.log("SettingsPanel: 开始加载 LLM 配置...");
        // 批量读取 LLM 配置
        const config = await invoke<{
          api_key: string | null;
          base_url: string | null;
          model: string | null;
          small_fast_model: string | null;
          sonnet_model: string | null;
          opus_model: string | null;
          haiku_model: string | null;
        }>("get_llm_config");

        console.log("SettingsPanel: get_llm_config 返回", JSON.stringify({
          api_key: config.api_key ? "***" : null,
          base_url: config.base_url,
          model: config.model,
        }));

        // API Key
        if (config.api_key) {
          const masked =
            config.api_key.length > 8
              ? config.api_key.slice(0, 3) + "..." + config.api_key.slice(-4)
              : "***";
          setApiKeyMask(masked);
          setApiKeyConfigured(true);
        }

        // Base URL
        if (config.base_url) {
          setBaseUrlInput(config.base_url);
          setBaseUrlConfigured(true);
        }

        // Model
        if (config.model) {
          setSelectedModel(config.model);
          setCustomModel(config.model);
        }

        // 场景模型
        if (config.small_fast_model) setSmallFastModel(config.small_fast_model);
        if (config.sonnet_model) setSonnetModel(config.sonnet_model);
        if (config.opus_model) setOpusModel(config.opus_model);
        if (config.haiku_model) setHaikuModel(config.haiku_model);

        // 加载语音识别 API Key
        const asrApiKey = await getAsrApiKey();
        if (asrApiKey) {
          const masked =
            asrApiKey.length > 8
              ? asrApiKey.slice(0, 3) + "..." + asrApiKey.slice(-4)
              : "***";
          setAsrApiKeyMask(masked);
        }

        // 兼容旧配置：如果安全存储中没有，尝试从旧配置迁移
        if (!config.api_key) {
          const oldKey = await invoke<string | null>("get_config", { key: "api_key" });
          if (oldKey) {
            await invoke("store_api_key", { apiKey: oldKey });
            const masked =
              oldKey.length > 8
                ? oldKey.slice(0, 3) + "..." + oldKey.slice(-4)
                : "***";
            setApiKeyMask(masked);
            setApiKeyConfigured(true);
            await invoke("set_config", { key: "api_key", value: null });
            console.log("API Key 已从旧存储迁移到安全存储");
          }
        }
      } catch (e) {
        // 非 Tauri 环境或加载失败
        console.error("加载 LLM 配置失败:", e);
      }
    };
    void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    setApiKeySaving(true);
    try {
      await invoke("store_api_key", { apiKey: apiKeyInput.trim() });
      const k = apiKeyInput.trim();
      const masked =
        k.length > 8 ? k.slice(0, 3) + "..." + k.slice(-4) : "***";
      setApiKeyMask(masked);
      setApiKeyConfigured(true);
      setApiKeyInput("");
      setApiKeySaved(true);
      setTimeout(() => setApiKeySaved(false), 2000);
    } catch (e) {
      console.error("保存 API Key 失败", e);
    } finally {
      setApiKeySaving(false);
    }
  };

  const saveAsrApiKey = async () => {
    if (!asrApiKeyInput.trim()) return;
    setAsrApiKeySaving(true);
    setSaveError(null);
    try {
      await storeAsrApiKey(asrApiKeyInput.trim());
      const k = asrApiKeyInput.trim();
      const masked =
        k.length > 8 ? k.slice(0, 3) + "..." + k.slice(-4) : "***";
      setAsrApiKeyMask(masked);
      setAsrApiKeyInput("");
      setAsrApiKeySaved(true);
      setTimeout(() => setAsrApiKeySaved(false), 2000);
    } catch (e) {
      console.error("保存语音 API Key 失败", e);
      setSaveError(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAsrApiKeySaving(false);
    }
  };

  const handleDeleteAsrApiKey = async () => {
    try {
      await deleteAsrApiKey();
      setAsrApiKeyMask("");
      setAsrApiKeyInput("");
    } catch (e) {
      console.error("删除语音 API Key 失败", e);
      setSaveError("删除失败");
    }
  };

  const saveBaseUrl = async () => {
    if (!baseUrlInput.trim()) return;
    setBaseUrlSaving(true);
    try {
      await invoke("store_base_url", { url: baseUrlInput.trim() });
      setBaseUrlConfigured(true);
      setBaseUrlSaved(true);
      setTimeout(() => setBaseUrlSaved(false), 2000);
    } catch (e) {
      console.error("保存 Base URL 失败", e);
    } finally {
      setBaseUrlSaving(false);
    }
  };

  const saveModelToSecureStorage = async (model: string) => {
    if (!checkIsTauri()) return;
    try {
      await invoke("store_model", { model });
      setSelectedModel(model);  // 更新 store
      setCustomModelSaved(true);
      setTimeout(() => setCustomModelSaved(false), 2000);
    } catch (e) {
      console.error("保存模型失败", e);
    }
  };

  // 加载 config.toml
  useEffect(() => {
    const loadConfig = async () => {
      if (!checkIsTauri()) return;
      try {
        setIsTauri(true);
        const content = await getClaudeConfig("config");
        setConfigContent(content);
        setEditedContent(content);
      } catch {
        setConfigContent(null);
      }
    };

    loadConfig();
  }, []);

  const parsed = (() => {
    try {
      return toml.parse(editedContent || configContent || "");
    } catch {
      return null;
    }
  })();

  const saveConfig = async (newContent?: string) => {
    if (!checkIsTauri()) return;
    const content = newContent ?? editedContent;
    setSaving(true);
    try {
      await saveClaudeConfig("config", content);
      setConfigContent(content);
      setEditedContent(content);
    } catch (e) {
      console.error("保存配置失败:", e);
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = (updater: (obj: Record<string, unknown>) => void) => {
    const obj = parsed
      ? (JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>)
      : {};
    updater(obj);
    try {
      const newContent = TOML.stringify(obj as Parameters<typeof TOML.stringify>[0]);
      setEditedContent(newContent);
      return newContent;
    } catch {
      return null;
    }
  };

  /** 外观保存（带反馈） */
  const saveAppearanceConfig = async () => {
    await saveConfig();
    setAppearanceSaved(true);
    setTimeout(() => setAppearanceSaved(false), 2000);
  };

  /** 会话与文件保存（带反馈） */
  const saveSessionConfig = async () => {
    await saveConfig();
    setSessionSaved(true);
    setTimeout(() => setSessionSaved(false), 2000);
  };

  /** 通知设置保存（带反馈） */
  const saveNotificationsConfig = async () => {
    await saveConfig();
    setNotificationsSaved(true);
    setTimeout(() => setNotificationsSaved(false), 2000);
  };

  /** 高级设置保存（带反馈） */
  const saveAdvancedConfig = async () => {
    await saveConfig();
    setAdvancedSaved(true);
    setTimeout(() => setAdvancedSaved(false), 2000);
  };

  // ─── 通用设置读取辅助 ──────────────────────────────────────
  const globalConfig = parsed as Record<string, unknown> | null;
  const getBool = (key: string, fallback: boolean): boolean => {
    const val = globalConfig?.[key];
    return typeof val === "boolean" ? val : fallback;
  };
  const getString = (key: string, fallback: string): string => {
    const val = globalConfig?.[key];
    return typeof val === "string" ? val : fallback;
  };

  // ─── 环境变量 ──────────────────────────────────────────────
  const envObj = (() => {
    const e = globalConfig?.env;
    return e && typeof e === "object" ? e as Record<string, unknown> : {};
  })();

  const [newEnvKey, setNewEnvKey] = useState("");
  const [newEnvVal, setNewEnvVal] = useState("");

  if (!selectedCategory) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-6">
        从左侧选择分类查看
      </div>
    );
  }

  const content = (
    <div className="px-6 py-5 max-w-2xl space-y-6">

      {/* ── 模型与 API ────────────────────────────────────────── */}
      {selectedCategory === "model-api" && (
        <>
          {/* API Key 管理 */}
          <div className="border-b p-4 space-y-4">
            <SectionHeader icon={Key} title="API Key 管理" />
            {apiKeyMask && (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground">当前已配置：</span>
                <span className="font-mono ml-1">{apiKeyMask}</span>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">
                {apiKeyMask ? "更新 API Key" : "输入 API Key"}
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={apiKeyVisible ? "text" : "password"}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="sk-ant-..."
                    className="pr-10 font-mono"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveApiKey();
                    }}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setApiKeyVisible(!apiKeyVisible)}
                    tabIndex={-1}
                  >
                    {apiKeyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <Button
                  size="sm"
                  onClick={() => void saveApiKey()}
                  disabled={apiKeySaving || !apiKeyInput.trim()}
                  className="shrink-0"
                >
                  {apiKeySaved ? "已保存 ✓" : apiKeySaving ? "保存中..." : "保存"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                API Key 加密存储在系统密钥库（macOS Keychain / Windows Credential Manager / Linux libsecret），用于 LLM 对话。
              </p>
            </div>
          </div>

          {/* Base URL 管理 */}
          <div className="border-b p-4 space-y-4">
            <SectionHeader icon={Zap} title="API Base URL（可选）" />
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">
                {baseUrlConfigured ? "更新 Base URL" : "自定义 API 端点"}
              </label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={baseUrlInput}
                  onChange={(e) => setBaseUrlInput(e.target.value)}
                  placeholder="https://api.anthropic.com（默认）"
                  className="font-mono"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveBaseUrl();
                  }}
                />
                <Button
                  size="sm"
                  onClick={() => void saveBaseUrl()}
                  disabled={baseUrlSaving || !baseUrlInput.trim()}
                  className="shrink-0"
                >
                  {baseUrlSaved ? "已保存 ✓" : baseUrlSaving ? "保存中..." : "保存"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                如使用第三方 API（如 MiniMax、AWS Bedrock 等），可在此设置自定义端点。留空则使用默认 Anthropic 端点。
              </p>
            </div>
          </div>

          {/* 模型选择 */}
          <div className="border-b p-4 space-y-4">
            <SectionHeader icon={Cpu} title="模型配置" />
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm text-muted-foreground">主模型 (ANTHROPIC_MODEL)</label>
                <div className="flex gap-2">
                  <Input
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="例如: MiniMax-M2.7"
                    className="font-mono"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && customModel.trim()) {
                        void saveModelToSecureStorage(customModel.trim());
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={() => customModel.trim() && void saveModelToSecureStorage(customModel.trim())}
                    disabled={!customModel.trim()}
                  >
                    {customModelSaved ? "已保存 ✓" : "保存"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  当前模型: <span className="font-mono">{selectedModel || "未设置"}</span>
                </p>
              </div>
            </div>

            {/* 高级模型配置 */}
            <div className="mt-4 pt-4 border-t">
              <button
                type="button"
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowAdvancedModels(!showAdvancedModels)}
              >
                <span className={"transition-transform " + (showAdvancedModels ? "rotate-90" : "")}>▶</span>
                高级模型配置
              </button>

              {showAdvancedModels && (
                <div className="mt-3 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    为不同场景指定不同的模型。留空则使用主模型。
                  </p>

                  {/* 快速模型 */}
                  <div className="space-y-1">
                    <label className="text-sm text-muted-foreground">快速模型 (ANTHROPIC_SMALL_FAST_MODEL)</label>
                    <div className="flex gap-2">
                      <Input
                        value={smallFastModel}
                        onChange={(e) => setSmallFastModel(e.target.value)}
                        placeholder="后台任务、简单查询"
                        className="font-mono text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && smallFastModel.trim()) {
                            void saveSceneModel("store_small_fast_model", smallFastModel, setSmallFastModelSaved);
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        onClick={() => saveSceneModel("store_small_fast_model", smallFastModel, setSmallFastModelSaved)}
                        disabled={!smallFastModel.trim()}
                      >
                        {smallFastModelSaved ? "已保存 ✓" : "保存"}
                      </Button>
                    </div>
                  </div>

                  {/* Sonnet 模型 */}
                  <div className="space-y-1">
                    <label className="text-sm text-muted-foreground">Sonnet 模型 (ANTHROPIC_DEFAULT_SONNET_MODEL)</label>
                    <div className="flex gap-2">
                      <Input
                        value={sonnetModel}
                        onChange={(e) => setSonnetModel(e.target.value)}
                        placeholder="当请求 Sonnet 时使用"
                        className="font-mono text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && sonnetModel.trim()) {
                            void saveSceneModel("store_sonnet_model", sonnetModel, setSonnetModelSaved);
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        onClick={() => saveSceneModel("store_sonnet_model", sonnetModel, setSonnetModelSaved)}
                        disabled={!sonnetModel.trim()}
                      >
                        {sonnetModelSaved ? "已保存 ✓" : "保存"}
                      </Button>
                    </div>
                  </div>

                  {/* Opus 模型 */}
                  <div className="space-y-1">
                    <label className="text-sm text-muted-foreground">Opus 模型 (ANTHROPIC_DEFAULT_OPUS_MODEL)</label>
                    <div className="flex gap-2">
                      <Input
                        value={opusModel}
                        onChange={(e) => setOpusModel(e.target.value)}
                        placeholder="当请求 Opus 时使用"
                        className="font-mono text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && opusModel.trim()) {
                            void saveSceneModel("store_opus_model", opusModel, setOpusModelSaved);
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        onClick={() => saveSceneModel("store_opus_model", opusModel, setOpusModelSaved)}
                        disabled={!opusModel.trim()}
                      >
                        {opusModelSaved ? "已保存 ✓" : "保存"}
                      </Button>
                    </div>
                  </div>

                  {/* Haiku 模型 */}
                  <div className="space-y-1">
                    <label className="text-sm text-muted-foreground">Haiku 模型 (ANTHROPIC_DEFAULT_HAIKU_MODEL)</label>
                    <div className="flex gap-2">
                      <Input
                        value={haikuModel}
                        onChange={(e) => setHaikuModel(e.target.value)}
                        placeholder="当请求 Haiku 时使用"
                        className="font-mono text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && haikuModel.trim()) {
                            void saveSceneModel("store_haiku_model", haikuModel, setHaikuModelSaved);
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        onClick={() => saveSceneModel("store_haiku_model", haikuModel, setHaikuModelSaved)}
                        disabled={!haikuModel.trim()}
                      >
                        {haikuModelSaved ? "已保存 ✓" : "保存"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Provider 配置 */}
          {parsed?.provider && typeof parsed.provider === "object" && (
            <div className="border-b p-4">
              <SectionHeader icon={Zap} title="LLM / Provider" />
              <div className="space-y-3">
                {Object.entries(parsed.provider as Record<string, unknown>).map(
                  ([k, v]) =>
                    v != null &&
                    v !== "" && (
                      <div key={k}>
                        <label className="text-sm text-muted-foreground">{k}</label>
                        <Input
                          value={String(v)}
                          onChange={(e) =>
                            updateConfig((o) => {
                              const p = (o.provider ?? {}) as Record<string, unknown>;
                              p[k] = e.target.value;
                              o.provider = p;
                            })
                          }
                          className="mt-1 font-mono"
                          readOnly={!isTauri}
                        />
                      </div>
                    )
                )}
                {isTauri && (
                  <Button
                    size="sm"
                    className="mt-4"
                    onClick={() => void saveConfig()}
                    disabled={saving}
                  >
                    {saving ? "保存中..." : "保存"}
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── 外观与界面 ────────────────────────────────────────── */}
      {selectedCategory === "appearance" && (
        <div className="border-b p-4 space-y-5">
          <SectionHeader
            icon={Monitor}
            title="外观与界面"
            action={
              isTauri ? (
                <Button
                  size="sm"
                  onClick={() => void saveAppearanceConfig()}
                  disabled={saving || editedContent === configContent}
                >
                  {appearanceSaved ? "已保存 ✓" : saving ? "保存中..." : "保存"}
                </Button>
              ) : undefined
            }
          />

          {/* 主题选择 */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">主题</p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: "light", label: "浅色", Icon: Sun },
                { value: "dark", label: "深色", Icon: Moon },
                { value: "system", label: "跟随系统", Icon: Monitor },
              ].map(({ value, label, Icon }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value as typeof theme)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors",
                    theme === value
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50 text-foreground"
                  )}
                >
                  <Icon size={20} className="text-foreground" />
                  <span className="text-sm text-foreground">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t pt-4 space-y-4">
            {/* 编辑器模式 */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">编辑器模式</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  在输入框中使用的编辑模式
                </p>
              </div>
              <Select
                value={getString("editorMode", "normal")}
                onValueChange={(v) => updateConfig((o) => { o.editorMode = v; })}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">普通模式</SelectItem>
                  <SelectItem value="vim">Vim 模式</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Diff 工具 */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">Diff 显示工具</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  文件差异的展示方式
                </p>
              </div>
              <Select
                value={getString("diffTool", "auto")}
                onValueChange={(v) => updateConfig((o) => { o.diffTool = v; })}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">自动</SelectItem>
                  <SelectItem value="terminal">终端</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <ToggleRow
              label="显示执行时长"
              description="在回复末尾显示本次执行的耗时"
              checked={getBool("showTurnDuration", true)}
              onChange={(v) => updateConfig((o) => { o.showTurnDuration = v; })}
              disabled={!isTauri}
            />

            <ToggleRow
              label="复制完整回复"
              description="使用 /copy 时直接复制完整回复，而非显示选择器"
              checked={getBool("copyFullResponse", false)}
              onChange={(v) => updateConfig((o) => { o.copyFullResponse = v; })}
              disabled={!isTauri}
            />
          </div>
        </div>
      )}

      {/* ── 会话与文件 ────────────────────────────────────────── */}
      {selectedCategory === "session" && (
        <div className="border-b p-4 space-y-5">
          <SectionHeader
            icon={FileCode}
            title="会话与文件"
            action={
              isTauri ? (
                <Button
                  size="sm"
                  onClick={() => void saveSessionConfig()}
                  disabled={saving || editedContent === configContent}
                >
                  {sessionSaved ? "已保存 ✓" : saving ? "保存中..." : "保存"}
                </Button>
              ) : undefined
            }
          />
          <ToggleRow
            label="自动压缩对话"
            description="对话过长时自动压缩历史消息，避免超出上下文窗口"
            checked={getBool("autoCompactEnabled", true)}
            onChange={(v) => updateConfig((o) => { o.autoCompactEnabled = v; })}
            disabled={!isTauri}
          />
          <ToggleRow
            label="文件检查点"
            description="启用文件编辑的检查点功能，支持回滚变更"
            checked={getBool("fileCheckpointingEnabled", true)}
            onChange={(v) => updateConfig((o) => { o.fileCheckpointingEnabled = v; })}
            disabled={!isTauri}
          />
          <ToggleRow
            label="遵守 .gitignore"
            description="文件搜索时忽略 .gitignore 中列出的文件"
            checked={getBool("respectGitignore", true)}
            onChange={(v) => updateConfig((o) => { o.respectGitignore = v; })}
            disabled={!isTauri}
          />
          <ToggleRow
            label="Todo 功能"
            description="启用 Todo 待办事项功能"
            checked={getBool("todoFeatureEnabled", true)}
            onChange={(v) => updateConfig((o) => { o.todoFeatureEnabled = v; })}
            disabled={!isTauri}
          />
        </div>
      )}

      {/* ── 通知设置 ────────────────────────────────────────────── */}
      {selectedCategory === "notifications" && (
        <div className="border-b p-4 space-y-5">
          <SectionHeader
            icon={Bell}
            title="通知设置"
            action={
              isTauri ? (
                <Button
                  size="sm"
                  onClick={() => void saveNotificationsConfig()}
                  disabled={saving || editedContent === configContent}
                >
                  {notificationsSaved ? "已保存 ✓" : saving ? "保存中..." : "保存"}
                </Button>
              ) : undefined
            }
          />

          {/* 通知渠道 */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">通知渠道</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                选择任务完成通知的发送渠道
              </p>
            </div>
            <Select
              value={getString("preferredNotifChannel", "auto")}
              onValueChange={(v) => updateConfig((o) => { o.preferredNotifChannel = v; })}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">自动</SelectItem>
                <SelectItem value="iterm2">iTerm2</SelectItem>
                <SelectItem value="iterm2_with_bell">iTerm2 (含响铃)</SelectItem>
                <SelectItem value="terminal_bell">终端响铃</SelectItem>
                <SelectItem value="kitty">Kitty</SelectItem>
                <SelectItem value="ghostty">Ghostty</SelectItem>
                <SelectItem value="notifications_disabled">禁用通知</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <ToggleRow
            label="任务完成通知"
            description="任务完成时发送通知"
            checked={getBool("taskCompleteNotifEnabled", false)}
            onChange={(v) => updateConfig((o) => { o.taskCompleteNotifEnabled = v; })}
            disabled={!isTauri}
          />
          <ToggleRow
            label="需要输入时通知"
            description="等待用户输入时发送通知"
            checked={getBool("inputNeededNotifEnabled", false)}
            onChange={(v) => updateConfig((o) => { o.inputNeededNotifEnabled = v; })}
            disabled={!isTauri}
          />
          <ToggleRow
            label="Agent 推送通知"
            description="Agent 有推送消息时发送通知"
            checked={getBool("agentPushNotifEnabled", false)}
            onChange={(v) => updateConfig((o) => { o.agentPushNotifEnabled = v; })}
            disabled={!isTauri}
          />
        </div>
      )}

      {/* ── 环境变量 ────────────────────────────────────────────── */}
      {selectedCategory === "env" && (
        <div className="border-b p-4 space-y-4">
          <SectionHeader
            icon={Variable}
            title="环境变量"
            action={
              isTauri ? (
                <Button
                  size="sm"
                  onClick={() => void saveConfig()}
                  disabled={saving || editedContent === configContent}
                >
                  {saving ? "保存中..." : "保存"}
                </Button>
              ) : undefined
            }
          />
          <p className="text-xs text-muted-foreground">
            为 AI Agent 系统会话设置环境变量，例如 API 基础地址或代理配置。
          </p>
          <div className="space-y-2">
            {Object.entries(envObj).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <Input
                  value={k}
                  className="font-mono text-sm flex-1"
                  readOnly
                />
                <Input
                  value={String(v)}
                  onChange={(e) =>
                    updateConfig((o) => {
                      const env = (o.env ?? {}) as Record<string, unknown>;
                      env[k] = e.target.value;
                      o.env = env;
                    })
                  }
                  className="font-mono text-sm flex-1"
                  placeholder="值"
                  readOnly={!isTauri}
                />
                {isTauri && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive shrink-0"
                    onClick={() =>
                      updateConfig((o) => {
                        const env = { ...(o.env ?? {}) } as Record<string, unknown>;
                        delete env[k];
                        o.env = env;
                      })
                    }
                  >
                    ×
                  </Button>
                )}
              </div>
            ))}
          </div>
          {/* 新增环境变量 */}
          {isTauri && (
            <div className="flex items-center gap-2 pt-2 border-t">
              <Input
                value={newEnvKey}
                onChange={(e) => setNewEnvKey(e.target.value)}
                placeholder="变量名"
                className="font-mono text-sm flex-1"
              />
              <Input
                value={newEnvVal}
                onChange={(e) => setNewEnvVal(e.target.value)}
                placeholder="值"
                className="font-mono text-sm flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newEnvKey.trim()) {
                    updateConfig((o) => {
                      const env = (o.env ?? {}) as Record<string, unknown>;
                      env[newEnvKey.trim()] = newEnvVal;
                      o.env = env;
                    });
                    setNewEnvKey("");
                    setNewEnvVal("");
                  }
                }}
              />
              <Button
                size="sm"
                className="shrink-0"
                disabled={!newEnvKey.trim()}
                onClick={() => {
                  if (!newEnvKey.trim()) return;
                  updateConfig((o) => {
                    const env = (o.env ?? {}) as Record<string, unknown>;
                    env[newEnvKey.trim()] = newEnvVal;
                    o.env = env;
                  });
                  setNewEnvKey("");
                  setNewEnvVal("");
                }}
              >
                添加
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── 高级设置 ────────────────────────────────────────────── */}
      {selectedCategory === "advanced" && (
        <div className="border-b p-4 space-y-5">
          <SectionHeader
            icon={Settings2}
            title="高级设置"
            action={
              isTauri ? (
                <Button
                  size="sm"
                  onClick={() => void saveAdvancedConfig()}
                  disabled={saving || editedContent === configContent}
                >
                  {advancedSaved ? "已保存 ✓" : saving ? "保存中..." : "保存"}
                </Button>
              ) : undefined
            }
          />
          <ToggleRow
            label="详细日志"
            description="输出更详细的调试信息到日志"
            checked={getBool("verbose", false)}
            onChange={(v) => updateConfig((o) => { o.verbose = v; })}
            disabled={!isTauri}
          />
          <ToggleRow
            label="自动更新"
            description="启用自动检查和安装更新"
            checked={getBool("autoUpdates", false)}
            onChange={(v) => updateConfig((o) => { o.autoUpdates = v; })}
            disabled={!isTauri}
          />
          <ToggleRow
            label="推测推理"
            description="启用推测推理加速响应生成"
            checked={getBool("speculationEnabled", true)}
            onChange={(v) => updateConfig((o) => { o.speculationEnabled = v; })}
            disabled={!isTauri}
          />
          <ToggleRow
            label="终端进度条"
            description="在终端显示 OSC 进度条"
            checked={getBool("terminalProgressBarEnabled", true)}
            onChange={(v) => updateConfig((o) => { o.terminalProgressBarEnabled = v; })}
            disabled={!isTauri}
          />
          <ToggleRow
            label="权限说明"
            description="使用 AI 生成权限请求的解释说明"
            checked={getBool("permissionExplainerEnabled", true)}
            onChange={(v) => updateConfig((o) => { o.permissionExplainerEnabled = v; })}
            disabled={!isTauri}
          />

          {/* Teammate 模式 */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">团队协作模式</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                选择生成 Teammate 的方式
              </p>
            </div>
            <Select
              value={getString("teammateMode", "auto")}
              onValueChange={(v) => updateConfig((o) => { o.teammateMode = v; })}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">自动</SelectItem>
                <SelectItem value="tmux">Tmux</SelectItem>
                <SelectItem value="in-process">进程内</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Teammate 默认模型 */}
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">团队成员默认模型</p>
            <p className="text-xs text-muted-foreground">
              Teammate 使用的默认模型（留空则使用 Leader 模型）
            </p>
            <Input
              value={getString("teammateDefaultModel", "")}
              onChange={(e) =>
                updateConfig((o) => {
                  if (e.target.value) {
                    o.teammateDefaultModel = e.target.value;
                  } else {
                    delete o.teammateDefaultModel;
                  }
                })
              }
              placeholder="留空使用 Leader 模型"
              className="font-mono"
              readOnly={!isTauri}
            />
          </div>
        </div>
      )}


      {/* ── 语音识别 ─────────────────────────────────────────────── */}
      {selectedCategory === "voice" && (
        <div className="border-b p-4 space-y-4">
          <SectionHeader icon={Mic} title="语音识别" />
          <p className="text-xs text-muted-foreground">
            配置语音输入功能使用的阿里云 DashScope API Key，与 LLM API Key 独立分开。
          </p>
          {asrApiKeyMask && (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
              <span className="text-muted-foreground">当前已配置：</span>
              <span className="font-mono ml-1">{asrApiKeyMask}</span>
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium">API Key</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={asrApiKeyVisible ? "text" : "password"}
                  value={asrApiKeyInput}
                  onChange={(e) => setAsrApiKeyInput(e.target.value)}
                  placeholder="输入阿里云 DashScope API Key"
                  className="pr-10 font-mono"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setAsrApiKeyVisible(!asrApiKeyVisible)}
                  tabIndex={-1}
                >
                  {asrApiKeyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <Button
                size="sm"
                onClick={() => void saveAsrApiKey()}
                disabled={asrApiKeySaving || !asrApiKeyInput.trim()}
                className="shrink-0"
              >
                {asrApiKeySaved ? "已保存 ✓" : asrApiKeySaving ? "保存中..." : "保存"}
              </Button>
            </div>
          </div>
          {asrApiKeyMask && (
            <Button variant="outline" onClick={handleDeleteAsrApiKey}>
              删除
            </Button>
          )}
          {saveError && (
            <p className="text-xs text-destructive">{saveError}</p>
          )}
        </div>
      )}

      {/* ── 配置同步──────────────────────────────────────────── */}
      {selectedCategory === "sync-config" && <ConfigSyncPanel />}

      {/* 解析失败提示 */}
      {(
        selectedCategory === "model-api" ||
        selectedCategory === "appearance" ||
        selectedCategory === "session" ||
        selectedCategory === "notifications" ||
        selectedCategory === "env" ||
        selectedCategory === "advanced"
      ) && !parsed && (
        <p className="text-sm text-muted-foreground">
          config 解析失败，请通过「配置文件」检查文件格式。
        </p>
      )}
    </div>
  );

  return <div className="flex-1 overflow-auto">{content}</div>;
}
