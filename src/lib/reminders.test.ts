import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  formatSgt,
  nextDueAt,
  parseSgt,
  reminderMessage,
  validateDueAt,
} from './reminders.ts'

test('parseSgt: SGT is UTC+8', () => {
  const d = parseSgt('2026-07-30 15:00')
  assert.ok(d)
  assert.equal(d.toISOString(), '2026-07-30T07:00:00.000Z')
})

test('parseSgt: accepts a T separator, round-trips through formatSgt', () => {
  const d = parseSgt('2026-01-01T00:30')
  assert.ok(d)
  assert.equal(formatSgt(d), '2026-01-01 00:30')
})

test('parseSgt: rejects malformed and impossible inputs', () => {
  for (const bad of [
    'tomorrow 3pm',
    '2026-07-30',
    '2026-07-30 25:00',
    '2026-07-30 15:60',
    '2026-13-01 10:00',
    '2026-02-31 10:00', // Date.UTC would roll this over to March
    '',
  ]) {
    assert.equal(parseSgt(bad), null, `should reject: ${bad}`)
  }
})

test('formatSgt: midnight UTC is 08:00 in Singapore', () => {
  assert.equal(formatSgt('2026-07-30T00:00:00.000Z'), '2026-07-30 08:00')
})

test('validateDueAt: rejects past and >1 year, accepts in between', () => {
  const now = new Date('2026-07-30T00:00:00Z')
  assert.ok(validateDueAt(new Date('2026-07-29T23:59:00Z'), now))
  assert.ok(validateDueAt(now, now)) // exactly now is already too late
  assert.ok(validateDueAt(new Date('2027-09-01T00:00:00Z'), now))
  assert.equal(validateDueAt(new Date('2026-07-30T00:01:00Z'), now), null)
  assert.equal(validateDueAt(new Date('2027-07-01T00:00:00Z'), now), null)
})

test('nextDueAt: one-shot reminders have no next occurrence', () => {
  const now = new Date('2026-07-30T00:00:00Z')
  assert.equal(nextDueAt(new Date('2026-07-29T00:00:00Z'), 'none', now), null)
})

test('nextDueAt: advances from the scheduled time, not delivery time', () => {
  // Due 09:00, delivered 09:04 — tomorrow's is 09:00 sharp, no drift.
  const due = new Date('2026-07-30T01:00:00Z')
  const now = new Date('2026-07-30T01:04:00Z')
  assert.equal(
    nextDueAt(due, 'daily', now)?.toISOString(),
    '2026-07-31T01:00:00.000Z'
  )
})

test('nextDueAt: fast-forwards past missed occurrences', () => {
  // Daily reminder, every ticker offline for 3 days: one delivery happens,
  // and the next slot is tomorrow — not three stale ones.
  const due = new Date('2026-07-27T01:00:00Z')
  const now = new Date('2026-07-30T02:00:00Z')
  assert.equal(
    nextDueAt(due, 'daily', now)?.toISOString(),
    '2026-07-31T01:00:00.000Z'
  )
})

test('nextDueAt: weekly steps seven days', () => {
  const due = new Date('2026-07-27T01:00:00Z')
  const now = new Date('2026-07-27T01:00:30Z')
  assert.equal(
    nextDueAt(due, 'weekly', now)?.toISOString(),
    '2026-08-03T01:00:00.000Z'
  )
})

test('reminderMessage: on time is bare, >5 min late says when it was due', () => {
  const due = new Date('2026-07-30T07:00:00Z') // 15:00 SGT
  const onTime = new Date(due.getTime() + 4 * 60 * 1000)
  const late = new Date(due.getTime() + 6 * 60 * 1000)
  assert.equal(reminderMessage('call the bank', due, onTime), '⏰ call the bank')
  assert.equal(
    reminderMessage('call the bank', due, late),
    '⏰ call the bank (due 2026-07-30 15:00)'
  )
})
