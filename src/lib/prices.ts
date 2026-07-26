import 'server-only'

/**
 * Fetches market prices from free public APIs.
 *
 * Design rules here:
 *  - One asset failing must never break the others. Each symbol reports its
 *    own success or failure, so a delisted ticker doesn't wipe your whole
 *    net worth screen.
 *  - Every request has a timeout. Without one, a hanging API would hold the
 *    page open until the server gave up, which looks like the app is broken.
 *  - Prices are returned in MICROS (price x 1,000,000) as integers, so a
 *    sub-cent memecoin doesn't round away to zero.
 */

export const MICROS = 1_000_000

export type PriceResult = {
  symbol: string
  kind: 'crypto' | 'stock'
  priceMicros: number
  currency: string
  source: string
}

export type PriceFailure = { symbol: string; reason: string }

export type PriceFetch = {
  prices: PriceResult[]
  failures: PriceFailure[]
}

const TIMEOUT_MS = 12_000

async function getJson(url: string, label: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      // Always hit the network — a cached price is a wrong price.
      cache: 'no-store',
    })

    if (!res.ok) {
      throw new Error(`${label} returned HTTP ${res.status}`)
    }
    return await res.json()
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${label} timed out after ${TIMEOUT_MS / 1000}s`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** Convert a decimal price to integer micros without floating-point drift. */
export function toMicros(value: number): number {
  return Math.round(value * MICROS)
}

// ---------------------------------------------------------------------------
// Crypto — CoinGecko (no API key needed)
// ---------------------------------------------------------------------------

/**
 * CoinGecko identifies coins by id ("bitcoin"), not ticker ("BTC").
 * These are the ones worth hardcoding — it saves a lookup request each time,
 * and avoids the risk of a scam token with a copycat ticker ranking first in
 * search results.
 */
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  AVAX: 'avalanche-2',
  DOT: 'polkadot',
  MATIC: 'matic-network',
  LINK: 'chainlink',
  USDT: 'tether',
  USDC: 'usd-coin',
  TRX: 'tron',
  TON: 'the-open-network',
  SUI: 'sui',
  APT: 'aptos',
  ARB: 'arbitrum',
  OP: 'optimism',
  PEPE: 'pepe',
  SHIB: 'shiba-inu',
  WIF: 'dogwifcoin',
  BONK: 'bonk',
}

// Resolutions are cached for the life of the server process so repeated
// refreshes don't re-query for the same ticker.
const resolvedIds = new Map<string, string>()

async function resolveCoinGeckoId(symbol: string): Promise<string> {
  const upper = symbol.toUpperCase()

  if (COINGECKO_IDS[upper]) return COINGECKO_IDS[upper]
  const cached = resolvedIds.get(upper)
  if (cached) return cached

  const data = (await getJson(
    `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(upper)}`,
    'CoinGecko search'
  )) as { coins?: Array<{ id: string; symbol: string; market_cap_rank: number | null }> }

  const matches = (data.coins ?? []).filter(
    (c) => c.symbol.toUpperCase() === upper
  )

  if (matches.length === 0) {
    throw new Error(`No CoinGecko coin found for "${symbol}"`)
  }

  // Prefer the highest market cap (lowest rank number). Ticker collisions are
  // common and the real asset is essentially always the larger one.
  matches.sort(
    (a, b) => (a.market_cap_rank ?? 1e9) - (b.market_cap_rank ?? 1e9)
  )

  const id = matches[0].id
  resolvedIds.set(upper, id)
  return id
}

export async function fetchCryptoPrices(symbols: string[]): Promise<PriceFetch> {
  const prices: PriceResult[] = []
  const failures: PriceFailure[] = []

  if (symbols.length === 0) return { prices, failures }

  // Resolve tickers to ids first; a failure here is per-symbol, not fatal.
  const idBySymbol = new Map<string, string>()
  for (const symbol of symbols) {
    try {
      idBySymbol.set(symbol, await resolveCoinGeckoId(symbol))
    } catch (error) {
      failures.push({
        symbol,
        reason: error instanceof Error ? error.message : 'Lookup failed',
      })
    }
  }

  if (idBySymbol.size === 0) return { prices, failures }

  try {
    // One request for every coin, rather than one per coin — kinder to the
    // free rate limit and much faster.
    const ids = [...new Set(idBySymbol.values())].join(',')
    const data = (await getJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd`,
      'CoinGecko'
    )) as Record<string, { usd?: number }>

    for (const [symbol, id] of idBySymbol) {
      const usd = data[id]?.usd
      if (typeof usd !== 'number' || !Number.isFinite(usd)) {
        failures.push({ symbol, reason: 'No USD price returned' })
        continue
      }
      prices.push({
        symbol,
        kind: 'crypto',
        priceMicros: toMicros(usd),
        currency: 'USD',
        source: 'coingecko',
      })
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Request failed'
    for (const symbol of idBySymbol.keys()) failures.push({ symbol, reason })
  }

  return { prices, failures }
}

// ---------------------------------------------------------------------------
// Stocks — Finnhub (free API key required)
// ---------------------------------------------------------------------------

export function hasFinnhubKey(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY)
}

export async function fetchStockPrices(symbols: string[]): Promise<PriceFetch> {
  const prices: PriceResult[] = []
  const failures: PriceFailure[] = []

  if (symbols.length === 0) return { prices, failures }

  const key = process.env.FINNHUB_API_KEY
  if (!key) {
    return {
      prices,
      failures: symbols.map((symbol) => ({
        symbol,
        reason: 'FINNHUB_API_KEY is not set — add it to .env.local',
      })),
    }
  }

  // Finnhub quotes one symbol per request, so these run in parallel and each
  // settles independently.
  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const data = (await getJson(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`,
        'Finnhub'
      )) as { c?: number }

      // Finnhub answers 200 with c:0 for an unknown ticker rather than an
      // error, so a zero price means "not found", not "worthless".
      if (typeof data.c !== 'number' || data.c <= 0) {
        throw new Error(`Unknown ticker "${symbol}" (no price returned)`)
      }

      return {
        symbol,
        kind: 'stock' as const,
        priceMicros: toMicros(data.c),
        currency: 'USD',
        source: 'finnhub',
      }
    })
  )

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') prices.push(result.value)
    else
      failures.push({
        symbol: symbols[i],
        reason:
          result.reason instanceof Error
            ? result.reason.message
            : 'Request failed',
      })
  })

  return { prices, failures }
}

// ---------------------------------------------------------------------------
// FX — Frankfurter (European Central Bank data, no API key)
// ---------------------------------------------------------------------------

export type FxResult = {
  base: string
  quote: string
  rateMicros: number
  asOf: string
  source: string
}

export async function fetchUsdToSgd(): Promise<FxResult> {
  const data = (await getJson(
    'https://api.frankfurter.dev/v1/latest?base=USD&symbols=SGD',
    'Frankfurter'
  )) as { date?: string; rates?: { SGD?: number } }

  const rate = data.rates?.SGD

  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error('No USD/SGD rate returned')
  }

  return {
    base: 'USD',
    quote: 'SGD',
    rateMicros: toMicros(rate),
    // Note this is the ECB's date, not today's. Rates are published on
    // weekdays only, so on a Sunday this is Friday's rate — which is correct,
    // because no trading happened in between.
    asOf: data.date ?? new Date().toISOString().slice(0, 10),
    source: 'frankfurter',
  }
}
