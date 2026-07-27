import { NextResponse, type NextRequest } from 'next/server'

import { runDailyDigest } from '@/lib/cron/digest'

/**
 * Daily digest trigger. Scheduled in vercel.json at 02:00 UTC (10:00 SGT) —
 * deliberately an hour after the price cron, because Hobby crons can fire up
 * to ~59 minutes late and the digest should see today's price snapshot.
 *
 * Same fail-closed auth as /api/cron/prices.
 */

export const dynamic = 'force-dynamic'
// Google fan-out plus one Claude compose call; generous headroom.
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET

  if (!secret) {
    console.error('[cron/digest] CRON_SECRET is not set — refusing to run.')
    return NextResponse.json({ error: 'Cron is not configured.' }, { status: 503 })
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    // Deliberately vague: don't confirm to a prober whether the path is real.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const report = await runDailyDigest()
    console.log('[cron/digest]', JSON.stringify(report))
    return NextResponse.json({ ok: true, ...report })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[cron/digest] failed:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
