import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { AlertDirection } from '@/lib/alerts'
import type { Db } from '@/lib/queries/db'

/**
 * Price alerts (tasks/price-alerts-design.md): a row is a standing watch on
 * a USD level, one-shot by design. Same shared-queries contract as every
 * other domain.
 */

export type PriceAlertKind = 'stock' | 'crypto'

export type PriceAlert = {
  id: string
  symbol: string
  kind: PriceAlertKind
  direction: AlertDirection
  target_micros: number
  created_at: string
}

export async function createPriceAlert(
  input: {
    symbol: string
    kind: PriceAlertKind
    direction: AlertDirection
    target_micros: number
  },
  db?: Db
): Promise<void> {
  const supabase = db?.client ?? (await createClient())
  let userId = db?.userId
  if (!userId) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error('Not signed in.')
    userId = user.id
  }

  const { error } = await supabase.from('price_alerts').insert({
    user_id: userId,
    symbol: input.symbol,
    kind: input.kind,
    direction: input.direction,
    target_micros: input.target_micros,
  })
  if (error) throw new Error(`Could not create alert: ${error.message}`)
}

/** Pending watches, oldest first — the ids feed cancel_price_alert. */
export async function getPendingPriceAlerts(db?: Db): Promise<PriceAlert[]> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase
    .from('price_alerts')
    .select('id, symbol, kind, direction, target_micros, created_at')
    .eq('status', 'pending')
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query.order('created_at', { ascending: true })

  if (error) throw new Error(`Could not load alerts: ${error.message}`)
  return (data ?? []) as PriceAlert[]
}

/** Status flip, not a delete — the row stays as audit, same as reminders. */
export async function cancelPriceAlert(id: string, db?: Db): Promise<void> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase
    .from('price_alerts')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'pending')
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query.select('id')
  if (error) throw new Error(`Could not cancel alert: ${error.message}`)
  if (!data || data.length === 0)
    throw new Error('No pending alert found with that id.')
}

/**
 * Atomic pending → triggered flip, recording what price fired it. Both
 * tickers can check concurrently; only the one whose UPDATE matched sends
 * the message — the reminders claim pattern.
 */
export async function claimTriggeredAlert(
  db: Db,
  id: string,
  priceMicros: number
): Promise<boolean> {
  const { data, error } = await db.client
    .from('price_alerts')
    .update({
      status: 'triggered',
      triggered_price_micros: priceMicros,
      triggered_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', db.userId)
    .eq('status', 'pending')
    .select('id')
  if (error) throw new Error(`Could not claim alert: ${error.message}`)
  return (data ?? []).length > 0
}

/** Send failed after claiming: put it back so the next tick retries. */
export async function revertAlertClaim(db: Db, id: string): Promise<void> {
  const { error } = await db.client
    .from('price_alerts')
    .update({ status: 'pending', triggered_price_micros: null, triggered_at: null })
    .eq('id', id)
    .eq('user_id', db.userId)
  if (error) throw new Error(`Could not revert alert claim: ${error.message}`)
}
