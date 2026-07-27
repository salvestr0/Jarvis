/**
 * Register (or re-register) the Telegram webhook for the Jarvis bot.
 *
 *   npm run telegram:setup                    -> uses the production URL
 *   npm run telegram:setup -- https://x.dev   -> point somewhere else
 *
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from .env.local.
 * The secret is what lets /api/telegram tell real Telegram traffic from
 * anyone who guesses the URL.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const DEFAULT_APP_URL = 'https://jarvis-theta-umber-27.vercel.app'

function loadEnvLocal() {
  const file = join(root, '.env.local')
  if (!existsSync(file)) return {}
  const env = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
  return env
}

const env = loadEnvLocal()
const token = env.TELEGRAM_BOT_TOKEN
const secret = env.TELEGRAM_WEBHOOK_SECRET
const appUrl = (process.argv[2] ?? DEFAULT_APP_URL).replace(/\/+$/, '')

if (!token || !secret) {
  console.error(
    'TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must be set in .env.local first.'
  )
  process.exit(1)
}

/** Call the Bot API without ever printing the token (it's in the URL). */
async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok || payload?.ok === false) {
    throw new Error(
      `${method} failed (HTTP ${res.status}): ${payload?.description ?? 'no description'}`
    )
  }
  return payload?.result
}

const webhookUrl = `${appUrl}/api/telegram`

try {
  await call('setWebhook', {
    url: webhookUrl,
    secret_token: secret,
    // Only plain messages — no edits, no channel posts, no join events.
    allowed_updates: ['message'],
    // Anything queued while the webhook was down is stale; start fresh.
    drop_pending_updates: true,
  })
  console.log(`Webhook registered: ${webhookUrl}`)

  const info = await call('getWebhookInfo')
  console.log('\ngetWebhookInfo:')
  console.log(`  url:                  ${info.url}`)
  console.log(`  pending updates:      ${info.pending_update_count}`)
  console.log(`  last error:           ${info.last_error_message ?? 'none'}`)
  console.log(`  custom cert:          ${info.has_custom_certificate}`)
  console.log('\nDone. Message the bot on Telegram to test it.')
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
