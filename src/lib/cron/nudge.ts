import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

import { errorRow, extractUsageRow } from '@/lib/llm'
import { formatMoney } from '@/lib/money'
import { logLlmCall } from '@/lib/jarvis/llm-log'
import { getContentCounts } from '@/lib/queries/content'
import { getMetrics, getProjects } from '@/lib/queries/projects'
import { getTasks } from '@/lib/queries/tasks'
import { getWins } from '@/lib/queries/career'
import { dayWindowSgt, inDateRange } from '@/lib/review-window'
import type { Db } from '@/lib/queries/db'

/**
 * The evening content nudge (tasks/content-loop-design.md) — one composed
 * question at 21:30 SGT, built from TODAY's receipts. Delivered through the
 * reminders pipeline (kind='content_nudge'), so recurrence, claiming, and
 * retry are inherited; this module only gathers and composes.
 *
 * Design rules baked in: one nudge then silence (no follow-up machinery
 * exists at all), never guilt, and a static fallback question so the nudge
 * survives a model outage — same gather→compose→fallback shape as the
 * digest and weekly review.
 */

type NudgeContent = {
  today: string
  tasks_done_today: string[]
  wins_today: string[]
  project_metrics_today: string[]
  ideas_inbox: number
  drafts_waiting: number
}

/** The nudge that needs no model: short, zero guilt, still a real ask. */
const FALLBACK =
  'Anything from today worth capturing as a content idea? One line is enough.'

let cachedClient: Anthropic | null = null

function getClient(): Anthropic {
  cachedClient ??= new Anthropic({ timeout: 60_000 })
  return cachedClient
}

async function gather(db: Db, now: Date): Promise<NudgeContent> {
  const day = dayWindowSgt(now)

  const [tasks, wins, metrics, projects, counts] = await Promise.all([
    getTasks(db),
    getWins(db),
    getMetrics(db),
    getProjects(db),
    getContentCounts(db),
  ])

  const projectName = new Map(projects.map((p) => [p.id, p.name]))

  return {
    today: day.start,
    tasks_done_today: tasks
      .filter((t) => t.done && t.done_at !== null && t.done_at >= day.startInstant)
      .map((t) => t.title),
    wins_today: wins
      .filter((w) => inDateRange(w.occurred_on, day.start, day.endExclusive))
      .map((w) => w.title),
    project_metrics_today: metrics
      .filter((m) => inDateRange(m.as_of, day.start, day.endExclusive))
      .map(
        (m) =>
          `${projectName.get(m.project_id) ?? 'Project'}: MRR ${formatMoney(m.mrr_cents)}` +
          (m.users_count === null ? '' : `, ${m.users_count} users`)
      ),
    ideas_inbox: counts.ideas_inbox,
    drafts_waiting: counts.drafts_waiting,
  }
}

export async function runContentNudge(
  db: Db,
  now: Date
): Promise<{ text: string; composedBy: 'claude' | 'fallback' }> {
  const content = await gather(db, now)

  const callStart = Date.now()
  let response: Anthropic.Message
  try {
    response = await getClient().messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 300,
      output_config: { effort: 'low' },
      system: [
        "You are Jarvis, sending Jayden's single evening content nudge on",
        'Telegram. Plain text, no markdown, at most 3 short lines. Look at',
        "today's receipts and ask ONE pointed question. If something shipped",
        'today, name the most post-worthy thing and ask if he wants a draft',
        '("You shipped X today — that\'s a post. Want a draft?"). On an empty',
        'day, one short line asking if anything today is worth capturing —',
        'never guilt, never streaks, no cheerleading filler. If drafts are',
        'waiting to ship you may note the count in passing, but the question',
        'stays singular. Do not greet, do not sign off.',
      ].join('\n'),
      messages: [{ role: 'user', content: JSON.stringify(content) }],
    })
  } catch (error) {
    await logLlmCall(db, {
      source: 'content_nudge',
      latencyMs: Date.now() - callStart,
      ...errorRow('claude-sonnet-5', error),
    })
    console.error(
      '[nudge] compose failed, using fallback:',
      error instanceof Error ? error.message : error
    )
    return { text: FALLBACK, composedBy: 'fallback' }
  }

  await logLlmCall(db, {
    source: 'content_nudge',
    latencyMs: Date.now() - callStart,
    ...extractUsageRow(response),
  })

  try {
    if (response.stop_reason === 'refusal') throw new Error('compose refused')

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()

    if (!text) throw new Error('compose returned no text')
    return { text, composedBy: 'claude' }
  } catch (error) {
    console.error(
      '[nudge] compose failed, using fallback:',
      error instanceof Error ? error.message : error
    )
    return { text: FALLBACK, composedBy: 'fallback' }
  }
}
