import { timingSafeEqual } from 'node:crypto'

import { TOOL_SCHEMAS, type ToolSchema } from './tool-schemas.ts'

export type JarvisToolExecutor = (
  name: string,
  input: Record<string, unknown>
) => Promise<string>

export function isAuthorizedMcpRequest(
  headers: Headers,
  configuredSecret: string | undefined
): boolean {
  if (!configuredSecret || configuredSecret.length < 32) return false

  const authorization = headers.get('authorization')
  const match = authorization?.match(/^Bearer[ \t]+(.+)$/i)
  if (!match) return false

  const expected = Buffer.from(configuredSecret)
  const supplied = Buffer.from(match[1])
  return expected.length === supplied.length && timingSafeEqual(expected, supplied)
}

export type JarvisMcpTool = {
  name: string
  description: string
  inputSchema: ToolSchema['input_schema']
}

const CORE_MCP_TOOL_NAMES = [
  'get_net_worth',
  'get_net_worth_history',
  'get_month_summary',
  'get_month_transactions',
  'get_recurring',
  'get_holdings',
  'get_goals',
  'get_tasks',
  'get_jobs',
  'get_projects',
  'log_transaction',
  'create_task',
  'set_task_done',
  'create_goal',
  'set_goal_status',
] as const

const CORE_MCP_TOOLS = new Set<string>(CORE_MCP_TOOL_NAMES)

export function jarvisMcpTools(): JarvisMcpTool[] {
  return CORE_MCP_TOOL_NAMES.map((name) => {
    const { description, input_schema } = TOOL_SCHEMAS.find(
      (tool) => tool.name === name
    )!
    return {
      name,
      description,
      inputSchema: input_schema,
    }
  })
}

export async function executeJarvisMcpTool(
  name: string,
  input: Record<string, unknown>,
  executor: JarvisToolExecutor
): Promise<unknown> {
  if (!CORE_MCP_TOOLS.has(name)) {
    throw new Error(`Tool is not available: ${name}`)
  }

  const rawResult = await executor(name, input)
  try {
    return JSON.parse(rawResult)
  } catch {
    throw new Error('Jarvis tool returned malformed JSON.')
  }
}
