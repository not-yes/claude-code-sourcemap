import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import {
  addCronJob,
  refreshCronSchedule,
  validateSchedule,
} from '../../sidecar/handlers/cronHandler.js'
import { lazySchema } from '../../utils/lazySchema.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    name: z.string().describe('任务名称，简短描述这条定时任务'),
    schedule: z.string().describe('调度表达式'),
    schedule_type: z
      .enum(['cron', 'at', 'every'])
      .optional()
      .describe("调度类型：'cron' | 'at' | 'every'，默认为 cron"),
    instruction: z.string().describe('任务执行时发给 Agent 的指令'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    job_id: z.string(),
    name: z.string(),
    schedule: z.string(),
    schedule_type: z.string(),
    agent_id: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const SidecarCronCreateTool = buildTool({
  name: 'SidecarCronCreate',
  searchHint: 'create a scheduled job for the desktop cron panel',
  maxResultSizeChars: 10_000,
  shouldDefer: false,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  async description() {
    return 'Create a scheduled task that appears in the desktop cron panel. Supports cron expressions, one-shot "at" times, or "every" intervals.'
  },
  async prompt() {
    return `Create a scheduled task in the desktop cron panel.

## Schedule Types

- **cron** (default): standard 5-field cron in local time — "分 时 日 月 周"
  - "0 9 * * *" → 每天早上 9:00
  - "0 9 * * 1-5" → 工作日早上 9:00
  - "*/10 * * * *" → 每 10 分钟
- **at**: a specific future time in ISO-like format
  - "2024-12-25 08:00"
- **every**: a fixed interval
  - "5m", "1h", "30s"

## Rules

1. Infer schedule_type from the user's wording:
   - "每天/每周/每小时/每 X 分钟" → cron (translate to 5-field cron)
   - "在 2024-... 执行" → at
   - "每隔 5 分钟" / "每 1 小时" → every
2. name should be a short Chinese or English label.
3. instruction is the full prompt the agent will run when the task fires.
4. When the user gives a natural-language time like "每天早上 8 点", translate it to the correct cron expression before calling this tool.`
  },
  async validateInput(input) {
    try {
      validateSchedule(input.schedule, input.schedule_type ?? 'cron')
      return { result: true }
    } catch (err: unknown) {
      return {
        result: false,
        message: err instanceof Error ? err.message : String(err),
        errorCode: 1,
      }
    }
  },
  async call({ name, schedule, schedule_type, instruction }, context) {
    const agentId = context.agentId ?? 'main'
    const result = await addCronJob({
      name,
      schedule,
      schedule_type: schedule_type ?? 'cron',
      instruction,
      enabled: true,
      agent_id: agentId,
    })
    refreshCronSchedule()
    return {
      data: {
        job_id: result.job_id,
        name,
        schedule,
        schedule_type: schedule_type ?? 'cron',
        agent_id: agentId,
      },
    }
  },
  renderToolUseMessage() {
    return null
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `已创建定时任务 "${output.name}"（ID: ${output.job_id}），调度: ${output.schedule}，类型: ${output.schedule_type}。任务会出现在前端定时任务面板中。`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
