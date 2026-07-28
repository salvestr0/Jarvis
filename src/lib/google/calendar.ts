import 'server-only'

import { googleGet, googlePost } from './auth'

/** The primary Google Calendar: list events, create events. Never deletes. */

export type CalendarEvent = {
  summary: string
  start: string
  end: string
  location: string | null
  allDay: boolean
}

type RawEvent = {
  summary?: string
  location?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
}

/**
 * Events on the primary calendar between two RFC3339 timestamps.
 *
 * Callers build timestamps with an explicit +08:00 offset from date.ts values
 * (e.g. `${todayISO()}T00:00:00+08:00`) — never new Date().toISOString(),
 * which is the UTC-midnight trap the rest of the app avoids.
 */
export async function listEvents(opts: {
  timeMin: string
  timeMax: string
  maxResults?: number
}): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    maxResults: String(opts.maxResults ?? 20),
    // Expand recurring events into instances and sort chronologically.
    singleEvents: 'true',
    orderBy: 'startTime',
  })

  const payload = (await googleGet(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    'Google Calendar'
  )) as { items?: RawEvent[] }

  return (payload.items ?? []).map((ev) => ({
    summary: ev.summary ?? '(no title)',
    // All-day events carry `date`; timed ones carry `dateTime`.
    start: ev.start?.dateTime ?? ev.start?.date ?? '',
    end: ev.end?.dateTime ?? ev.end?.date ?? '',
    location: ev.location ?? null,
    allDay: Boolean(ev.start?.date),
  }))
}

/**
 * Create one event on the primary calendar. Timed events pass RFC3339
 * start/end with the +08:00 offset already applied by the caller; all-day
 * events pass plain dates (end exclusive, per the Calendar API).
 */
export async function createEvent(opts: {
  summary: string
  start: { dateTime: string } | { date: string }
  end: { dateTime: string } | { date: string }
  location?: string
  description?: string
}): Promise<{ htmlLink: string | null }> {
  const payload = (await googlePost(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      summary: opts.summary,
      start: opts.start,
      end: opts.end,
      ...(opts.location ? { location: opts.location } : {}),
      ...(opts.description ? { description: opts.description } : {}),
    },
    'Google Calendar create'
  )) as { htmlLink?: string }

  return { htmlLink: payload.htmlLink ?? null }
}
