type HermesTurn = { role: 'user' | 'assistant'; content: string }

type HermesRunInput = {
  text: string
  telegramUpdateId: number
  history: HermesTurn[]
}

type HermesSettings = {
  serviceUrl: string
  secret: string
}

type Fetcher = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>

export async function runHermesAgent(
  input: HermesRunInput,
  settings: HermesSettings,
  fetcher: Fetcher = fetch
): Promise<string> {
  const base = new URL(settings.serviceUrl)
  if (base.protocol !== 'https:') throw new Error('Hermes service URL must use HTTPS.')
  if (settings.secret.length < 32) throw new Error('Hermes shared secret is too short.')
  const url = new URL('/run', base.origin)

  const response = await fetcher(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${settings.secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text: input.text,
      telegram_update_id: input.telegramUpdateId,
      history: input.history,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(55_000),
  })
  if (!response.ok) {
    throw new Error(`Hermes service returned status ${response.status}.`)
  }
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
    throw new Error('Hermes service response was too large.')
  }
  const raw = await response.text()
  if (raw.length > 64 * 1024) throw new Error('Hermes service response was too large.')

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    throw new Error('Hermes service returned malformed JSON.')
  }
  const candidate = body as { ok?: unknown; response?: unknown }
  if (candidate.ok !== true || typeof candidate.response !== 'string') {
    throw new Error('Hermes service returned an invalid response.')
  }
  const result = candidate.response.trim()
  if (!result || result.length > 4_000) {
    throw new Error('Hermes service returned an invalid response length.')
  }
  return result
}
