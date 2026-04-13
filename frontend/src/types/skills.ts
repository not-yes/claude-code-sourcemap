// -------- Skill 相关类型 --------

export interface SkillInfo {
  name: string;
  description: string;
  category: string;
  version: string;
  trigger_patterns: string[];
  suggested_tools: string[];
  source: string;
  file_path?: string;
  installed?: boolean;
}

export interface SkillScript {
  name: string;
  file: string;
  description: string;
}

export interface SkillDetail extends SkillInfo {
  file_path: string;
  guidance: string;
  suggested_action?: string;
  scripts?: SkillScript[];
}

export interface RemoteSkillItem {
  id: string;
  name: string;
  description: string;
  source: string;
  installed: boolean;
  install_command: string;
}
