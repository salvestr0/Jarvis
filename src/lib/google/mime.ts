/**
 * Extracting readable text from Gmail's MIME payloads.
 *
 * Deliberately dependency-free (no server-only import) so `node --test` can
 * exercise it — the walking logic is where the edge cases live.
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
