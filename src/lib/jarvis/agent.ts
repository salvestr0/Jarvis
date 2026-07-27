import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

import { todayISO } from '@/lib/date'
import { getBotDb } from '@/lib/jarvis/db'
import { executeTool } from '@/lib/jarvis/execute'
import { loadHistory, saveTurn } from '@/lib/jarvis/history'
import { TOOL_SCHEMAS } from '@/lib/jarvis/tool-schemas'

/**
 * The Jarvis agent: one Telegram message in, one reply out.
 *
 * A manual tool loop rather than the SDK's beta toolRunner — at fifteen tools
 * and a hard iteration cap this is ~30 lines, has no beta-surface dependency,
 * and every step is inspectable in the Vercel function logs.
 */

const MODEL = 'claude-opus-5'
// Caps thinking + text combined. Answers are short; the ceiling is for the
// tool-calling turns in the middle, not the final reply.
const MAX_TOKENS = 8192
// A question needing more than 8 round trips is beyond what a chat bot
// should silently burn tokens on.
const MAX_ITERATIONS = 8

let cachedClient: Anthropic | null = null

function getClient(): Anthropic {
  // Lazy: `new Anthropic()` throws when ANTHROPIC_API_KEY is missing, and
  // module scope would turn that into a build-time failure.
  cachedClient ??= new Anthropic({ timeout: 120_000 })
  return cachedClient
}

function buildSystemPrompt(): string {
  return [
    "You are Jarvis, Jayden's personal assistant, speaking with him on Telegram.",
    `Today is ${todayISO()} (Asia/Singapore). Base currency is SGD.`,
    '',
    'You have tools over his real finance/life tracker. Use them rather than',
    'guessing; if a request is ambiguous (e.g. no amount), ask instead of assuming.',
    '',
    'Money fields in tool results carry integer cents plus a preformatted',
    '`display` string — always quote the display strings and never do your own',
    'currency arithmetic.',
    '',
    'This is Telegram: answer in a few short plain-text lines. No markdown',
    'tables, no headers, no asterisks. After logging something, confirm in one',
    'line what was recorded.',
  ].join('\n')
}

/** Everything Claude said in text blocks, joined — the Telegram reply. */
function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

export async function runJarvis(userText: string): Promise<string> {
  const db = await getBotDb()
  const history = await loadHistory(db)

  const messages: Anthropic.MessageParam[] = [
    ...history.map((t): Anthropic.MessageParam => ({ role: t.role, content: t.content })),
    { role: 'user', content: userText },
  ]

  let finalText = 'Sorry — that took too many steps. Try asking more directly.'

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Snappy replies; adaptive thinking stays on by default on Opus 5.
      output_config: { effort: 'low' },
      system: buildSystemPrompt(),
      tools: TOOL_SCHEMAS as Anthropic.Tool[],
      messages,
    })

    // Safety classifiers can decline a request — check before reading content.
    if (response.stop_reason === 'refusal') {
      finalText = "I can't help with that one."
      break
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    )

    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      finalText = textOf(response) || 'Done.'
      break
    }

    messages.push({ role: 'assistant', content: response.content })

    // All results go back in ONE user message; a failed tool reports its
    // error with is_error so Claude can recover instead of the turn dying.
    const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (block) => {
        try {
          return {
            type: 'tool_result' as const,
            tool_use_id: block.id,
            content: await executeTool(block.name, block.input, db),
          }
        } catch (error) {
          return {
            type: 'tool_result' as const,
            tool_use_id: block.id,
            content: error instanceof Error ? error.message : 'Tool failed.',
            is_error: true,
          }
        }
      })
    )
    messages.push({ role: 'user', content: results })
  }

  try {
    await saveTurn(db, userText, finalText)
  } catch (error) {
    // Losing one exchange of memory is not worth losing the reply.
    console.error(
      '[jarvis] history save failed:',
      error instanceof Error ? error.message : error
    )
  }

  return finalText
}
