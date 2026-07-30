import assert from 'node:assert/strict'
import { test } from 'node:test'

import { alertCrossed, alertMessage, formatUsdMicros, parseUsdToMicros } from './alerts.ts'

test('parseUsdToMicros: plain, $-prefixed, comma-grouped, and decimal amounts', () => {
  assert.deepEqual(parseUsdToMicros('120000'), { ok: true, micros: 120_000_000_000 })
  assert.deepEqual(parseUsdToMicros('$120,000'), { ok: true, micros: 120_000_000_000 })
  assert.deepEqual(parseUsdToMicros('1.5'), { ok: true, micros: 1_500_000 })
  assert.deepEqual(parseUsdToMicros('0.35'), { ok: true, micros: 350_000 })
  // Six decimals survive exactly — no float drift.
  assert.deepEqual(parseUsdToMicros('0.000021'), { ok: true, micros: 21 })
})

test('parseUsdToMicros: rejects junk, zero, over-precision, and absurd sizes', () => {
  assert.equal(parseUsdToMicros('120k').ok, false)
  assert.equal(parseUsdToMicros('-5').ok, false)
  assert.equal(parseUsdToMicros('0').ok, false)
  assert.equal(parseUsdToMicros('0.0000001').ok, false) // 7 decimals
  assert.equal(parseUsdToMicros('200000000').ok, false) // > $100M
  assert.equal(parseUsdToMicros('').ok, false)
})

test('formatUsdMicros: whole dollars clean, cents when needed, sub-dollar trimmed', () => {
  assert.equal(formatUsdMicros(120_000_000_000), '$120,000')
  assert.equal(formatUsdMicros(1_500_000), '$1.50')
  assert.equal(formatUsdMicros(350_000), '$0.35')
  assert.equal(formatUsdMicros(21), '$0.000021')
})

test('alertCrossed: above fires at or over the target, below at or under', () => {
  assert.ok(alertCrossed('above', 100, 100))
  assert.ok(alertCrossed('above', 100, 101))
  assert.ok(!alertCrossed('above', 100, 99))
  assert.ok(alertCrossed('below', 100, 100))
  assert.ok(alertCrossed('below', 100, 99))
  assert.ok(!alertCrossed('below', 100, 101))
})

test('alertMessage: names the symbol, both prices, and that it will not re-fire', () => {
  const msg = alertMessage('BTC', 'above', 120_000_000_000, 120_150_000_000)
  assert.ok(msg.includes('BTC'))
  assert.ok(msg.includes('$120,150'))
  assert.ok(msg.includes('$120,000'))
  assert.ok(msg.includes('done'))
})
