/**
 * Parsing for incoming Telegram webhook updates.
 *
 * Deliberately dependency-free (no Telegram SDK, no server-only imports) so
 * it can be unit tested with `node --test`. Only the handful of fields the
 * bot actually uses are typed — Telegram sends far more.
 */

export type IncomingMessage = { chatId: number; fromId: number } & (
  | { kind: 'text'; text: string }
  | { kind: 'voice'; fileId: string; duration: number }
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Extract the shapes the bot responds to: a new text message, or a voice
 * note (which the route downloads and transcribes).
 *
 * Everything else — edited messages, photos, stickers, group chats,
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

  // Private chats only. The route checks WHO is speaking, but the reply goes
  // to the chat the message came from — in a group that would broadcast
  // financial data to everyone in it, even when the speaker is the owner.
  if (chat.type !== 'private') return null

  const base = { chatId: chat.id, fromId: from.id }

  if (typeof message.text === 'string') {
    const text = message.text.trim()
    if (text) return { ...base, kind: 'text', text }
    return null
  }

  // Voice notes only (message.voice), not music files or video notes.
  const voice = message.voice
  if (isRecord(voice) && typeof voice.file_id === 'string') {
    return {
      ...base,
      kind: 'voice',
      fileId: voice.file_id,
      duration: typeof voice.duration === 'number' ? voice.duration : 0,
    }
  }

  return null
}
