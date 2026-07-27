import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { todayISO } from '@/lib/date'
import type { Db } from '@/lib/queries/db'
import {
  fetchCryptoPrices,
  fetchStockPrices,
  fetchUsdToSgd,
  type PriceFailure,
} from '@/lib/prices'
import {
  MICROS,
  buildPositions,
  portfolioTotals,
  type Holding,
  type HoldingKind,
  type PriceEntry,
} from '@/lib/portfolio'

// The pure maths lives in @/lib/portfolio so it can be unit tested without a
// database. Re-exported here so pages have a single import for investments.
export {
  buildPositions,
  portfolioTotals,
  type Holding,
  type HoldingKind,
  type Position,
  type PortfolioTotals,
} from '@/lib/portfolio'

// --- reads -----------------------------------------------------------------

export async function getHoldings(db?: Db): Promise<Holding[]> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase
    .from('holdings')
    .select(
      'id, kind, symbol, name, quantity, cost_basis_cents, cost_currency, price_currency, account_id, note, manual_value_cents'
    )
  // Admin client bypasses RLS, so ownership moves into the query itself.
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query.order('kind').order('symbol')

  if (error) throw new Error(`Could not load holdings: ${error.message}`)

  // Postgres `numeric` arrives as a string to preserve precision that a JS
  // number can't always hold. Convert once, here, rather than everywhere.
  return (data ?? []).map((h) => ({
    ...h,
    quantity: Number(h.quantity),
  })) as Holding[]
}

/** Most recent price for each symbol we hold. */
export async function getLatestPrices(db?: Db): Promise<Map<string, PriceEntry>> {
  // Prices are global rows, not per-user — the client swaps but no user filter.
  const supabase = db?.client ?? (await createClient())
  const { data, error } = await supabase
    .from('price_snapshots')
    .select('kind, symbol, price_micros, currency, as_of')
    .order('as_of', { ascending: false })

  if (error) throw new Error(`Could not load prices: ${error.message}`)

  const latest = new Map<string, PriceEntry>()

  // Rows arrive newest-first, so the first one seen per symbol is the newest.
  for (const row of data ?? []) {
    const key = `${row.kind}:${row.symbol}`
    if (latest.has(key)) continue
    latest.set(key, {
      priceMicros: Number(row.price_micros),
      asOf: row.as_of,
      currency: row.currency,
    })
  }

  return latest
}

/** Most recent USD->SGD rate, or null if none has been fetched yet. */
export async function getLatestUsdSgd(db?: Db): Promise<
  { rate: number; asOf: string } | null
> {
  // FX rates are global rows, not per-user — no user filter needed.
  const supabase = db?.client ?? (await createClient())
  const { data, error } = await supabase
    .from('fx_rates')
    .select('rate_micros, as_of')
    .eq('base', 'USD')
    .eq('quote', 'SGD')
    .order('as_of', { ascending: false })
    .limit(1)

  if (error) throw new Error(`Could not load FX rate: ${error.message}`)
  if (!data || data.length === 0) return null

  return { rate: Number(data[0].rate_micros) / MICROS, asOf: data[0].as_of }
}

/**
 * Cash on hand: every account's opening balance, plus all income, minus all
 * expenses. Not limited to one month — this is a running balance.
 */
export async function getCashBalanceCents(db?: Db): Promise<number> {
  const supabase = db?.client ?? (await createClient())

  let accountsQuery = supabase.from('accounts').select('opening_balance_cents')
  let txQuery = supabase.from('transactions').select('direction, amount_cents')
  // Admin client bypasses RLS, so ownership moves into the queries themselves.
  if (db) {
    accountsQuery = accountsQuery.eq('user_id', db.userId)
    txQuery = txQuery.eq('user_id', db.userId)
  }

  const [accountsRes, txRes] = await Promise.all([accountsQuery, txQuery])

  if (accountsRes.error)
    throw new Error(`Could not load accounts: ${accountsRes.error.message}`)
  if (txRes.error)
    throw new Error(`Could not load transactions: ${txRes.error.message}`)

  let total = 0
  for (const a of accountsRes.data ?? []) total += Number(a.opening_balance_cents)
  for (const t of txRes.data ?? []) {
    total += t.direction === 'income' ? t.amount_cents : -t.amount_cents
  }

  return total
}

// --- writes ----------------------------------------------------------------

export type HoldingInput = {
  kind: HoldingKind
  symbol: string
  name: string | null
  quantity: number
  cost_basis_cents: number
  cost_currency: string
  price_currency: string
  note: string | null
  manual_value_cents: number | null
}

export async function createHolding(
  input: HoldingInput,
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

  const { error } = await supabase
    .from('holdings')
    .insert({ ...input, user_id: userId })

  if (error) {
    if (error.code === '23505') {
      throw new Error(
        `You already have a ${input.kind} holding for ${input.symbol}. Edit that one instead.`
      )
    }
    throw new Error(`Could not save: ${error.message}`)
  }
}

export async function updateHolding(
  id: string,
  input: HoldingInput,
  db?: Db
): Promise<void> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase.from('holdings').update(input).eq('id', id)
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query.select('id')
  if (error) throw new Error(`Could not update: ${error.message}`)
  if (!data || data.length === 0) throw new Error('No holding found with that id.')
}

export async function deleteHolding(id: string, db?: Db): Promise<void> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase.from('holdings').delete().eq('id', id)
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query.select('id')
  if (error) throw new Error(`Could not delete: ${error.message}`)
  if (!data || data.length === 0) throw new Error('No holding found with that id.')
}

// --- refresh ---------------------------------------------------------------

export type RefreshReport = {
  updated: number
  failures: PriceFailure[]
  fxAsOf: string | null
  fxError: string | null
}

/**
 * Fetches current prices for everything held and stores a snapshot per symbol
 * for today, plus today's FX rate and a net worth snapshot.
 *
 * Partial success is normal and fine: if Finnhub is down but CoinGecko is up,
 * crypto still updates and the stock failures are reported rather than thrown.
 */
export async function refreshPrices(): Promise<RefreshReport> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in.')

  const holdings = await getHoldings()
  const today = todayISO()

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

  await snapshotNetWorth(user.id)

  return { updated: allPrices.length, failures, fxAsOf, fxError }
}

/** Records today's net worth so the dashboard can chart it over time. */
export async function snapshotNetWorth(userId: string): Promise<void> {
  const supabase = await createClient()

  const [holdings, prices, fx, cashCents] = await Promise.all([
    getHoldings(),
    getLatestPrices(),
    getLatestUsdSgd(),
    getCashBalanceCents(),
  ])

  const totals = portfolioTotals(
    buildPositions(holdings, prices, fx?.rate ?? null)
  )

  const { error } = await supabase.from('net_worth_snapshots').upsert(
    {
      user_id: userId,
      as_of: todayISO(),
      total_cents: totals.marketValueCents + cashCents,
      investments_cents: totals.marketValueCents,
      cash_cents: cashCents,
    },
    { onConflict: 'user_id,as_of' }
  )

  if (error) throw new Error(`Could not save net worth: ${error.message}`)
}
