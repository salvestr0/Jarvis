import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type NetWorthPoint = {
  asOf: string
  totalCents: number
  investmentsCents: number
  cashCents: number
}

/**
 * Recorded net worth history, oldest first (chart reading order).
 *
 * Snapshots are written when prices are refreshed, so the history has gaps on
 * days the app wasn't opened. Once the daily cron is deployed (Phase 5) it
 * fills in automatically.
 */
export async function getNetWorthHistory(
  limit = 90
): Promise<NetWorthPoint[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('net_worth_snapshots')
    .select('as_of, total_cents, investments_cents, cash_cents')
    .order('as_of', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Could not load net worth history: ${error.message}`)

  return (data ?? [])
    .map((r) => ({
      asOf: r.as_of as string,
      totalCents: Number(r.total_cents),
      investmentsCents: Number(r.investments_cents),
      cashCents: Number(r.cash_cents),
    }))
    .reverse()
}
