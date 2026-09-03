import { NextResponse, type NextRequest } from 'next/server'
import { after } from 'next/server'
import { randomUUID } from 'node:crypto'

import { runJarvis } from '@/lib/jarvis/agent'
import { getBotDb } from '@/lib/jarvis/db'
import { loadHistory, saveTurn } from '@/lib/jarvis/history'
import { runHermesAgent } from '@/lib/jarvis/hermes-client'
import { prepareTelegramDelivery } from '@/lib/jarvis/telegram-delivery'
import { claimTelegramUpdate, finishTelegramUpdate } from '@/lib/jarvis/update-lease'
import { downloadFile, sendMessage, sendTyping } from '@/lib/telegram/api'
import { chunkTelegramMessage } from '@/lib/telegram/format'
import { parseUpdate } from '@/lib/telegram/update'
import { MAX_VOICE_SECONDS, transcribeVoice } from '@/lib/transcribe'

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

  const { chatId } = update
  const receivedAt = Date.now()

  let delivery: {
    db: Awaited<ReturnType<typeof getBotDb>>
    leaseToken: string
  } | null
  try {
    delivery = await prepareTelegramDelivery<Awaited<ReturnType<typeof getBotDb>>>(
      update.updateId,
      {
        createLeaseToken: randomUUID,
        getDb: getBotDb,
        claim: claimTelegramUpdate,
      }
    )
  } catch (error) {
    console.error(
      '[telegram] could not claim update:',
      error instanceof Error ? error.message : 'unknown'
    )
    // Do not acknowledge an unclaimed update. Telegram can safely redeliver it.
    return NextResponse.json({ error: 'Temporary failure.' }, { status: 503 })
  }
  if (!delivery) return NextResponse.json({ ok: true })

  const { db, leaseToken } = delivery

  after(async () => {
    let succeeded = false
    let failure = 'unknown'

    try {
      await sendTyping(chatId)

      let text: string
      if (update.kind === 'voice') {
        if (update.duration > MAX_VOICE_SECONDS) {
          await sendMessage(
            chatId,
            `That note is ${update.duration}s — a bit long for me. Send something under ${MAX_VOICE_SECONDS / 60} minutes.`
          )
          succeeded = true
          return
        }
        text = await transcribeVoice(await downloadFile(update.fileId))
        // Echo what was heard: a mis-transcribed amount should be visible
        // before Jarvis acts on it, not after.
        await sendMessage(chatId, `🎤 "${text}"`)
        await sendTyping(chatId)
      } else {
        text = update.text
      }

      const backend = process.env.JARVIS_AGENT_BACKEND ?? 'legacy'
      let reply: string
      if (backend === 'hermes') {
        const serviceUrl = process.env.AGENT_SERVICE_URL
        const agentSecret = process.env.AGENT_SERVICE_SECRET
        if (!serviceUrl || !agentSecret) {
          throw new Error('Hermes agent backend is not configured.')
        }
        const history = await loadHistory(db)
        reply = await runHermesAgent(
          { text, telegramUpdateId: update.updateId, history },
          { serviceUrl, secret: agentSecret }
        )
      } else if (backend === 'legacy') {
        reply = await runJarvis(text)
      } else {
        throw new Error('Unknown Jarvis agent backend.')
      }
      for (const chunk of chunkTelegramMessage(reply)) {
        await sendMessage(chatId, chunk)
      }
      if (backend === 'hermes') {
        try {
          await saveTurn(db, text, reply, receivedAt)
        } catch (historyError) {
          console.error(
            '[telegram] could not save Hermes history:',
            historyError instanceof Error ? historyError.message : 'unknown'
          )
        }
      }
      succeeded = true
    } catch (error) {
      failure = error instanceof Error ? error.message : 'unknown'
      console.error(
        '[telegram] failed:',
        failure
      )
      try {
        await sendMessage(chatId, "I couldn't finish that. Please try again in a moment.")
      } catch {
        // Even the apology failed; the logs above are all that's left.
      }
    } finally {
      try {
        const finished = await finishTelegramUpdate(db, update.updateId, leaseToken, {
          succeeded,
          error: succeeded ? undefined : failure,
        })
        if (!finished) console.error('[telegram] lost the update lease before finishing.')
      } catch (finishError) {
        console.error(
          '[telegram] could not finish update lease:',
          finishError instanceof Error ? finishError.message : 'unknown'
        )
      }
    }
  })

  return NextResponse.json({ ok: true })
}
