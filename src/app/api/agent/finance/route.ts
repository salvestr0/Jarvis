import { isAuthorizedAgentRequest } from '@/lib/jarvis/agent-auth'
import { createFinanceCapabilityAdapter } from '@/lib/jarvis/finance-capability-adapter'
import { parseAgentCapabilityEnvelope } from '@/lib/jarvis/finance-capability-schema'
import { executeFinanceCapability } from '@/lib/jarvis/finance-capabilities'
import { getBotDb } from '@/lib/jarvis/db'
import { FinanceCapabilityError } from '@/lib/jarvis/email-expense-workflow'

export const runtime = 'nodejs'
export const maxDuration = 60

function json(status: number, body: unknown) {
  return Response.json(body, { status })
}

export async function POST(request: Request) {
  if (!isAuthorizedAgentRequest(request.headers, process.env.AGENT_SERVICE_SECRET)) {
    return json(401, { error: 'Unauthorized.' })
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
    return json(413, { error: 'Request is too large.' })
  }

  let envelope: ReturnType<typeof parseAgentCapabilityEnvelope>
  try {
    envelope = parseAgentCapabilityEnvelope(await request.json())
  } catch (error) {
    return json(400, {
      error: error instanceof Error ? error.message : 'Invalid request.',
    })
  }

  try {
    const db = await getBotDb()
    const result = await executeFinanceCapability(
      envelope.request,
      envelope.context,
      createFinanceCapabilityAdapter(db)
    )
    return json(200, { ok: true, result })
  } catch (error) {
    if (error instanceof FinanceCapabilityError) {
      return json(409, { error: error.message })
    }
    console.error('Agent finance capability failed', {
      capability: envelope.request.name,
      message: error instanceof Error ? error.message : 'unknown',
    })
    return json(502, { error: 'Finance capability failed.' })
  }
}
