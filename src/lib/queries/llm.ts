import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Db } from '@/lib/queries/db'

/**
 * Read side of llm_calls (the write side is jarvis/llm-log.ts). Same
 * shared-queries contract as every other domain: cookie-session client
 * for the web app, explicit Db + user_id filter for bot/cron callers.
 */

export type LlmCallRecord = {
  id: string
  created_at: string
  source: string
  turn_id: string | null
  iteration: number | null
  model: string
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  latency_ms: number
  stop_reason: string | null
  tools_called: string[]
  error: string | null
}

// One literal on purpose: supabase-js infers row types from the literal
// string, and a concatenated value degrades the result to an error type.
const COLUMNS =
  'id, created_at, source, turn_id, iteration, model, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, latency_ms, stop_reason, tools_called, error'

/** Newest calls first — the /llm page's raw feed. */
export async function getRecentLlmCalls(
  limit = 20,
  db?: Db
): Promise<LlmCallRecord[]> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase.from('llm_calls').select(COLUMNS)
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Could not load LLM calls: ${error.message}`)
  return (data ?? []) as LlmCallRecord[]
}

/** Every call since an instant, newest first — feeds the JS aggregation. */
export async function getLlmCallsSince(
  sinceIso: string,
  db?: Db
): Promise<LlmCallRecord[]> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase.from('llm_calls').select(COLUMNS).gte('created_at', sinceIso)
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query.order('created_at', { ascending: false })

  if (error) throw new Error(`Could not load LLM calls: ${error.message}`)
  return (data ?? []) as LlmCallRecord[]
}
