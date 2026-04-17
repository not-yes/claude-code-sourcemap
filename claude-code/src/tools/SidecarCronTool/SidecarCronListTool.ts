import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { readJobs } from '../../sidecar/handlers/cronHandler.js'
import { lazySchema } from '../../utils/lazySchema.js'

const inputSchema = lazySchema(() => z.strictObject({}))
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    jobs: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        schedule_type: z.string(),
        schedule: z.string(),
        enabled: z.boolean(),
        agent_id: z.string().optional(),
      }),
    ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type ListOutput = z.infer<OutputSchema>

export const SidecarCronListTool = buildTool({
  name: 'SidecarCronList',
  searchHint: 'list scheduled jobs in the desktop cron panel',
  maxResultSizeChars: 10_000,
  shouldDefer: false,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  async description() {
    return 'List all scheduled jobs in the desktop cron panel.'
  },
  async prompt() {
    return `List all scheduled jobs in the desktop cron panel.

Use this tool when the user asks to see, list, or review their scheduled tasks.`
  },
  async call() {
    const jobs = await readJobs()
    return {
      data: {
        jobs: jobs.map(j => ({
          id: j.id,
          name: j.name,
          schedule_type: j.schedule_type,
          schedule: j.schedule,
          enabled: j.enabled,
          agent_id: j.agent_id,
        })),
      },
    }
  },
  renderToolUseMessage() {
    return null
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (output.jobs.length === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: '暂无定时任务。',
      }
    }
    const lines = output.jobs.map(
      j => `${j.id} — "${j.name}" [${j.schedule_type}: ${j.schedule}]${j.enabled ? '' : ' [已禁用]'}`
    )
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: lines.join('\n'),
    }
  },
} satisfies ToolDef<InputSchema, ListOutput>)
