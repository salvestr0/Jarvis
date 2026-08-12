import 'server-only'

import type Anthropic from '@anthropic-ai/sdk'

import { errorRow, extractUsageRow } from '@/lib/llm'
import { formatMoney } from '@/lib/money'
import { getLlmClient, LLM_MODEL } from '@/lib/jarvis/llm-client'
import { logLlmCall } from '@/lib/jarvis/llm-log'
import { getFacts } from '@/lib/queries/facts'
import { getGoals } from '@/lib/queries/goals'
import { getMetrics, getProjects } from '@/lib/queries/projects'
import { getNetWorthHistory } from '@/lib/queries/dashboard'
import { getTasks } from '@/lib/queries/tasks'
import { getTransactionsForMonth, summariseMonth, totalsByCategory } from '@/lib/queries/money'
import { getWins } from '@/lib/queries/career'
import { addDaysIso, inDateRange, weekWindowSgt } from '@/lib/review-window'
import { formatSgt } from '@/lib/reminders'
import type { Db } from '@/lib/queries/db'

/**
 * The Sunday weekly review — the week's receipts.
 *
 * Same architecture as the morning digest (cron/digest.ts): gather, let
 * Claude compose, fall back to a deterministic render if the model call
 * fails — the review goes out even when the API is having a day. Delivered
 * through the reminders pipeline (a kind='weekly_review' row), so
 * recurrence, claiming, and retry are all inherited.
 *
 * Tracker data only, deliberately: the digest owns calendar/email, and the
 * first version of this shouldn't inherit Google's failure modes.
 */

type ReviewContent = {
  week_of: string
  shipped: {
    tasks_done: { title: string; goal: string | null }[]
    wins: string[]
    project_metrics: string[]
    goals_achieved_total: number
  }
  money: {
    this_week: { income: string; spent: string; count: number }
    last_week: { income: string; spent: string; count: number }
    top_expense_categories: { name: string; total: string }[]
  }
  net_worth: { now: string; week_ago: string; change: string } | null
  open_loops: {
    overdue: { title: string; due_on: string }[]
    due_next_7_days: { title: string; due_on: string }[]
  }
  active_goals: string[]
  facts: string[]
}

async function gather(db: Db, now: Date): Promise<ReviewContent> {
  const w = weekWindowSgt(now)
  const todaySgt = formatSgt(now).slice(0, 10)

  const [tasks, wins, metrics, projects, goals, netWorth, facts, ...txnMonths] =
    await Promise.all([
      getTasks(db),
      getWins(db),
      getMetrics(db),
      getProjects(db),
      getGoals(db),
      getNetWorthHistory(8, db),
      getFacts(db),
      ...w.months.map((m) => getTransactionsForMonth(m, db)),
    ])

  const txns = txnMonths.flat()
  const thisWeekTxns = txns.filter((t) => inDateRange(t.occurred_on, w.start, w.endExclusive))
  const lastWeekTxns = txns.filter((t) => inDateRange(t.occurred_on, w.prevStart, w.start))
  const thisWeek = summariseMonth(thisWeekTxns)
  const lastWeek = summariseMonth(lastWeekTxns)

  const projectName = new Map(projects.map((p) => [p.id, p.name]))

  const oldest = netWorth[0]
  const latest = netWorth[netWorth.length - 1]
  const netWorthSection =
    netWorth.length >= 2
      ? {
          now: formatMoney(latest.totalCents),
          week_ago: formatMoney(oldest.totalCents),
          change: formatMoney(latest.totalCents - oldest.totalCents),
        }
      : null

  const openTasks = tasks.filter((t) => !t.done)

  return {
    week_of: w.start,
    shipped: {
      tasks_done: tasks
        .filter((t) => t.done && t.done_at !== null && t.done_at >= w.startInstant)
        .map((t) => ({ title: t.title, goal: t.goal_title })),
      wins: wins
        .filter((win) => inDateRange(win.occurred_on, w.start, w.endExclusive))
        .map((win) => win.title),
      project_metrics: metrics
        .filter((m) => inDateRange(m.as_of, w.start, w.endExclusive))
        .map(
          (m) =>
            `${projectName.get(m.project_id) ?? 'Project'}: MRR ${formatMoney(m.mrr_cents)}` +
            (m.users_count === null ? '' : `, ${m.users_count} users`)
        ),
      goals_achieved_total: goals.filter((g) => g.status === 'achieved').length,
    },
    money: {
      this_week: {
        income: formatMoney(thisWeek.incomeCents),
        spent: formatMoney(thisWeek.expenseCents),
        count: thisWeek.count,
      },
      last_week: {
        income: formatMoney(lastWeek.incomeCents),
        spent: formatMoney(lastWeek.expenseCents),
        count: lastWeek.count,
      },
      top_expense_categories: totalsByCategory(thisWeekTxns, 'expense')
        .slice(0, 3)
        .map((c) => ({ name: c.name, total: formatMoney(c.totalCents) })),
    },
    net_worth: netWorthSection,
    open_loops: {
      overdue: openTasks
        .filter((t) => t.due_on !== null && t.due_on < todaySgt)
        .map((t) => ({ title: t.title, due_on: t.due_on as string })),
      due_next_7_days: openTasks
        .filter(
          (t) =>
            t.due_on !== null && inDateRange(t.due_on, todaySgt, addDaysIso(todaySgt, 7))
        )
        .map((t) => ({ title: t.title, due_on: t.due_on as string })),
    },
    active_goals: goals.filter((g) => g.status === 'active').map((g) => g.title),
    facts: facts.map((f) => f.content),
  }
}

/** Deterministic rendering — the review that needs no model at all. */
function fallbackRender(c: ReviewContent): string {
  const lines: string[] = [`Weekly review — week of ${c.week_of}`]

  const done = c.shipped.tasks_done
  lines.push(
    done.length === 0
      ? 'Tasks completed: none this week.'
      : `Tasks completed (${done.length}):`
  )
  for (const t of done) lines.push(`• ${t.title}${t.goal ? ` → ${t.goal}` : ''}`)

  for (const win of c.shipped.wins) lines.push(`🏆 ${win}`)
  for (const m of c.shipped.project_metrics) lines.push(`📈 ${m}`)

  lines.push(
    `Money: spent ${c.money.this_week.spent} (last week ${c.money.last_week.spent}), ` +
      `income ${c.money.this_week.income}.`
  )
  for (const cat of c.money.top_expense_categories) {
    lines.push(`• ${cat.name}: ${cat.total}`)
  }

  if (c.net_worth) {
    lines.push(`Net worth: ${c.net_worth.now} (${c.net_worth.change} over the week).`)
  }

  if (c.open_loops.overdue.length > 0) {
    lines.push('Overdue:')
    for (const t of c.open_loops.overdue) lines.push(`• ${t.title} (${t.due_on})`)
  }
  if (c.open_loops.due_next_7_days.length > 0) {
    lines.push('Coming up:')
    for (const t of c.open_loops.due_next_7_days) lines.push(`• ${t.title} (${t.due_on})`)
  }

  return lines.join('\n')
}

export async function runWeeklyReview(
  db: Db,
  now: Date
): Promise<{ text: string; composedBy: 'claude' | 'fallback' }> {
  const content = await gather(db, now)

  const callStart = Date.now()
  let response: Anthropic.Message
  try {
    response = await getLlmClient().messages.create({
      model: LLM_MODEL,
      max_tokens: 1500,
      system: [
        "You are Jarvis, writing Jayden's Sunday-evening weekly review for",
        'Telegram. Plain text, short lines, no markdown. This is an evidence',
        'report: lead with what he actually SHIPPED this week — completed',
        'tasks, wins, project metrics — concrete and specific. Then money',
        '(quote the display strings exactly, never do arithmetic), net worth,',
        'and open loops for next week. He fights the feeling of never doing',
        'enough, so the receipts matter: state plainly what got done. On a',
        'quiet week, be honest — no manufactured cheer — but frame against',
        'consistency (showing up again Monday), never against a fantasy week.',
        'Use the facts list only where it connects work to his stated goals.',
        'End with ONE specific, encouraging line for the coming week.',
      ].join('\n'),
      messages: [{ role: 'user', content: JSON.stringify(content) }],
    })
  } catch (error) {
    await logLlmCall(db, {
      source: 'weekly_review',
      latencyMs: Date.now() - callStart,
      ...errorRow(LLM_MODEL, error),
    })
    console.error(
      '[review] compose failed, using fallback:',
      error instanceof Error ? error.message : error
    )
    return { text: fallbackRender(content), composedBy: 'fallback' }
  }

  await logLlmCall(db, {
    source: 'weekly_review',
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
      '[review] compose failed, using fallback:',
      error instanceof Error ? error.message : error
    )
    return { text: fallbackRender(content), composedBy: 'fallback' }
  }
}
