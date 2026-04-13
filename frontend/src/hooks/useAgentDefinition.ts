import { useState, useCallback, useEffect, useRef } from "react";
import {
  getAgent,
  updateAgent,
} from "@/api/tauri-api";
import type { AgentItem } from "./useAgents";


export function useAgentDefinition(agent: AgentItem | null) {
  const [content, setContent] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [skills, setSkills] = useState<string[]>([]);
  const [model, setModel] = useState<string>("");
  const [maxIterations, setMaxIterations] = useState<number>(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const agentRef = useRef(agent);
  agentRef.current = agent;

  // 清洗令牌：每次开始新加载时递增，旧请求完成同步检查当前令牌是否匹配
  const loadTokenRef = useRef(0);
  // 组件挂载标志：防止卸载后调用 setState
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const currentAgent = agentRef.current;
    // 递增令牌用于判断这次加载是否仍是最新的
    const token = ++loadTokenRef.current;

    if (!currentAgent) {
      setContent("");
      setDescription("");
      setSkills([]);
      setModel("");
      setMaxIterations(10);
      setDirty(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const detail = await getAgent(currentAgent.name);
      // 如果已卸载或有更新的加载请求被发起，丢弃这次结果
      if (!mountedRef.current || token !== loadTokenRef.current) return;
      setContent(detail.soul ?? "You are a helpful assistant.");
      setDescription(detail.description ?? "");
      setSkills(
        Array.isArray(detail.skills)
          ? [...detail.skills].sort((a, b) => a.localeCompare(b))
          : []
      );
      setModel(detail.model?.trim() ?? "");
      setMaxIterations(
        typeof detail.max_iterations === "number" && detail.max_iterations > 0
          ? Math.min(1000, detail.max_iterations)
          : 10
      );
      setDirty(false);
    } catch (e) {
      if (!mountedRef.current || token !== loadTokenRef.current) return;
      setError(e instanceof Error ? e.message : "读取失败");
      setContent("");
      setDescription("");
      setSkills([]);
      setModel("");
      setMaxIterations(10);
    } finally {
      // 只有仍是最新请求时才重置 loading
      if (mountedRef.current && token === loadTokenRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const agentId = agent?.id ?? null;
  useEffect(() => {
    load();
  }, [agentId, load]);

  const save = useCallback(
    async (params: {
      soul?: string;
      description?: string;
      skills?: string[];
      model?: string;
      max_iterations?: number;
    }) => {
      const currentAgent = agentRef.current;
      if (!currentAgent) return;
      setLoading(true);
      setError(null);
      try {
        await updateAgent(currentAgent.name, params);
        if (!mountedRef.current) return;
        if (params.soul !== undefined) setContent(params.soul);
        if (params.description !== undefined) setDescription(params.description);
        if (params.skills !== undefined)
          setSkills(
            [...params.skills].sort((a, b) => a.localeCompare(b))
          );
        if (params.model !== undefined) setModel(params.model);
        if (params.max_iterations !== undefined)
          setMaxIterations(params.max_iterations);
        setDirty(false);
        setError(null);
      } catch (e) {
        if (!mountedRef.current) return;
        setError(e instanceof Error ? e.message : "保存失败");
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    []
  );

  const updateContent = useCallback((text: string) => {
    setContent(text);
    setDirty(true);
  }, []);

  const updateDescription = useCallback((text: string) => {
    setDescription(text);
    setDirty(true);
  }, []);

  const updateSkills = useCallback((next: string[]) => {
    setSkills([...next].sort((a, b) => a.localeCompare(b)));
    setDirty(true);
  }, []);

  const updateModel = useCallback((text: string) => {
    setModel(text);
    setDirty(true);
  }, []);

  const updateMaxIterations = useCallback((n: number) => {
    setMaxIterations(n);
    setDirty(true);
  }, []);

  return {
    content,
    description,
    skills,
    model,
    maxIterations,
    loading,
    error,
    dirty,
    updateContent,
    updateDescription,
    updateSkills,
    updateModel,
    updateMaxIterations,
    save,
    reload: load,
  };
}
