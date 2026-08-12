/**
 * Web search for the Jarvis agent, via the Brave Search API.
 *
 * This replaced Anthropic's server-side web_search tool when Jarvis moved to
 * DeepSeek (which has no server-side search): now it's an ordinary tool —
 * the model asks, we fetch, the results go back as a tool_result. Free tier
 * is 2,000 queries/month; MAX_ITERATIONS in agent.ts caps a runaway turn.
 *
 * formatSearchResults is deliberately import-free so `node --test` can run
 * it directly, same as the other pure lib modules. Snippets come back with
 * HTML markup (<strong>, entities) — stripped here so the model never sees
 * markup it might echo into a Telegram reply.
 */

export type SearchResult = {
  title: string
  url: string
  description: string
}

const MAX_RESULTS = 5

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/** Brave's response, reduced to what the model needs — a JSON string. */
export function formatSearchResults(raw: unknown): string {
  const results =
    (raw as { web?: { results?: unknown[] } })?.web?.results ?? []

  const cleaned: SearchResult[] = results
    .slice(0, MAX_RESULTS)
    .flatMap((r) => {
      const { title, url, description } = (r ?? {}) as Record<string, unknown>
      if (typeof title !== 'string' || typeof url !== 'string') return []
      return [
        {
          title: stripHtml(title),
          url,
          description: typeof description === 'string' ? stripHtml(description) : '',
        },
      ]
    })

  if (cleaned.length === 0) {
    return JSON.stringify({ results: [], note: 'No results found for this query.' })
  }
  return JSON.stringify({ results: cleaned })
}

export async function braveSearch(query: string): Promise<string> {
  const key = process.env.BRAVE_SEARCH_API_KEY
  if (!key) {
    throw new Error(
      'Web search is not configured yet (Brave Search API key missing) — tell Jayden, and answer from what you know.'
    )
  }

  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(MAX_RESULTS))

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': key,
    },
    // Well inside the agent loop's per-round budget; a hung search should
    // fail the tool call, not eat the turn's deadline.
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    // 429 = free-tier rate limit; the message is model-facing either way.
    throw new Error(`Web search failed (HTTP ${response.status}). Try again or answer without it.`)
  }

  return formatSearchResults(await response.json())
}
