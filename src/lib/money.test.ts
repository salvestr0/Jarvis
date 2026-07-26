import assert from 'node:assert/strict'
import { test } from 'node:test'

import { centsToInput, formatMoney, formatSigned, parseMoney } from './money.ts'
import { monthEndExclusive, shiftMonth, isValidMonth } from './date.ts'

test('parses plain and decimal amounts', () => {
  assert.deepEqual(parseMoney('12'), { ok: true, cents: 1200 })
  assert.deepEqual(parseMoney('12.3'), { ok: true, cents: 1230 })
  assert.deepEqual(parseMoney('12.34'), { ok: true, cents: 1234 })
  assert.deepEqual(parseMoney('0.05'), { ok: true, cents: 5 })
  assert.deepEqual(parseMoney('.5'), { ok: true, cents: 50 })
})

test('tolerates the ways people actually type money', () => {
  assert.deepEqual(parseMoney(' 1,234.56 '), { ok: true, cents: 123456 })
  assert.deepEqual(parseMoney('$99.99'), { ok: true, cents: 9999 })
  assert.deepEqual(parseMoney('S$40'), { ok: true, cents: 4000 })
})

test('rejects bad input instead of guessing', () => {
  assert.equal(parseMoney('').ok, false)
  assert.equal(parseMoney('abc').ok, false)
  assert.equal(parseMoney('12.345').ok, false) // too many decimals
  assert.equal(parseMoney('-5').ok, false) // direction is a separate field
  assert.equal(parseMoney('0').ok, false) // a zero transaction is meaningless
  assert.equal(parseMoney('.').ok, false)
})

test('no floating point drift — the reason we store cents', () => {
  // The bug this design exists to prevent: 19.99 * 100 is 1998.9999999999998
  // in IEEE-754 floats, so a naive parser would store 1998 cents and lose a cent.
  const naive = Math.floor(19.99 * 100)
  assert.equal(naive, 1998, 'float maths really does lose a cent here')

  const parsed = parseMoney('19.99')
  assert.deepEqual(parsed, { ok: true, cents: 1999 }, 'our parser does not')

  // Summing a year of the classic problem case stays exact with integers.
  let total = 0
  for (let i = 0; i < 1000; i++) total += parseMoney('0.10').ok ? 10 : 0
  assert.equal(total, 10_000) // exactly S$100.00
})

test('round trips cents to an editable string and back', () => {
  for (const cents of [1, 5, 99, 100, 1234, 100_000, 123_456_789]) {
    const asInput = centsToInput(cents)
    assert.deepEqual(
      parseMoney(asInput),
      { ok: true, cents },
      `round trip failed for ${cents}`
    )
  }
})

test('formats for display', () => {
  assert.equal(formatMoney(123456), 'S$1,234.56')
  assert.equal(formatMoney(0), 'S$0.00')
  assert.equal(formatMoney(5), 'S$0.05')
  assert.equal(formatSigned(1234, 'expense'), '-S$12.34')
  assert.equal(formatSigned(1234, 'income'), '+S$12.34')
})

test('month ranges cover December correctly', () => {
  assert.equal(monthEndExclusive('2026-07'), '2026-08-01')
  // The off-by-one that bites: December must roll into the next year.
  assert.equal(monthEndExclusive('2026-12'), '2027-01-01')
  assert.equal(monthEndExclusive('2026-01'), '2026-02-01')
})

test('shifts months across year boundaries', () => {
  assert.equal(shiftMonth('2026-07', 1), '2026-08')
  assert.equal(shiftMonth('2026-12', 1), '2027-01')
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  assert.equal(shiftMonth('2026-07', -12), '2025-07')
})

test('rejects junk month values from the URL', () => {
  assert.equal(isValidMonth('2026-07'), true)
  assert.equal(isValidMonth('2026-13'), false)
  assert.equal(isValidMonth('2026-00'), false)
  assert.equal(isValidMonth('lol'), false)
  assert.equal(isValidMonth(''), false)
})
