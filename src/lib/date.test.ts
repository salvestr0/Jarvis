import assert from 'node:assert/strict'
import { test } from 'node:test'

import { advanceByCadence } from './date.ts'
import { monthlyEquivalentCents } from './money.ts'

test('monthly advance keeps the billing day', () => {
  assert.equal(advanceByCadence('2026-07-15', 'monthly'), '2026-08-15')
  assert.equal(advanceByCadence('2026-12-15', 'monthly'), '2027-01-15')
})

test('monthly advance clamps days the next month does not have', () => {
  assert.equal(advanceByCadence('2026-01-31', 'monthly'), '2026-02-28')
  assert.equal(advanceByCadence('2028-01-31', 'monthly'), '2028-02-29') // leap year
  assert.equal(advanceByCadence('2026-08-31', 'monthly'), '2026-09-30')
})

test('yearly advance handles 29 Feb', () => {
  assert.equal(advanceByCadence('2026-03-01', 'yearly'), '2027-03-01')
  assert.equal(advanceByCadence('2028-02-29', 'yearly'), '2029-02-28')
})

test('weekly advance crosses month and year boundaries', () => {
  assert.equal(advanceByCadence('2026-07-01', 'weekly'), '2026-07-08')
  assert.equal(advanceByCadence('2026-07-28', 'weekly'), '2026-08-04')
  assert.equal(advanceByCadence('2026-12-29', 'weekly'), '2027-01-05')
})

test('monthly equivalents make cadences comparable', () => {
  assert.equal(monthlyEquivalentCents(1500, 'monthly'), 1500)
  assert.equal(monthlyEquivalentCents(120000, 'yearly'), 10000) // S$1,200/yr = S$100/mo
  assert.equal(monthlyEquivalentCents(1200, 'weekly'), 5200) // S$12/wk = S$52/mo
})
