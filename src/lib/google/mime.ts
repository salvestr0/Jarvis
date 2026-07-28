/**
 * Gmail MIME: extracting readable text from payloads, and building the raw
 * RFC 2822 message a draft is created from.
 *
 * Deliberately dependency-free (no server-only import) so `node --test` can
 * exercise it — the walking and encoding logic is where the edge cases live.
 */

export type MimePart = {
  mimeType?: string
  body?: { data?: string }
  parts?: MimePart[]
}

/** Gmail encodes bodies as base64url (RFC 4648 §5): -_ instead of +/. */
export function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
    'utf8'
  )
}

function findPart(part: MimePart, mimeType: string): MimePart | null {
  if (part.mimeType === mimeType && part.body?.data) return part
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType)
    if (found) return found
  }
  return null
}

/** Crude but sufficient: an email body only needs to be readable, not pretty. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

function encodeBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** RFC 2047 encoded-word — makes any subject (emoji, unicode) header-safe. */
function encodeHeaderWord(text: string): string {
  return /^[\x20-\x7e]*$/.test(text)
    ? text
    : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`
}

/**
 * A complete plain-text email as Gmail's base64url `raw` field.
 *
 * The body is base64-encoded rather than sent verbatim so unicode and long
 * lines never violate RFC 2822 line limits. Header injection via `to` or
 * `subject` is cut off by rejecting CR/LF outright — a newline smuggled into
 * either would otherwise become an attacker-controlled header.
 */
export function buildRawMessage(to: string, subject: string, body: string): string {
  if (/[\r\n]/.test(to) || /[\r\n]/.test(subject)) {
    throw new Error('to and subject must be single-line.')
  }
  const message = [
    `To: ${to}`,
    `Subject: ${encodeHeaderWord(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body, 'utf8').toString('base64'),
  ].join('\r\n')
  return encodeBase64Url(Buffer.from(message, 'utf8'))
}

/**
 * Best readable body from a Gmail `payload`: prefer text/plain anywhere in
 * the part tree, fall back to tag-stripped text/html, else empty string.
 */
export function extractPlainText(payload: MimePart | undefined): string {
  if (!payload) return ''

  const plain = findPart(payload, 'text/plain')
  if (plain?.body?.data) return decodeBase64Url(plain.body.data).trim()

  const html = findPart(payload, 'text/html')
  if (html?.body?.data) return stripHtml(decodeBase64Url(html.body.data))

  return ''
}
