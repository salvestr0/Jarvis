import { NextResponse, type NextRequest } from 'next/server'
import { after } from 'next/server'

import { runJarvis } from '@/lib/jarvis/agent'
import { sendMessage, sendTyping } from '@/lib/telegram/api'
import { chunkTelegramMessage } from '@/lib/telegram/format'
import { parseUpdate } from '@/lib/telegram/update'

/**
 * Telegram webhook — the bot's front door.
 *
 * Three locks, all fail-closed (same philosophy as /api/cron/prices):
 *  1. Refuses to run at all if its secrets aren't configured (503).
 *  2. Telegram must present the secret token that was registered at
 *     setWebhook time (scripts/telegram-setup.mjs); anything else gets a
 *     deliberately vague 401.
 *  3. Messages from any Telegram account other than TELEGRAM_USER_ID are
 *     acknowledged and silently dropped — replying "not allowed" would
 *     confirm to a prober that the bot does something.
 *
 * Telegram redelivers updates that don't get a quick 200, so the actual work
 * (the Claude tool loop) runs in `after()` — the response goes out
 * immediately and the function stays alive up to maxDuration to finish the
 * reply via sendMessage.
 */

export const dynamic = 'force-dynamic'
// Vercel Fluid Compute keeps the function alive for after(); Opus with
// effort:low answers in seconds, but a long tool chain gets headroom.
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  const allowedId = process.env.TELEGRAM_USER_ID

  if (!secret || !allowedId) {
    console.error(
      '[telegram] TELEGRAM_WEBHOOK_SECRET / TELEGRAM_USER_ID not set — refusing to run.'
    )
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 })
  }

  if (request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const update = parseUpdate(await request.json().catch(() => null))

  // 200 for everything from here on — a 4xx would make Telegram redeliver
  // the same update forever.
  if (!update) return NextResponse.json({ ok: true })
  if (String(update.fromId) !== allowedId) return NextResponse.json({ ok: true })

  const { chatId, text } = update

  after(async () => {
    try {
      await sendTyping(chatId)
      const reply = await runJarvis(text)
      for (const chunk of chunkTelegramMessage(reply)) {
        await sendMessage(chatId, chunk)
      }
    } catch (error) {
      console.error(
        '[telegram] failed:',
        error instanceof Error ? error.message : error
      )
      try {
        await sendMessage(chatId, 'Something went wrong with that one — check the Vercel logs.')
      } catch {
        // Even the apology failed; the logs above are all that's left.
      }
    }
  })

  return NextResponse.json({ ok: true })
}
