import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { todayISO } from '@/lib/date'
import {
  fetchCryptoPrices,
  fetchStockPrices,
  fetchUsdToSgd,
  type PriceFailure,
} from '@/lib/prices'
import { MICROS, buildPositions, portfolioTotals } from '@/lib/portfolio'
import type { Holding, PriceEntry } from '@/lib/portfolio'

/**
 * The scheduled daily refresh.
 *
 * Deliberately separate from the user-triggered refresh in
 * queries/investments.ts: this one runs with no session, so it uses the
 * service-role client and must scope everything by user_id in code, because
 * Row Level Security is not doing it for us here.
 */

export type CronReport = {
  holdings: number
  pricesWritten: number
  usersSnapshotted: number
  failures: PriceFailure[]
  fxAsOf: string | null
  fxError: string | null
}

export async function refreshAllPrices(): Promise<CronReport> {
  const supabase = createAdminClient()
  const today = todayISO()

  const { data: holdingRows, error: holdingsError } = await supabase
    .from('holdings')
    .select(
      'id, user_id, kind, symbol, name, quantity, cost_basis_cents, cost_currency, price_currency, account_id, note'
    )

  if (holdingsError) {
    throw new Error(`Could not load holdings: ${holdingsError.message}`)
  }

  const holdings = (holdingRows ?? []).map((h) => ({
    ...h,
    quantity: Number(h.quantity),
  })) as Array<Holding & { user_id: string }>

  const cryptoSymbols = [
    ...new Set(holdings.filter((h) => h.kind === 'crypto').map((h) => h.symbol)),
  ]
  const stockSymbols = [
    ...new Set(holdings.filter((h) => h.kind === 'stock').map((h) => h.symbol)),
  ]

  const [crypto, stocks, fx] = await Promise.all([
    fetchCryptoPrices(cryptoSymbols),
    fetchStockPrices(stockSymbols),
    fetchUsdToSgd().catch((error: unknown) => ({
      error: error instanceof Error ? error.message : 'FX fetch failed',
    })),
  ])

  const failures = [...crypto.failures, ...stocks.failures]
  const allPrices = [...crypto.prices, ...stocks.prices]

  if (allPrices.length > 0) {
    const { error } = await supabase.from('price_snapshots').upsert(
      allPrices.map((p) => ({
        kind: p.kind,
        symbol: p.symbol,
        price_micros: p.priceMicros,
        currency: p.currency,
        as_of: today,
        source: p.source,
      })),
      { onConflict: 'kind,symbol,as_of' }
    )
    if (error) throw new Error(`Could not save prices: ${error.message}`)
  }

  let fxAsOf: string | null = null
  let fxError: string | null = null

  if ('error' in fx) {
    fxError = fx.error
  } else {
    fxAsOf = fx.asOf
    const { error } = await supabase.from('fx_rates').upsert(
      {
        base: fx.base,
        quote: fx.quote,
        rate_micros: fx.rateMicros,
        as_of: fx.asOf,
        source: fx.source,
      },
      { onConflict: 'base,quote,as_of' }
    )
    if (error) fxError = `Could not save FX rate: ${error.message}`
  }

  const usersSnapshotted = await snapshotEveryUser(today)

  return {
    holdings: holdings.length,
    pricesWritten: allPrices.length,
    usersSnapshotted,
    failures,
    fxAsOf,
    fxError,
  }
}

/**
 * Writes today's net worth for every user.
 *
 * Note every query below filters by user_id explicitly. With the service-role
 * key there is no RLS safety net, so forgetting a filter here would mix one
 * user's money into another's totals. There is one user today; the code is
 * written so that staying true isn't load-bearing.
 */
async function snapshotEveryUser(today: string): Promise<number> {
  const supabase = createAdminClient()

  // Latest price per symbol, newest first.
  const { data: priceRows } = await supabase
    .from('price_snapshots')
    .select('kind, symbol, price_micros, currency, as_of')
    .order('as_of', { ascending: false })

  const prices = new Map<string, PriceEntry>()
  for (const row of priceRows ?? []) {
    const key = `${row.kind}:${row.symbol}`
    if (prices.has(key)) continue
    prices.set(key, {
      priceMicros: Number(row.price_micros),
      asOf: row.as_of as string,
      currency: row.currency as string,
    })
  }

  const { data: fxRows } = await supabase
    .from('fx_rates')
    .select('rate_micros')
    .eq('base', 'USD')
    .eq('quote', 'SGD')
    .order('as_of', { ascending: false })
    .limit(1)

  const usdSgd =
    fxRows && fxRows.length > 0 ? Number(fxRows[0].rate_micros) / MICROS : null

  const [{ data: allHoldings }, { data: allAccounts }, { data: allTx }] =
    await Promise.all([
      supabase
        .from('holdings')
        .select(
          'id, user_id, kind, symbol, name, quantity, cost_basis_cents, cost_currency, price_currency, account_id, note, manual_value_cents'
        ),
      supabase.from('accounts').select('user_id, opening_balance_cents'),
      supabase.from('transactions').select('user_id, direction, amount_cents'),
    ])

  const userIds = new Set<string>()
  for (const h of allHoldings ?? []) userIds.add(h.user_id as string)
  for (const a of allAccounts ?? []) userIds.add(a.user_id as string)
  for (const t of allTx ?? []) userIds.add(t.user_id as string)

  const rows = [...userIds].map((userId) => {
    const mine = (allHoldings ?? [])
      .filter((h) => h.user_id === userId)
      .map((h) => ({ ...h, quantity: Number(h.quantity) })) as Holding[]

    const totals = portfolioTotals(buildPositions(mine, prices, usdSgd))

    let cashCents = 0
    for (const a of allAccounts ?? []) {
      if (a.user_id === userId) cashCents += Number(a.opening_balance_cents)
    }
    for (const t of allTx ?? []) {
      if (t.user_id !== userId) continue
      cashCents +=
        t.direction === 'income' ? Number(t.amount_cents) : -Number(t.amount_cents)
    }

    return {
      user_id: userId,
      as_of: today,
      total_cents: totals.marketValueCents + cashCents,
      investments_cents: totals.marketValueCents,
      cash_cents: cashCents,
    }
  })

  if (rows.length === 0) return 0

  const { error } = await supabase
    .from('net_worth_snapshots')
    .upsert(rows, { onConflict: 'user_id,as_of' })

  if (error) throw new Error(`Could not save net worth: ${error.message}`)

  return rows.length
}
