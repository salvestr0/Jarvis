import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

/**
 * The one LLM client for all four call sites (agent, digest, weekly review,
 * content nudge). Jarvis runs on DeepSeek V4 Flash through DeepSeek's
 * Anthropic-compatible endpoint, so the SDK, message shapes, and the manual
 * tool loop are unchanged from the Claude days — only the base URL, key, and
 * model id differ. Centralized here so a future model switch is one file.
 */

export const LLM_MODEL = 'deepseek-v4-flash'
// Used only after an integrity failure or repeated tool errors. Normal turns
// stay on Flash; this is a reliability escape hatch, not the default bill.
export const LLM_FALLBACK_MODEL = 'deepseek-v4-pro'

let cachedClient: Anthropic | null = null

export function getLlmClient(): Anthropic {
  // Lazy: constructing at module scope would turn a missing env var into a
  // build-time failure. 120s timeout fits the agent loop's deadline math
  // (see agent.ts DEADLINE_MS); the cron composers finish far sooner.
  cachedClient ??= new Anthropic({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com/anthropic',
    timeout: 120_000,
  })
  return cachedClient
}
