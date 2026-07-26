import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MICROS,
  buildPositions,
  portfolioTotals,
  toSgdCents,
  type Holding,
  type PriceEntry,
} from './portfolio.ts'
import { parseQuantity, formatQuantity } from './quantity.ts'

function holding(over: Partial<Holding> = {}): Holding {
  return {
    id: 'h1',
    kind: 'crypto',
    symbol: 'BTC',
    name: null,
    quantity: 1,
    cost_basis_cents: 0,
    cost_currency: 'SGD',
    price_currency: 'USD',
    account_id: null,
    note: null,
    manual_value_cents: null,
    ...over,
  }
}

function priceMap(entries: Array<[string, PriceEntry]>): Map<string, PriceEntry> {
  return new Map(entries)
}

test('converts USD to SGD cents at the given rate', () => {
  // 100 USD at 1.29 -> 129.00 SGD -> 12900 cents
  assert.equal(toSgdCents(100, 'USD', 1.29), 12_900)
  assert.equal(toSgdCents(100, 'SGD', 1.29), 10_000)
})

test('refuses to guess when the FX rate is unknown', () => {
  // Showing a USD holding as if 1 USD = 1 SGD would overstate nothing but
  // understate net worth by ~29%. Better to show "not priced".
  assert.equal(toSgdCents(100, 'USD', null), null)
  assert.equal(toSgdCents(100, 'EUR', 1.29), null)
})

test('values a fractional crypto holding correctly', () => {
  // 0.0035 BTC at US$64,699, rate 1.2909 — worked through by hand:
  //   0.0035 x 64699    = 226.4465        USD
  //   226.4465 x 1.2909 = 292.31978685    SGD
  //   x 100, rounded    = 29232           cents
  const positions = buildPositions(
    [holding({ quantity: 0.0035, cost_basis_cents: 20_000 })],
    priceMap([
      ['crypto:BTC', { priceMicros: 64_699 * MICROS, asOf: '2026-07-26', currency: 'USD' }],
    ]),
    1.2909
  )

  const p = positions[0]
  assert.equal(p.marketValueCents, 29_232)
  assert.equal(p.costBasisSgdCents, 20_000)
  assert.equal(p.gainCents, 9_232)
  assert.ok(Math.abs((p.gainPct ?? 0) - 46.16) < 0.01)
})

test('handles a sub-cent memecoin without rounding it to zero', () => {
  // This is why prices are stored in micros rather than cents.
  // 10,000,000 tokens at US$0.0000004 = 4 USD -> 5.1636 SGD -> 516 cents
  const positions = buildPositions(
    [holding({ symbol: 'PEPE', quantity: 10_000_000, cost_basis_cents: 100 })],
    priceMap([
      ['crypto:PEPE', { priceMicros: 0.4, asOf: '2026-07-26', currency: 'USD' }],
    ]),
    1.2909
  )

  assert.equal(positions[0].marketValueCents, 516)
  assert.equal(positions[0].gainCents, 416)
})

test('reports a loss as a negative gain', () => {
  // Bought at S$1,000, now worth S$500.
  const positions = buildPositions(
    [holding({ price_currency: 'SGD', cost_basis_cents: 100_000, quantity: 1 })],
    priceMap([
      ['crypto:BTC', { priceMicros: 500 * MICROS, asOf: '2026-07-26', currency: 'SGD' }],
    ]),
    null
  )

  assert.equal(positions[0].marketValueCents, 50_000)
  assert.equal(positions[0].gainCents, -50_000)
  assert.equal(positions[0].gainPct, -50)
})

test('an unpriced holding is null, not zero', () => {
  // Zero would render as a 100% loss, which is a lie.
  const positions = buildPositions(
    [holding({ cost_basis_cents: 50_000 })],
    priceMap([]),
    1.29
  )

  assert.equal(positions[0].marketValueCents, null)
  assert.equal(positions[0].gainCents, null)
  assert.equal(positions[0].gainPct, null)
})

test('totals exclude unpriced holdings from both sides', () => {
  const positions = buildPositions(
    [
      holding({ id: 'a', symbol: 'BTC', quantity: 1, cost_basis_cents: 10_000, price_currency: 'SGD' }),
      holding({ id: 'b', symbol: 'XYZ', quantity: 1, cost_basis_cents: 99_999 }),
    ],
    priceMap([
      ['crypto:BTC', { priceMicros: 200 * MICROS, asOf: '2026-07-26', currency: 'SGD' }],
    ]),
    null
  )

  const totals = portfolioTotals(positions)

  assert.equal(totals.marketValueCents, 20_000)
  // XYZ's S$999.99 cost must NOT be counted — including it would invent a
  // loss equal to the entire cost of a holding we simply couldn't price.
  assert.equal(totals.costBasisCents, 10_000)
  assert.equal(totals.gainCents, 10_000)
  assert.equal(totals.unpricedCount, 1)
})

test('zero cost basis (airdrop) gives no percentage, not infinity', () => {
  const positions = buildPositions(
    [holding({ cost_basis_cents: 0, price_currency: 'SGD' })],
    priceMap([
      ['crypto:BTC', { priceMicros: 100 * MICROS, asOf: '2026-07-26', currency: 'SGD' }],
    ]),
    null
  )

  assert.equal(positions[0].gainCents, 10_000)
  assert.equal(positions[0].gainPct, null) // dividing by zero would be Infinity
  assert.equal(portfolioTotals(positions).gainPct, null)
})

test('an empty portfolio does not divide by zero', () => {
  const totals = portfolioTotals([])
  assert.equal(totals.marketValueCents, 0)
  assert.equal(totals.gainCents, 0)
  assert.equal(totals.gainPct, null)
  assert.equal(totals.unpricedCount, 0)
})

test('parses fractional quantities', () => {
  assert.deepEqual(parseQuantity('0.0035'), {
    ok: true,
    value: 0.0035,
    text: '0.0035',
  })
  assert.equal(parseQuantity('1,000').ok, true)
  assert.equal(parseQuantity('0').ok, false)
  assert.equal(parseQuantity('-1').ok, false)
  assert.equal(parseQuantity('0.00000000001').ok, false) // 11 decimals
  assert.equal(parseQuantity('abc').ok, false)
})

test('formats quantities without trailing zeros', () => {
  assert.equal(formatQuantity(0.5), '0.5')
  assert.equal(formatQuantity(10), '10')
  assert.equal(formatQuantity(0.0035), '0.0035')
})

test('a manual holding is valued at its self-reported value', () => {
  // S$12,000 paid into a plan currently worth S$10,500 — a real ILP scenario.
  const positions = buildPositions(
    [
      holding({
        kind: 'manual',
        symbol: 'MY-PLAN',
        name: 'My plan',
        quantity: 1,
        cost_basis_cents: 1_200_000,
        cost_currency: 'SGD',
        price_currency: 'SGD',
        manual_value_cents: 1_050_000,
      }),
    ],
    new Map(),
    null // no FX rate needed — manual values are already SGD
  )

  const p = positions[0]
  assert.equal(p.marketValueCents, 1_050_000)
  assert.equal(p.gainCents, -150_000)
  assert.equal(portfolioTotals(positions).marketValueCents, 1_050_000)
})

test('a manual holding with no value yet counts as unpriced, not zero', () => {
  const positions = buildPositions(
    [holding({ kind: 'manual', cost_basis_cents: 500_000, manual_value_cents: null })],
    new Map(),
    null
  )

  assert.equal(positions[0].marketValueCents, null)
  // Its cost must not drag totals down as a fake loss (same rule as an
  // unpriced ticker holding).
  const totals = portfolioTotals(positions)
  assert.equal(totals.unpricedCount, 1)
  assert.equal(totals.costBasisCents, 0)
})
