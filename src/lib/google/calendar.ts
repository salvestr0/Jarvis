import 'server-only'

import { googleGet } from './auth'

/** Read-only view of the primary Google Calendar. */

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
