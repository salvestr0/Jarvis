import type Anthropic from '@anthropic-ai/sdk'

/**
 * Pure LLM-observability logic: turning an API response into a loggable
 * row, pricing tokens into cents, and aggregating rows for the /llm page.
 *
 * Deliberately import-free (type-only imports aside) so `node --test` can
 * run it directly, same as the other pure lib modules. The actual insert
 * lives in jarvis/llm-log.ts; the fetchers in queries/llm.ts.
 */

export type LlmSource = 'telegram' | 'digest' | 'weekly_review' | 'content_nudge'

/** Everything storable that comes out of one API call (or its failure). */
export type LlmUsageRow = {
  model: string
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  stop_reason: string | null
  tools_called: string[]
  error: string | null
}

/** Extract the loggable fields from a successful response. */
export function extractUsageRow(response: Anthropic.Message): LlmUsageRow {
  // web_search included: since the move to DeepSeek + Brave it is an
  // ordinary client-side tool, so it shows up here like any other.
  const toolsCalled = response.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    .map((b) => b.name)

  return {
    // response.model over the request constant: it's what actually served.
    model: response.model,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
    stop_reason: response.stop_reason,
    tools_called: toolsCalled,
    error: null,
  }
}

/** The row for a call that threw — no Message exists, so no usage at all. */
export function errorRow(model: string, error: unknown): LlmUsageRow {
  return {
    model,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    stop_reason: null,
    tools_called: [],
    error: error instanceof Error ? error.message : 'Unknown error',
  }
}

// ---------------------------------------------------------------------------
// Pricing — cost is computed at display time from tokens, never stored, so a
// price change means editing this table, not migrating data.
// ---------------------------------------------------------------------------

type Pricing = {
  inputPerMTokCents: number
  outputPerMTokCents: number
  /** Cache-write tokens bill at this multiple of the input rate. */
  cacheWriteMult: number
  /** Cache-read tokens bill at this multiple of the input rate. */
  cacheReadMult: number
}

// claude-sonnet-5: $3/$15 per MTok standard, intro $2/$10 through
// 2026-08-31 (per Anthropic pricing as of 5 Aug 2026). The row's
// created_at picks the rate so historical spend keeps matching the
// invoice after the intro window ends. Anthropic bills cache writes at
// 1.25x input and reads at 0.1x.
const SONNET_5_INTRO: Pricing = {
  inputPerMTokCents: 200,
  outputPerMTokCents: 1000,
  cacheWriteMult: 1.25,
  cacheReadMult: 0.1,
}
const SONNET_5_STANDARD: Pricing = {
  inputPerMTokCents: 300,
  outputPerMTokCents: 1500,
  cacheWriteMult: 1.25,
  cacheReadMult: 0.1,
}

// deepseek-v4-flash: $0.14/$0.28 per MTok (per DeepSeek pricing as of
// 12 Aug 2026). Caching is automatic with no write surcharge; cache-hit
// input bills at $0.0028/MTok = 0.02x the miss rate.
const DEEPSEEK_V4_FLASH: Pricing = {
  inputPerMTokCents: 14,
  outputPerMTokCents: 28,
  cacheWriteMult: 1,
  cacheReadMult: 0.02,
}

function pricingFor(model: string, createdAtIso: string): Pricing | null {
  if (model.startsWith('deepseek-v4-flash')) return DEEPSEEK_V4_FLASH
  if (model.startsWith('claude-sonnet-5')) {
    return createdAtIso < '2026-09' ? SONNET_5_INTRO : SONNET_5_STANDARD
  }
  return null
}

export type LlmCostFields = {
  created_at: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

/**
 * Estimated cost in fractional US cents. Unknown model -> 0: a future
 * model id must never crash the page, just show up costless until the
 * pricing table learns it. Cache multipliers are per-model (see Pricing).
 */
export function estimateCostCents(row: LlmCostFields): number {
  const p = pricingFor(row.model, row.created_at)
  if (!p) return 0
  return (
    (row.input_tokens * p.inputPerMTokCents +
      row.output_tokens * p.outputPerMTokCents +
      row.cache_creation_input_tokens * p.inputPerMTokCents * p.cacheWriteMult +
      row.cache_read_input_tokens * p.inputPerMTokCents * p.cacheReadMult) /
    1_000_000
  )
}

// ---------------------------------------------------------------------------
// Aggregation for the /llm page.
// ---------------------------------------------------------------------------

/** A UTC timestamp as 'YYYY-MM-DD' in Singapore time — buckets by SGT day. */
export function sgtDateOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

export type DailyLlmTotal = {
  date: string
  calls: number
  inputTokens: number
  outputTokens: number
  costCents: number
}

/** Per-SGT-day totals, newest day first. */
export function dailyTotals(rows: LlmCostFields[]): DailyLlmTotal[] {
  const byDate = new Map<string, DailyLlmTotal>()
  for (const row of rows) {
    const date = sgtDateOf(row.created_at)
    const entry =
      byDate.get(date) ??
      { date, calls: 0, inputTokens: 0, outputTokens: 0, costCents: 0 }
    entry.calls += 1
    entry.inputTokens += row.input_tokens
    entry.outputTokens += row.output_tokens
    entry.costCents += estimateCostCents(row)
    byDate.set(date, entry)
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1))
}

/**
 * Nearest-rank p95 latency; null on an empty set. Coarse at single-user
 * volumes, but "how slow are the slow ones" beats an average that one
 * 30s outlier drags around.
 */
export function p95LatencyMs(rows: { latency_ms: number }[]): number | null {
  if (rows.length === 0) return null
  const sorted = rows.map((r) => r.latency_ms).sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
  return sorted[idx]
}

export function totalCostCents(rows: LlmCostFields[]): number {
  return rows.reduce((sum, row) => sum + estimateCostCents(row), 0)
}
