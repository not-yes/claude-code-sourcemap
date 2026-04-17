import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { deleteCronJob, readJobs, refreshCronSchedule } from '../../sidecar/handlers/cronHandler.js'
import { lazySchema } from '../../utils/lazySchema.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    id: z.string().describe('定时任务 ID（创建时返回的 job_id）'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    id: z.string(),
    name: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type DeleteOutput = z.infer<OutputSchema>

export const SidecarCronDeleteTool = buildTool({
  name: 'SidecarCronDelete',
  searchHint: 'delete a scheduled job from the desktop cron panel',
  maxResultSizeChars: 10_000,
  shouldDefer: false,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  async description() {
    return 'Delete a scheduled job from the desktop cron panel by its ID.'
  },
  async prompt() {
    return `Delete a scheduled job from the desktop cron panel.

Rules:
1. Only delete jobs the user explicitly asks to remove.
2. If the user does not provide the ID, use SidecarCronList first to find it.`
  },
  async validateInput(input) {
    const jobs = await readJobs()
    const job = jobs.find(j => j.id === input.id)
    if (!job) {
      return {
        result: false,
        message: `定时任务不存在: ${input.id}`,
        errorCode: 1,
      }
    }
    return { result: true }
  },
  async call({ id }) {
    const jobs = await readJobs()
    const job = jobs.find(j => j.id === id)
    const name = job?.name ?? id
    await deleteCronJob({ id })
    refreshCronSchedule()
    return { data: { id, name } }
  },
  renderToolUseMessage() {
    return null
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `已删除定时任务 "${output.name}"（ID: ${output.id}）。`,
    }
  },
} satisfies ToolDef<InputSchema, DeleteOutput>)
