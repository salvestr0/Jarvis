/**
 * Week-window math for the weekly review — pure, node --test covered.
 *
 * Weeks run Monday 00:00 SGT → Sunday, matching how Jayden thinks about a
 * work week. Same fixed-UTC+8 arithmetic as reminders.ts: Singapore has no
 * DST, so no Intl machinery is needed.
 */

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export type WeekWindow = {
  /** Monday of the current week, 'YYYY-MM-DD' (SGT) — inclusive. */
  start: string
  /** The following Monday, 'YYYY-MM-DD' — exclusive end of the week. */
  endExclusive: string
  /** Monday 00:00 SGT as a UTC ISO instant — for timestamptz comparisons. */
  startInstant: string
  /** Monday of the PREVIOUS week, 'YYYY-MM-DD' — for week-over-week money. */
  prevStart: string
  /** 'YYYY-MM' months the two windows can touch — what to fetch. */
  months: string[]
}

function isoDate(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10)
}

export function weekWindowSgt(now: Date): WeekWindow {
  // Shift to SGT, truncate to the SGT calendar day, walk back to Monday.
  const sgtMs = now.getTime() + SGT_OFFSET_MS
  const dayStartMs = Math.floor(sgtMs / DAY_MS) * DAY_MS
  const dow = new Date(dayStartMs).getUTCDay() // 0 = Sunday
  const sinceMonday = (dow + 6) % 7
  const mondayMs = dayStartMs - sinceMonday * DAY_MS
  const prevMondayMs = mondayMs - 7 * DAY_MS

  const start = isoDate(mondayMs)
  const prevStart = isoDate(prevMondayMs)
  // A Mon→Sun window plus the previous week spans at most two months.
  const months = [...new Set([prevStart.slice(0, 7), isoDate(sgtMs).slice(0, 7)])]

  return {
    start,
    endExclusive: isoDate(mondayMs + 7 * DAY_MS),
    startInstant: new Date(mondayMs - SGT_OFFSET_MS).toISOString(),
    prevStart,
    months,
  }
}

export type DayWindow = {
  /** Today, 'YYYY-MM-DD' (SGT) — inclusive. */
  start: string
  /** Tomorrow, 'YYYY-MM-DD' — exclusive end of the day. */
  endExclusive: string
  /** Today 00:00 SGT as a UTC ISO instant — for timestamptz comparisons. */
  startInstant: string
}

/** The current SGT calendar day — the evening content nudge's window. */
export function dayWindowSgt(now: Date): DayWindow {
  const sgtMs = now.getTime() + SGT_OFFSET_MS
  const dayStartMs = Math.floor(sgtMs / DAY_MS) * DAY_MS
  return {
    start: isoDate(dayStartMs),
    endExclusive: isoDate(dayStartMs + DAY_MS),
    startInstant: new Date(dayStartMs - SGT_OFFSET_MS).toISOString(),
  }
}

/** 'YYYY-MM-DD' + n days, immune to local timezone (Date.UTC arithmetic). */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return isoDate(Date.UTC(y, m - 1, d + days))
}

/** date-string in [from, toExclusive)? Plain string compare — 'YYYY-MM-DD'. */
export function inDateRange(date: string, from: string, toExclusive: string): boolean {
  return date >= from && date < toExclusive
}
