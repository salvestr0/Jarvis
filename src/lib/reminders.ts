/**
 * Pure reminder logic — timezone math, recurrence, and the late-delivery
 * label. No I/O, so all of it is under node --test.
 *
 * Singapore has no DST, so SGT is a fixed UTC+8 and plain hour arithmetic
 * is safe — none of the Intl timezone machinery is needed.
 */

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000

export type ReminderRepeat = 'none' | 'daily' | 'weekly'

/** "YYYY-MM-DD HH:MM" in Singapore time → UTC Date, or null if malformed. */
export function parseSgt(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(text.trim())
  if (!m) return null
  const [, y, mo, d, h, mi] = m.map(Number)
  if (mo < 1 || mo > 12 || h > 23 || mi > 59) return null
  const utc = new Date(Date.UTC(y, mo - 1, d, h, mi) - SGT_OFFSET_MS)
  // Date.UTC rolls impossible dates over (Feb 31 → Mar 3); reject instead.
  const check = new Date(utc.getTime() + SGT_OFFSET_MS)
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null
  return utc
}

/** UTC Date/ISO → "YYYY-MM-DD HH:MM" in Singapore time, for display. */
export function formatSgt(at: Date | string): string {
  const d = new Date(new Date(at).getTime() + SGT_OFFSET_MS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/**
 * Reject due times the tool should never accept: the past (a reminder that
 * fires immediately is a mistake, not a feature) and more than a year out
 * (almost certainly a typo'd year).
 */
export function validateDueAt(dueAt: Date, now: Date): string | null {
  if (dueAt.getTime() <= now.getTime()) return 'due_at is in the past.'
  if (dueAt.getTime() > now.getTime() + 366 * 24 * 60 * 60 * 1000)
    return 'due_at is more than a year away — double-check the date.'
  return null
}

/**
 * Next occurrence for a recurring reminder, advanced from the SCHEDULED
 * time (not delivery time, so a late tick never drifts the schedule) and
 * fast-forwarded past anything already missed — a weekend with every
 * ticker offline produces one delivery, then resumes on schedule.
 */
export function nextDueAt(dueAt: Date, repeat: ReminderRepeat, now: Date): Date | null {
  if (repeat === 'none') return null
  const stepMs = (repeat === 'daily' ? 1 : 7) * 24 * 60 * 60 * 1000
  let next = dueAt.getTime() + stepMs
  while (next <= now.getTime()) next += stepMs
  return new Date(next)
}

/**
 * The message Telegram receives. Over 5 minutes late (PC was asleep, ticker
 * lagged) it says when it was actually due — an honest late reminder beats
 * one pretending to be on time.
 */
export function reminderMessage(body: string, dueAt: Date, now: Date): string {
  const lateMs = now.getTime() - dueAt.getTime()
  const suffix = lateMs > 5 * 60 * 1000 ? ` (due ${formatSgt(dueAt)})` : ''
  return `⏰ ${body}${suffix}`
}
