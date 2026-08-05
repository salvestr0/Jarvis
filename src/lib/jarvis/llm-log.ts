import 'server-only'

import type { Db } from '@/lib/queries/db'
import type { LlmSource, LlmUsageRow } from '@/lib/llm'

/**
 * The one write path into llm_calls. Observability must never cost a
 * reply: this function catches its own failures and only logs them, so
 * call sites need no try/catch around logging. (Deliberately stricter
 * than history.ts's throw-and-let-caller-catch — there are 4 sites x up
 * to 8 loop iterations, and a wrapper per site would be pure noise.)
 */
export async function logLlmCall(
  db: Db,
  row: {
    source: LlmSource
    turnId?: string
    iteration?: number
    latencyMs: number
  } & LlmUsageRow
): Promise<void> {
  try {
    const { error } = await db.client.from('llm_calls').insert({
      user_id: db.userId,
      source: row.source,
      turn_id: row.turnId ?? null,
      iteration: row.iteration ?? null,
      model: row.model,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cache_creation_input_tokens: row.cache_creation_input_tokens,
      cache_read_input_tokens: row.cache_read_input_tokens,
      latency_ms: row.latencyMs,
      stop_reason: row.stop_reason,
      tools_called: row.tools_called,
      error: row.error,
    })
    if (error) console.error('[llm-log] insert failed:', error.message)
  } catch (error) {
    console.error(
      '[llm-log] insert threw:',
      error instanceof Error ? error.message : error
    )
  }
}
