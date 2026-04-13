import { useState, useEffect, useCallback, useRef } from "react";
import { getSkills, type SkillInfo } from "@/api/tauri-api";
import { useAppStore } from "@/stores/appStore";

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  source: string;
}

function toSkillItem(info: SkillInfo): SkillItem {
  return {
    id: info.name,
    name: info.name,
    description: info.description ?? "",
    category: info.category ?? "general",
    version: info.version ?? "1.0.0",
    source: info.source ?? "user",
  };
}

export function useSkills() {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const sidecarConnected = useAppStore((s) => s.sidecarConnected);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getSkills();
      if (!mountedRef.current) return;
      const items = data.map(toSkillItem).sort((a, b) => a.name.localeCompare(b.name));
      setSkills(items);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : "加载失败");
      setSkills([]);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // 仅在 sidecar 就绪后加载，避免在启动前发出无效 RPC
  useEffect(() => {
    if (!sidecarConnected) {
      console.info('[useSkills] Sidecar 未就绪，跳过初始加载');
      setLoading(false);
      return;
    }
    load();
  }, [load, sidecarConnected]);

  return { skills, loading, error, reload: load };
}
