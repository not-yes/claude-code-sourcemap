// -------- Agent 相关类型 --------

export interface AgentInfo {
  name: string;
  description?: string;
  topology?: string;
  skills?: string[];
  handoffs?: string[];
  has_memory?: boolean;
}

export interface AgentDetail extends AgentInfo {
  soul?: string;
  memory?: {
    enabled: boolean;
    memory_type: string;
    persist: boolean;
  };
  hitl?: {
    enabled: boolean;
    strict_mode?: boolean;
    before_tools?: boolean;
  };
  model?: string;
  max_iterations?: number;
}

/** 与后端 PUT /agents/:name 中 topology 字符串一致 */
export const AGENT_TOPOLOGY_OPTIONS = ["react", "dag", "linear"] as const;
export type AgentTopologyOption = (typeof AGENT_TOPOLOGY_OPTIONS)[number];

// -------- Agent Memory 相关类型 --------

export interface AgentMemoryStatsCounts {
  short_term_count: number;
  long_term_count: number;
  episodic_count: number;
  total?: number;
}

export interface AgentMemoryStatsResult {
  agent: string;
  stats: AgentMemoryStatsCounts;
}

export interface AgentMemoryEntry {
  id: string;
  content: string;
  importance?: number;
  created_at?: string;
  access_count?: number;
}
