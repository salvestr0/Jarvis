import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

import { currentMonth, shiftMonth, todayISO } from '@/lib/date'
import { listEvents, type CalendarEvent } from '@/lib/google/calendar'
import { searchMessages, type EmailSummary } from '@/lib/google/gmail'
import { errorRow, extractUsageRow } from '@/lib/llm'
import { getBotDb } from '@/lib/jarvis/db'
import { logLlmCall } from '@/lib/jarvis/llm-log'
import { saveAssistantNote } from '@/lib/jarvis/history'
import { computeSignals, type Signal } from '@/lib/jarvis/signals'
import type { Db } from '@/lib/queries/db'
import { getNetWorthHistory } from '@/lib/queries/dashboard'
import { getFacts } from '@/lib/queries/facts'
import { getGoals } from '@/lib/queries/goals'
import { getSettings } from '@/lib/queries/settings'
import { getTransactionsForMonth, summariseMonth } from '@/lib/queries/money'
import { getRecurring } from '@/lib/queries/recurring'
import { getTasks } from '@/lib/queries/tasks'
import { sendMessage } from '@/lib/telegram/api'
import { chunkTelegramMessage } from '@/lib/telegram/format'

/**
 * The morning digest: Jarvis speaking first.
 *
 * Runs on the daily cron (after the price job, so today's snapshot exists),
 * respects the /settings preferences, degrades gracefully when Google is
 * down, and always has a deterministic fallback if the Claude compose call
 * fails — the briefing must go out even when the model API is having a day.
 */

export type DigestReport = {
  mode: 'daily' | 'noteworthy' | 'off'
  skipped: 'mode_off' | 'nothing_noteworthy' | null
  signals: number
  sections: string[]
  googleErrors: string[]
  composedBy: 'claude' | 'fallback' | null
  chunksSent: number
  historySaved: boolean
}

let cachedClient: Anthropic | null = null

function getClient(): Anthropic {
  cachedClient ??= new Anthropic({ timeout: 60_000 })
  return cachedClient
}

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

type DigestContent = {
  today: string
  signals: Signal[]
  events: CalendarEvent[] | null
  emails: EmailSummary[] | null
  /** Jarvis's long-term memory — lets the digest notice birthdays, budgets… */
  facts: string[]
}

/** Plain deterministic rendering — the digest that needs no model at all. */
function fallbackRender(content: DigestContent): string {
  const lines: string[] = [`Morning briefing — ${content.today}`]

  for (const s of content.signals) lines.push(`• ${s.text}`)

  if (content.events) {
    if (content.events.length === 0) {
      lines.push('Calendar: nothing scheduled today.')
    } else {
      lines.push('Today:')
      for (const ev of content.events) {
        lines.push(
          ev.allDay
            ? `• ${ev.summary} (all day)`
            : `• ${ev.start.slice(11, 16)} ${ev.summary}`
        )
      }
    }
  }

  if (content.emails && content.emails.length > 0) {
    lines.push('Unread:')
    for (const e of content.emails) lines.push(`• ${e.subject} — ${e.from}`)
  }

  if (lines.length === 1) lines.push('All quiet. Have a good one.')
  return lines.join('\n')
}

async function composeDigest(
  content: DigestContent,
  db: Db
): Promise<{ text: string; composedBy: 'claude' | 'fallback' }> {
  const callStart = Date.now()
  let response: Anthropic.Message
  try {
    response = await getClient().messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      output_config: { effort: 'low' },
      system: [
        "You are Jarvis, writing Jayden's short morning briefing for Telegram.",
        'Plain text only, a few short lines, no markdown. Lead with anything',
        'urgent (the "notable" signals), then the day at a glance. Quote the',
        'money strings exactly as given — never do your own arithmetic. The',
        'facts list is your long-term memory about Jayden — mention a fact',
        "only when today makes it relevant (a birthday, a budget he's near).",
        'If there is nothing at all, say so in one warm line.',
      ].join('\n'),
      messages: [{ role: 'user', content: JSON.stringify(content) }],
    })
  } catch (error) {
    await logLlmCall(db, {
      source: 'digest',
      latencyMs: Date.now() - callStart,
      ...errorRow('claude-sonnet-5', error),
    })
    console.error(
      '[cron/digest] compose failed, using fallback:',
      error instanceof Error ? error.message : error
    )
    return { text: fallbackRender(content), composedBy: 'fallback' }
  }

  await logLlmCall(db, {
    source: 'digest',
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
      '[cron/digest] compose failed, using fallback:',
      error instanceof Error ? error.message : error
    )
    return { text: fallbackRender(content), composedBy: 'fallback' }
  }
}

export async function runDailyDigest(): Promise<DigestReport> {
  const report: DigestReport = {
    mode: 'daily',
    skipped: null,
    signals: 0,
    sections: [],
    googleErrors: [],
    composedBy: null,
    chunksSent: 0,
    historySaved: false,
  }

  const db = await getBotDb()
  const settings = await getSettings(db)
  report.mode = settings.digest_mode

  if (settings.digest_mode === 'off') {
    report.skipped = 'mode_off'
    return report
  }

  const chatId = Number(process.env.TELEGRAM_USER_ID)
  if (!chatId) {
    // Same fail-closed stance as the webhook route.
    throw new Error('TELEGRAM_USER_ID is not set — nowhere to send the digest.')
  }

  const today = todayISO()

  // Google sections degrade: an outage becomes a note in the report, never a
  // dead digest. Supabase failures below, by contrast, are fatal on purpose.
  const guard = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      const result = await fn()
      report.sections.push(label)
      return result
    } catch (error) {
      report.googleErrors.push(
        `${label}: ${error instanceof Error ? error.message : 'failed'}`
      )
      return null
    }
  }

  const events = settings.digest_calendar
    ? await guard('calendar', () =>
        listEvents({
          timeMin: `${today}T00:00:00+08:00`,
          timeMax: `${today}T23:59:59+08:00`,
          maxResults: 10,
        })
      )
    : null

  const emails = settings.digest_email
    ? await guard('email', () =>
        searchMessages('is:unread newer_than:1d category:primary', 3)
      )
    : null

  // Data for the signal rules — only for sections that are switched on.
  // Facts always load: memory applies regardless of section toggles.
  const month = currentMonth()
  const [facts, recurring, tasks, netWorth, goals, thisMonth, prior1, prior2] =
    await Promise.all([
      getFacts(db),
      settings.digest_money ? getRecurring(db) : [],
      settings.digest_tasks ? getTasks(db) : [],
      settings.digest_portfolio ? getNetWorthHistory(365, db) : [],
      settings.digest_tasks ? getGoals(db) : [],
      settings.digest_money ? getTransactionsForMonth(month, db) : [],
      settings.digest_money
        ? getTransactionsForMonth(shiftMonth(month, -1), db)
        : [],
      settings.digest_money
        ? getTransactionsForMonth(shiftMonth(month, -2), db)
        : [],
    ])

  const priorMonthExpenseCents = [prior1, prior2]
    .map((rows) => summariseMonth(rows).expenseCents)
    .filter((cents) => cents > 0)

  const signals = computeSignals({
    today,
    recurring: recurring.map((r) => ({
      name: r.name,
      direction: r.direction,
      amount_cents: r.amount_cents,
      next_due: r.next_due,
    })),
    tasks: tasks.map((t) => ({ title: t.title, due_on: t.due_on, done: t.done })),
    netWorth: netWorth.map((p) => ({
      asOf: p.asOf,
      totalCents: p.totalCents,
      investmentsCents: p.investmentsCents,
    })),
    monthExpenseCents: summariseMonth(thisMonth).expenseCents,
    priorMonthExpenseCents,
    dayOfMonth: Number(today.slice(8, 10)),
    daysInMonth: daysInMonth(month),
    goals: goals.map((g) => ({
      title: g.title,
      status: g.status,
      target_date: g.target_date,
    })),
  })
  report.signals = signals.length

  if (settings.digest_mode === 'noteworthy' && signals.length === 0) {
    report.skipped = 'nothing_noteworthy'
    return report
  }

  const { text, composedBy } = await composeDigest(
    {
      today,
      signals,
      events,
      emails,
      facts: facts.map((f) => f.content),
    },
    db
  )
  report.composedBy = composedBy

  for (const chunk of chunkTelegramMessage(text)) {
    await sendMessage(chatId, chunk)
    report.chunksSent += 1
  }

  try {
    await saveAssistantNote(db, text)
    report.historySaved = true
  } catch (error) {
    // Context loss for follow-ups, not a failed digest — log and move on.
    console.error(
      '[cron/digest] history save failed:',
      error instanceof Error ? error.message : error
    )
  }

  return report
}
