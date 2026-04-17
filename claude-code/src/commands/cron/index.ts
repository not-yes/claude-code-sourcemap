import { feature } from 'bun:bundle'
import type { Command } from '../../commands.js'

const cron = {
  type: 'prompt',
  name: 'cron',
  aliases: ['定时'],
  description: '通过自然语言创建定时任务（会显示在桌面定时任务面板中）',
  contentLength: 0,
  progressMessage: 'creating scheduled task',
  source: 'builtin',
  isEnabled: () => {
    if (feature('AGENT_TRIGGERS')) return true
    return false
  },
  allowedTools: [
    'SidecarCronCreate',
    'Bash',
    'GlobTool',
    'GrepTool',
    'FileReadTool',
    'FileEditTool',
    'FileWriteTool',
    'NotebookEditTool',
    'WebSearchTool',
    'WebFetchTool',
    'BrowserTool',
    'TaskCreateTool',
  ],
  async getPromptForCommand(args, context) {
    const agentId = context.agentId ?? 'main'
    return [
      {
        type: 'text',
        text: `【系统指令】用户通过 /cron 命令要求创建一条定时任务。这是最高优先级操作——你必须调用 **SidecarCronCreate** 工具来创建任务，不允许仅通过文本回复。不调用工具 = 任务不会被创建。

## 执行步骤（必须按顺序）

1. 分析用户输入，提取：任务名称、调度时间、执行指令
2. **立即调用 SidecarCronCreate 工具** — 这是唯一能让任务生效的方式
3. 任务创建成功后，向用户报告结果（任务名称、调度规则、任务ID）

## 参数规则

- **name**: 简短的任务名称（中文优先），不超过20字。例如："AI新闻总结"、"每日日报检查"
- **schedule_type**: 根据用户措辞判断：
  - "每天/每周/每小时/每 X 分钟" → **cron**（转换为 5 字段 cron 表达式，格式："分 时 日 月 周"）
  - "在 2024-... 执行" → **at**（格式："2024-12-25 09:45"）
  - "每隔 5 分钟" / "每 1 小时" → **every**（格式："5m"、"1h"、"30s"）
- **schedule**: 与 schedule_type 对应的表达式
  - cron 示例："45 9 * * *"（每天9:45）、"0 9 * * 1-5"（工作日9:00）
  - at 示例："2024-12-25 09:45"
  - every 示例："5m"、"1h"
- **instruction**: 任务执行时发给 Agent 的完整指令。如果用户没有明确给出执行指令，将用户的完整描述作为 instruction

## 重要提醒

- 如果你只回复文字而不调用 SidecarCronCreate，任务不会被创建，用户会在前端面板看不到任何任务
- 创建成功后任务会自动出现在桌面定时任务面板中

## 当前 agent
${agentId}

## 用户输入
${args || '（未提供细节）'}`,
      },
    ]
  },
} satisfies Command

export default cron
