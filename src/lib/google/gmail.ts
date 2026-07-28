import 'server-only'

import { googleGet, googlePost } from './auth'
import { buildRawMessage, extractPlainText, type MimePart } from './mime'

/**
 * Gmail: search, read, and create drafts. Nothing here can SEND or delete —
 * a draft sits in the Drafts folder until Jayden reviews and sends it himself.
 */

export type EmailSummary = {
  id: string
  from: string
  subject: string
  date: string
  snippet: string
}

export type EmailBody = {
  from: string
  subject: string
  date: string
  body: string
}

type RawMessageMeta = {
  id?: string
  snippet?: string
  payload?: MimePart & { headers?: Array<{ name?: string; value?: string }> }
}

function header(msg: RawMessageMeta, name: string): string {
  const found = (msg.payload?.headers ?? []).find(
    (h) => h.name?.toLowerCase() === name.toLowerCase()
  )
  return found?.value ?? ''
}

/**
 * Search with Gmail query syntax (from:, subject:, newer_than:2d, is:unread…)
 * and return lightweight summaries — metadata + snippet, never full bodies.
 */
export async function searchMessages(q: string, max = 5): Promise<EmailSummary[]> {
  const list = (await googleGet(
    `https://www.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({
      q,
      maxResults: String(max),
    })}`,
    'Gmail search'
  )) as { messages?: Array<{ id?: string }> }

  const ids = (list.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id))

  return Promise.all(
    ids.map(async (id) => {
      const msg = (await googleGet(
        `https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        'Gmail message'
      )) as RawMessageMeta

      return {
        id,
        from: header(msg, 'From'),
        subject: header(msg, 'Subject'),
        date: header(msg, 'Date'),
        snippet: msg.snippet ?? '',
      }
    })
  )
}

/** Create a draft (never sends). Returns the draft id for reference. */
export async function createDraft(opts: {
  to: string
  subject: string
  body: string
}): Promise<{ id: string | null }> {
  const payload = (await googlePost(
    'https://www.googleapis.com/gmail/v1/users/me/drafts',
    { message: { raw: buildRawMessage(opts.to, opts.subject, opts.body) } },
    'Gmail draft create'
  )) as { id?: string }

  return { id: payload.id ?? null }
}

/** Full readable body of one message (id from searchMessages). */
export async function getMessage(id: string): Promise<EmailBody> {
  const msg = (await googleGet(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
    'Gmail message'
  )) as RawMessageMeta

  return {
    from: header(msg, 'From'),
    subject: header(msg, 'Subject'),
    date: header(msg, 'Date'),
    body: extractPlainText(msg.payload),
  }
}
