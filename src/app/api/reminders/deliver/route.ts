import { NextResponse, type NextRequest } from 'next/server'

import { runContentNudge } from '@/lib/cron/nudge'
import { runWeeklyReview } from '@/lib/cron/review'
import { getBotDb } from '@/lib/jarvis/db'
import { saveAssistantNote } from '@/lib/jarvis/history'
import {
  claimDueReminders,
  rescheduleReminder,
  revertReminderClaim,
} from '@/lib/queries/reminders'
import { nextDueAt, reminderMessage } from '@/lib/reminders'
import { sendMessage } from '@/lib/telegram/api'
import { chunkTelegramMessage } from '@/lib/telegram/format'

/**
 * Reminder delivery — deliberately NOT a Vercel cron (both Hobby slots are
 * taken, and they're daily anyway). This endpoint is stateless and
 * idempotent, so anything can tick it, as often as it likes:
 *
 *   - the PC agent, every minute while the PC is awake (the precise tier)
 *   - GitHub Actions, every ~5 minutes (coverage while the PC sleeps)
 *
 * Claims are atomic (see claimDueReminders), so overlapping ticks can never
 * double-send. Same fail-closed auth as the cron routes. A tick with
 * nothing due is a no-op — the common case.
 */

export const dynamic = 'force-dynamic'
// Weekly-review and content-nudge rows include one Claude compose call —
// same headroom reasoning as the digest route.
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET

  if (!secret) {
    console.error('[reminders] CRON_SECRET is not set — refusing to run.')
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 })
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    // Deliberately vague: don't confirm to a prober whether the path is real.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const chatId = Number(process.env.TELEGRAM_USER_ID)
  if (!chatId) {
    console.error('[reminders] TELEGRAM_USER_ID is not set — nowhere to deliver.')
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 })
  }

  try {
    const db = await getBotDb()
    const due = await claimDueReminders(db)
    let sent = 0
    let failed = 0

    for (const reminder of due) {
      const now = new Date()
      const dueAt = new Date(reminder.due_at)
      try {
        let text: string
        if (reminder.kind === 'weekly_review' || reminder.kind === 'content_nudge') {
          // Composes itself; the row's body is just its list_reminders label.
          // The compose has its own model→fallback safety net, so this only
          // throws on data-layer failures — which revert the claim below.
          const composed =
            reminder.kind === 'weekly_review'
              ? await runWeeklyReview(db, now)
              : await runContentNudge(db, now)
          text = composed.text
          for (const chunk of chunkTelegramMessage(text)) {
            await sendMessage(chatId, chunk)
          }
        } else {
          text = reminderMessage(reminder.body, dueAt, now)
          await sendMessage(chatId, text)
        }
        sent += 1

        // Into chat history like the digest, so "what was that about?" and
        // "snooze that" have the reminder in context. Best-effort.
        try {
          await saveAssistantNote(db, text)
        } catch (error) {
          console.error(
            '[reminders] history save failed:',
            error instanceof Error ? error.message : error
          )
        }

        const next = nextDueAt(dueAt, reminder.repeat, now)
        if (next) await rescheduleReminder(db, reminder.id, next)
      } catch (error) {
        failed += 1
        console.error(
          `[reminders] delivery failed for ${reminder.id}:`,
          error instanceof Error ? error.message : error
        )
        // Put it back; the next tick retries. If even this fails the
        // reminder stays 'sent' undelivered — logged above, visible in
        // vercel logs.
        try {
          await revertReminderClaim(db, reminder.id)
        } catch (revertError) {
          console.error(
            `[reminders] revert failed for ${reminder.id}:`,
            revertError instanceof Error ? revertError.message : revertError
          )
        }
      }
    }

    return NextResponse.json({ ok: true, due: due.length, sent, failed })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[reminders] failed:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
