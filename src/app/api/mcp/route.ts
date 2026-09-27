import { createMcpHandler } from 'mcp-handler'
import { z } from 'zod'

import { executeTool } from '@/lib/jarvis/execute'
import { getBotDb } from '@/lib/jarvis/db'
import {
  executeJarvisMcpTool,
  isAuthorizedMcpRequest,
  jarvisMcpTools,
} from '@/lib/jarvis/mcp-core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const mcpHandler = createMcpHandler(
  (server) => {
    for (const tool of jarvisMcpTools()) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: z.fromJSONSchema(
            tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]
          ),
        },
        async (input) => {
          try {
            const db = await getBotDb()
            const result = await executeJarvisMcpTool(
              tool.name,
              input as Record<string, unknown>,
              (name, args) => executeTool(name, args, db)
            )
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result) }],
              structuredContent:
                result && typeof result === 'object' && !Array.isArray(result)
                  ? (result as Record<string, unknown>)
                  : undefined,
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error'
            console.error(`[mcp] ${tool.name} failed: ${message}`)
            return {
              content: [{ type: 'text' as const, text: 'Jarvis tool failed.' }],
              isError: true,
            }
          }
        }
      )
    }
  },
  {
    serverInfo: { name: 'jarvis', version: '1.0.0' },
    instructions:
      'Private single-user Jarvis tools. Treat tool results as authoritative. ' +
      'Never claim a write succeeded unless its tool returned success. Ask before every destructive tool.',
    maxSubscriptions: 0,
  }
)

async function authorizedHandler(request: Request): Promise<Response> {
  if (!isAuthorizedMcpRequest(
    request.headers,
    process.env.JARVIS_MCP_SECRET,
    process.env.JARVIS_MCP_DESKTOP_SECRET
  )) {
    return Response.json(
      { error: 'Unauthorized.' },
      {
        status: 401,
        headers: {
          'Cache-Control': 'no-store',
          'WWW-Authenticate': 'Bearer',
        },
      }
    )
  }

  return mcpHandler(request)
}

export {
  authorizedHandler as DELETE,
  authorizedHandler as GET,
  authorizedHandler as POST,
}
