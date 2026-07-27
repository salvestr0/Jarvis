import 'server-only'

/**
 * Thin client for the Telegram Bot API — the two calls the bot makes.
 *
 * Same rules as src/lib/prices.ts: native fetch, a timeout on every request,
 * and `cache: 'no-store'`. No Telegram SDK; two endpoints don't justify a
 * dependency.
 *
 * Error messages must never include the URL — it contains the bot token.
 */

const TIMEOUT_MS = 12_000

function botUrl(method: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set.')
  return `https://api.telegram.org/bot${token}/${method}`
}

async function callTelegram(method: string, body: unknown): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(botUrl(method), {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    // Telegram reports failures both ways: HTTP status and an `ok` field.
    const payload = (await res.json().catch(() => null)) as {
      ok?: boolean
      description?: string
    } | null

    if (!res.ok || payload?.ok === false) {
      throw new Error(
        `Telegram ${method} failed (HTTP ${res.status}): ${payload?.description ?? 'no description'}`
      )
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Telegram ${method} timed out after ${TIMEOUT_MS / 1000}s`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** Send one plain-text message (no parse_mode — see telegram/format.ts). */
export async function sendMessage(chatId: number, text: string): Promise<void> {
  await callTelegram('sendMessage', { chat_id: chatId, text })
}

/**
 * Show "typing…" while Claude works. Best-effort: a failure here must never
 * take down the actual reply.
 */
export async function sendTyping(chatId: number): Promise<void> {
  try {
    await callTelegram('sendChatAction', { chat_id: chatId, action: 'typing' })
  } catch {
    // Cosmetic only.
  }
}
