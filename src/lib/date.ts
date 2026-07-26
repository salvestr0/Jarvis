/**
 * Date helpers for month filtering.
 *
 * Everything here works on plain 'YYYY-MM-DD' / 'YYYY-MM' strings rather than
 * JavaScript Date objects. Why: `new Date('2026-07-01')` is parsed as UTC
 * midnight, so in Singapore (UTC+8) it can display as 30 June. Comparing
 * strings sidesteps timezone bugs entirely, and Postgres `date` columns are
 * strings on the wire anyway.
 */

/** Current month as 'YYYY-MM', in Singapore time. */
export function currentMonth(): string {
  return todayISO().slice(0, 7)
}

/** Today as 'YYYY-MM-DD', in Singapore time. */
export function todayISO(): string {
  // 'en-CA' formats as YYYY-MM-DD, which is exactly what we want.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function isValidMonth(month: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return false
  const year = Number(month.slice(0, 4))
  return year >= 2000 && year <= 2100
}

/** First day of a month: '2026-07' -> '2026-07-01' */
export function monthStart(month: string): string {
  return `${month}-01`
}

/** Day after the last day of a month — used for a `< end` range query. */
export function monthEndExclusive(month: string): string {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const nextYear = m === 12 ? year + 1 : year
  const nextMonth = m === 12 ? 1 : m + 1
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
}

export function shiftMonth(month: string, delta: number): string {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const zeroBased = year * 12 + (m - 1) + delta
  const newYear = Math.floor(zeroBased / 12)
  const newMonth = (zeroBased % 12) + 1
  return `${newYear}-${String(newMonth).padStart(2, '0')}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Month is 1-based: daysInMonth(2026, 2) -> 28 */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the NEXT month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * The next due date after one billing period: '2026-07-15' + monthly -> '2026-08-15'.
 *
 * Days that don't exist in the target month clamp to its last day
 * (31 Jan + monthly -> 28 Feb, 29 Feb + yearly -> 28 Feb). A clamped date
 * stays clamped on later advances (28 Feb -> 28 Mar, not back to the 31st) —
 * fine for this app, where the exact billing day matters less than not
 * silently skipping a month.
 */
export function advanceByCadence(
  iso: string,
  cadence: 'weekly' | 'monthly' | 'yearly'
): string {
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  const day = Number(iso.slice(8, 10))

  if (cadence === 'weekly') {
    // Date.UTC normalises overflow (32 Jan -> 1 Feb), immune to local timezone.
    const next = new Date(Date.UTC(year, month - 1, day + 7))
    return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
  }

  const nextYear =
    cadence === 'yearly' ? year + 1 : month === 12 ? year + 1 : year
  const nextMonth = cadence === 'yearly' ? month : month === 12 ? 1 : month + 1
  const nextDay = Math.min(day, daysInMonth(nextYear, nextMonth))

  return `${nextYear}-${pad(nextMonth)}-${pad(nextDay)}`
}

/** '2027-08-15' -> '15 Aug 2027' — for dates that may fall outside this year. */
export function formatDateLabel(iso: string): string {
  return `${formatDayLabel(iso)} ${iso.slice(0, 4)}`
}

/** '2026-07' -> 'July 2026' */
export function formatMonthLabel(month: string): string {
  const [year, m] = month.split('-')
  const name = new Intl.DateTimeFormat('en-SG', { month: 'long' }).format(
    new Date(Date.UTC(2000, Number(m) - 1, 1))
  )
  return `${name} ${year}`
}

/** '2026-07-15' -> '15 Jul' */
export function formatDayLabel(iso: string): string {
  const [, m, d] = iso.split('-')
  const name = new Intl.DateTimeFormat('en-SG', { month: 'short' }).format(
    new Date(Date.UTC(2000, Number(m) - 1, 1))
  )
  return `${Number(d)} ${name}`
}
