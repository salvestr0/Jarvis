/**
 * Parsing for incoming Telegram webhook updates.
 *
 * Deliberately dependency-free (no Telegram SDK, no server-only imports) so it
 * can be unit tested with `node --test`. Only the handful of fields the bot
 * actually uses are typed — Telegram sends far more.
 */

export type IncomingMessage = {
  chatId: number
  fromId: number
  text: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Extract the one shape the bot responds to: a new, non-empty text message.
 *
 * Everything else — edited messages, photos, stickers, channel posts,
 * malformed bodies — returns null so the route can acknowledge it with a 200
 * and move on. Replying 4xx would only make Telegram redeliver junk forever.
 */
export function parseUpdate(body: unknown): IncomingMessage | null {
  if (!isRecord(body)) return null

  // Only `message` — an `edited_message` re-delivers old text and answering
  // it twice would double-log expenses.
  const message = body.message
  if (!isRecord(message)) return null

  const chat = message.chat
  const from = message.from
  if (!isRecord(chat) || !isRecord(from)) return null
  if (typeof chat.id !== 'number' || typeof from.id !== 'number') return null

  if (typeof message.text !== 'string') return null
  const text = message.text.trim()
  if (!text) return null

  return { chatId: chat.id, fromId: from.id, text }
}
