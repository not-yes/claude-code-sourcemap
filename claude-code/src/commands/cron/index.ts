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
        text: `用户想在当前 agent（${agentId}）中通过自然语言创建一条定时任务，最终会显示在桌面的定时任务面板中。

请根据用户的描述，调用 **SidecarCronCreate** 工具来创建任务。调度类型选择规则：
- "每天/每周/每小时/每 X 分钟" → schedule_type: cron（转换为 5 字段 cron 表达式）
- "在 2024-... 执行" → schedule_type: at
- "每隔 5 分钟" / "每 1 小时" → schedule_type: every

如果用户没有给出明确的执行指令（instruction），请把整句话作为 instruction。

用户输入：${args || '（未提供细节）'}`,
      },
    ]
  },
} satisfies Command

export default cron
