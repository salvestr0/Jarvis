/**
 * Formatting helpers for outgoing Telegram messages.
 *
 * Replies are sent as plain text (no parse_mode) — Telegram's Markdown parser
 * rejects unbalanced entities with a 400, and a bot that sometimes fails to
 * answer is worse than one without bold text.
 */

/** Telegram rejects messages longer than this many characters. */
export const TELEGRAM_MESSAGE_LIMIT = 4096

/**
 * Split a reply into sendable chunks, preferring newline boundaries so a list
 * isn't cut mid-line. Never returns an empty chunk; empty input returns [].
 */
export function chunkTelegramMessage(
  text: string,
  limit = TELEGRAM_MESSAGE_LIMIT
): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const chunks: string[] = []
  let rest = trimmed

  while (rest.length > limit) {
    // Break at the last newline that still fits; hard-cut when there is none.
    let cut = rest.lastIndexOf('\n', limit)
    if (cut <= 0) cut = limit
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, '')
  }

  if (rest) chunks.push(rest)
  return chunks
}
