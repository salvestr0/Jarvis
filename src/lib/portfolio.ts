/**
 * Portfolio maths — pure functions, no database, no network.
 *
 * Deliberately separate from queries/investments.ts so it can be unit tested
 * directly. This is the code that decides whether the app tells you you're up
 * or down, so it's the code most worth proving correct.
 */

export const MICROS = 1_000_000

export type HoldingKind = 'crypto' | 'stock'

export type Holding = {
  id: string
  kind: HoldingKind
  symbol: string
  name: string | null
  quantity: number
  cost_basis_cents: number
  cost_currency: string
  price_currency: string
  account_id: string | null
  note: string | null
}

export type PriceEntry = {
  priceMicros: number
  asOf: string
  currency: string
}

export type Position = Holding & {
  priceMicros: number | null
  priceAsOf: string | null
  marketValueCents: number | null
  costBasisSgdCents: number
  gainCents: number | null
  gainPct: number | null
}

export type PortfolioTotals = {
  marketValueCents: number
  costBasisCents: number
  gainCents: number
  gainPct: number | null
  unpricedCount: number
}

/**
 * Convert an amount in `currency` to SGD cents.
 *
 * Returns null rather than guessing when the rate isn't known — an unpriced
 * holding is honest; a wrong number is not.
 *
 * On precision: quantity x price is unavoidably floating point because
 * quantity is fractional (0.0035 BTC). Rounding to whole cents happens here,
 * immediately, so error stays under half a cent per holding and can never
 * accumulate across the portfolio.
 */
export function toSgdCents(
  amountNative: number,
  currency: string,
  usdSgd: number | null
): number | null {
  if (currency === 'SGD') return Math.round(amountNative * 100)
  if (currency === 'USD') {
    if (usdSgd === null) return null
    return Math.round(amountNative * usdSgd * 100)
  }
  return null
}

export function buildPositions(
  holdings: Holding[],
  prices: Map<string, PriceEntry>,
  usdSgd: number | null
): Position[] {
  return holdings.map((h) => {
    const price = prices.get(`${h.kind}:${h.symbol}`) ?? null

    const costBasisSgdCents =
      h.cost_currency === 'SGD'
        ? h.cost_basis_cents
        : (toSgdCents(h.cost_basis_cents / 100, h.cost_currency, usdSgd) ??
          h.cost_basis_cents)

    let marketValueCents: number | null = null
    if (price) {
      const valueNative = h.quantity * (price.priceMicros / MICROS)
      marketValueCents = toSgdCents(valueNative, price.currency, usdSgd)
    }

    const gainCents =
      marketValueCents === null ? null : marketValueCents - costBasisSgdCents

    const gainPct =
      gainCents === null || costBasisSgdCents === 0
        ? null
        : (gainCents / costBasisSgdCents) * 100

    return {
      ...h,
      priceMicros: price?.priceMicros ?? null,
      priceAsOf: price?.asOf ?? null,
      marketValueCents,
      costBasisSgdCents,
      gainCents,
      gainPct,
    }
  })
}

export function portfolioTotals(positions: Position[]): PortfolioTotals {
  let marketValueCents = 0
  let costBasisCents = 0
  let unpricedCount = 0

  for (const p of positions) {
    if (p.marketValueCents === null) {
      unpricedCount += 1
      continue
    }
    // Only count the cost of positions we could actually price, so the gain
    // figure compares like with like. Including the cost of an unpriced
    // holding would show a fake loss equal to what you paid for it.
    marketValueCents += p.marketValueCents
    costBasisCents += p.costBasisSgdCents
  }

  const gainCents = marketValueCents - costBasisCents

  return {
    marketValueCents,
    costBasisCents,
    gainCents,
    gainPct: costBasisCents === 0 ? null : (gainCents / costBasisCents) * 100,
    unpricedCount,
  }
}
