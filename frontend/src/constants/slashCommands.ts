export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "cron", aliases: ["定时"], description: "通过自然语言创建一条定时任务" },
  { name: "plan", description: "进入计划模式，让 AI 先制定执行计划" },
  { name: "init", description: "初始化项目上下文 (CLAUDE.md)" },
  { name: "compact", description: "压缩会话上下文，保留摘要" },
];
