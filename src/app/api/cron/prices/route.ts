import { NextResponse, type NextRequest } from 'next/server'

import { refreshAllPrices } from '@/lib/cron/refresh-all'

/**
 * Daily price refresh, triggered by Vercel Cron (see vercel.json).
 *
 * Runs with no user session, so it authenticates with a shared secret instead.
 * Vercel attaches `Authorization: Bearer $CRON_SECRET` to scheduled requests
 * when CRON_SECRET is set in the project's environment variables.
 *
 * You can also trigger it by hand:
 *   curl -H "Authorization: Bearer <CRON_SECRET>" https://<your-app>/api/cron/prices
 */

// Never cached — a cached response would mean prices silently stop updating.
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET

  // Fail closed. With no secret configured, this endpoint would otherwise be
  // an unauthenticated way to make the server hammer external price APIs.
  if (!secret) {
    console.error('[cron/prices] CRON_SECRET is not set — refusing to run.')
    return NextResponse.json(
      { error: 'Cron is not configured.' },
      { status: 503 }
    )
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    // Deliberately vague: don't confirm to a prober whether the path is real.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const report = await refreshAllPrices()

    // Logged so the run is visible in Vercel's function logs even though
    // nobody is watching a screen when it fires at 9am.
    console.log('[cron/prices]', JSON.stringify(report))

    return NextResponse.json({ ok: true, ...report })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Refresh failed'
    console.error('[cron/prices] failed:', message)

    // 500 so a failed run shows up as failed in Vercel's cron history rather
    // than looking like a success that quietly did nothing.
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
