import assert from 'node:assert/strict'
import { test } from 'node:test'

import { addDaysIso, inDateRange, weekWindowSgt } from './review-window.ts'

test('weekWindowSgt: a Sunday-evening send covers Monday of that week', () => {
  // Sunday 2 Aug 2026 20:00 SGT = 12:00 UTC.
  const w = weekWindowSgt(new Date('2026-08-02T12:00:00Z'))
  assert.equal(w.start, '2026-07-27') // that week's Monday
  assert.equal(w.endExclusive, '2026-08-03')
  assert.equal(w.prevStart, '2026-07-20')
  assert.equal(w.startInstant, '2026-07-26T16:00:00.000Z') // Mon 00:00 SGT
})

test('addDaysIso: crosses month and year boundaries', () => {
  assert.equal(addDaysIso('2026-07-29', 7), '2026-08-05')
  assert.equal(addDaysIso('2026-12-29', 7), '2027-01-05')
  assert.equal(addDaysIso('2026-03-01', -1), '2026-02-28')
})

test('weekWindowSgt: Monday just after midnight SGT starts a fresh week', () => {
  // Monday 3 Aug 2026 00:30 SGT = Sunday 16:30 UTC.
  const w = weekWindowSgt(new Date('2026-08-02T16:30:00Z'))
  assert.equal(w.start, '2026-08-03')
  assert.equal(w.prevStart, '2026-07-27')
})

test('weekWindowSgt: late Sunday SGT is still the old week even though UTC has moved on', () => {
  // Sunday 2 Aug 2026 23:30 SGT = 15:30 UTC (same UTC day as the Monday case).
  const w = weekWindowSgt(new Date('2026-08-02T15:30:00Z'))
  assert.equal(w.start, '2026-07-27')
})

test('weekWindowSgt: months list covers a window spanning a month boundary', () => {
  // Wed 2 Sep 2026 SGT — this week starts 31 Aug, prev week 24 Aug.
  const w = weekWindowSgt(new Date('2026-09-02T04:00:00Z'))
  assert.equal(w.start, '2026-08-31')
  assert.deepEqual(w.months, ['2026-08', '2026-09'])
})

test('weekWindowSgt: single month when both weeks fit inside it', () => {
  // Fri 24 Jul 2026 SGT — weeks of 20 Jul and 13 Jul, both in July.
  const w = weekWindowSgt(new Date('2026-07-24T04:00:00Z'))
  assert.deepEqual(w.months, ['2026-07'])
})

test('inDateRange: inclusive start, exclusive end', () => {
  assert.ok(inDateRange('2026-07-27', '2026-07-27', '2026-08-03'))
  assert.ok(inDateRange('2026-08-02', '2026-07-27', '2026-08-03'))
  assert.ok(!inDateRange('2026-08-03', '2026-07-27', '2026-08-03'))
  assert.ok(!inDateRange('2026-07-26', '2026-07-27', '2026-08-03'))
})
