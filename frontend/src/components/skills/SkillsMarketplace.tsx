import { useState, useCallback } from "react";
import { Search, Download, Check, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  searchRemoteSkills,
  installSkill,
  type RemoteSkillItem,
} from "@/api/tauri-api";

/** 将 search 返回的 source 映射为 install API 需要的值 */
function mapSourceToInstall(source: string): string {
  const s = (source ?? "").toLowerCase();
  if (s.includes("anthropic")) return "anthropic";
  if (s.includes("openai")) return "openai";
  if (s.includes("vercel")) return "vercel";
  if (s.includes("skillsmp")) return "skillsmp";
  return "vercel";
}

interface SkillsMarketplaceProps {
  onInstallSuccess: () => void;
}

export function SkillsMarketplace({ onInstallSuccess }: SkillsMarketplaceProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RemoteSkillItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const skills = await searchRemoteSkills({ q, limit: 20 });
      setResults(skills);
    } catch (e) {
      setError(e instanceof Error ? e.message : "搜索失败");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleInstall = useCallback(
    async (skill: RemoteSkillItem) => {
      setInstallingId(skill.id);
      setError(null);
      try {
        await installSkill({
          skill_id: skill.id,
          source: mapSourceToInstall(skill.source ?? ""),
        });
        onInstallSuccess();
        setResults((prev) =>
          prev.map((s) =>
            s.id === skill.id ? { ...s, installed: true } : s
          )
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "安装失败");
      } finally {
        setInstallingId(null);
      }
    },
    [onInstallSuccess]
  );

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 p-4 border-b">
        <h3 className="font-medium text-foreground mb-3">Skills 市场</h3>
        <p className="text-xs text-muted-foreground mb-3">
          通过后端搜索可安装的 Skills（skills.sh 聚合源）
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="搜索技能，如 react、database、writing..."
              className="pl-9"
            />
          </div>
          <Button onClick={handleSearch} disabled={loading}>
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              "搜索"
            )}
          </Button>
        </div>
        {error && (
          <p className="text-sm text-destructive mt-2">{error}</p>
        )}
      </div>
      <div className="flex-1 overflow-auto p-4">
        {results.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground text-center py-8">
            {query.trim()
              ? "未找到匹配的 Skills，试试其他关键词"
              : "输入关键词后点击搜索"}
          </p>
        )}
        <div className="space-y-2">
          {results.map((skill) => {
            const installed = skill.installed ?? false;
            const installing = installingId === skill.id;
            return (
              <div
                key={skill.id}
                className="rounded-lg border p-4 flex items-start justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{skill.name}</p>
                  {skill.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {skill.description}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">{skill.source}</p>
                </div>
                <Button
                  size="sm"
                  variant={installed ? "secondary" : "default"}
                  disabled={installed || installing}
                  onClick={() => !installed && handleInstall(skill)}
                >
                  {installing ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : installed ? (
                    <Check size={14} />
                  ) : (
                    <Download size={14} />
                  )}
                  <span className="ml-1.5">
                    {installing ? "安装中" : installed ? "已安装" : "安装"}
                  </span>
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
