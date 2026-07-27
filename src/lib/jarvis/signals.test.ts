import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BILL_WINDOW_DAYS,
  computeSignals,
  type SignalsInput,
} from './signals.ts'

const TODAY = '2026-07-27'

function base(overrides: Partial<SignalsInput> = {}): SignalsInput {
  return {
    today: TODAY,
    recurring: [],
    tasks: [],
    netWorth: [],
    monthExpenseCents: 0,
    priorMonthExpenseCents: [],
    dayOfMonth: 27,
    daysInMonth: 31,
    goals: [],
    ...overrides,
  }
}

function kinds(input: SignalsInput): string[] {
  return computeSignals(input).map((s) => s.kind)
}

test('empty input produces no signals', () => {
  assert.deepEqual(computeSignals(base()), [])
})

// --- bills -----------------------------------------------------------------

test('bill due exactly at the window edge fires; one day beyond does not', () => {
  const bill = (next_due: string) => ({
    name: 'Insurance',
    direction: 'expense' as const,
    amount_cents: 12000,
    next_due,
  })
  assert.deepEqual(
    kinds(base({ recurring: [bill('2026-07-30')] })), // today + 3
    ['bill_due']
  )
  assert.deepEqual(kinds(base({ recurring: [bill('2026-07-31')] })), []) // today + 4
})

test('overdue bill is notable; upcoming is info; income recurring is ignored', () => {
  const signals = computeSignals(
    base({
      recurring: [
        { name: 'Rent', direction: 'expense', amount_cents: 100000, next_due: '2026-07-25' },
        { name: 'Netflix', direction: 'expense', amount_cents: 1500, next_due: TODAY },
        { name: 'Salary', direction: 'income', amount_cents: 500000, next_due: TODAY },
      ],
    })
  )
  assert.equal(signals.length, 2)
  assert.equal(signals[0].severity, 'notable') // sorted notable-first
  assert.ok(signals[0].text.includes('overdue'))
  assert.ok(signals[1].text.includes('due today'))
})

// --- tasks -----------------------------------------------------------------

test('overdue task notable, due-today info, done and undated tasks silent', () => {
  const signals = computeSignals(
    base({
      tasks: [
        { title: 'Renew passport', due_on: '2026-07-20', done: false },
        { title: 'Buy groceries', due_on: TODAY, done: false },
        { title: 'Old thing', due_on: '2026-07-01', done: true },
        { title: 'Someday', due_on: null, done: false },
      ],
    })
  )
  assert.deepEqual(
    signals.map((s) => s.severity),
    ['notable', 'info']
  )
})

// --- portfolio -------------------------------------------------------------

const point = (asOf: string, totalCents: number, investmentsCents: number) => ({
  asOf,
  totalCents,
  investmentsCents,
})

test('a single snapshot can fire nothing (no move, no high)', () => {
  assert.deepEqual(kinds(base({ netWorth: [point('2026-07-26', 1000, 1000)] })), [])
})

test('portfolio move fires at exactly 3% even below the cents floor', () => {
  const nw = [point('2026-07-26', 0, 10000), point(TODAY, 0, 10300)] // +3.0%, S$3
  assert.deepEqual(kinds(base({ netWorth: nw })), ['portfolio_move'])
  const below = [point('2026-07-26', 0, 10000), point(TODAY, 0, 10299)]
  assert.deepEqual(kinds(base({ netWorth: below })), [])
})

test('portfolio move fires at the S$500 floor even below 3%', () => {
  const nw = [
    point('2026-07-26', 0, 10_000_000), // S$100k invested
    point(TODAY, 0, 10_050_000), // +S$500 = 0.5%
  ]
  const signals = computeSignals(base({ netWorth: nw }))
  assert.deepEqual(
    signals.map((s) => s.kind),
    ['portfolio_move']
  )
  assert.ok(signals[0].text.includes('up'))
})

test('all-time-high fires only when the last point beats every earlier one', () => {
  const high = [point('01', 100, 0), point('02', 300, 0), point(TODAY, 301, 0)]
  assert.deepEqual(kinds(base({ netWorth: high })), ['net_worth_high'])
  const flat = [point('01', 100, 0), point('02', 300, 0), point(TODAY, 300, 0)]
  assert.deepEqual(kinds(base({ netWorth: flat })), [])
})

// --- spending pace ---------------------------------------------------------

test('spend pace fires at exactly 130% of the day-scaled average', () => {
  // avg 310_00 over 31 days -> expected by day 10 = 100_00; 130% = 130_00.
  const firing = base({
    priorMonthExpenseCents: [310_00],
    dayOfMonth: 10,
    daysInMonth: 31,
    monthExpenseCents: 130_00,
  })
  assert.deepEqual(kinds(firing), ['spend_pace'])

  const notFiring = base({
    priorMonthExpenseCents: [310_00],
    dayOfMonth: 10,
    daysInMonth: 31,
    monthExpenseCents: 129_99,
  })
  assert.deepEqual(kinds(notFiring), [])
})

test('spend pace stays quiet before day 5 and without a baseline', () => {
  const earlyMonth = base({
    priorMonthExpenseCents: [310_00],
    dayOfMonth: 4,
    daysInMonth: 31,
    monthExpenseCents: 999_99,
  })
  assert.deepEqual(kinds(earlyMonth), [])

  const noBaseline = base({
    priorMonthExpenseCents: [],
    dayOfMonth: 20,
    daysInMonth: 31,
    monthExpenseCents: 999_99,
  })
  assert.deepEqual(kinds(noBaseline), [])
})

// --- goals -----------------------------------------------------------------

test('goal deadline inside 7 days fires; outside or non-active does not', () => {
  const goal = (target_date: string | null, status = 'active') => ({
    title: 'Hit 10k savings',
    status,
    target_date,
  })
  assert.deepEqual(kinds(base({ goals: [goal('2026-08-03')] })), ['goal_deadline']) // +7
  assert.deepEqual(kinds(base({ goals: [goal('2026-08-04')] })), []) // +8
  assert.deepEqual(kinds(base({ goals: [goal('2026-07-20')] })), []) // past
  assert.deepEqual(kinds(base({ goals: [goal('2026-07-28', 'achieved')] })), [])
})

// --- ordering --------------------------------------------------------------

test('notable signals sort before info signals', () => {
  const signals = computeSignals(
    base({
      goals: [{ title: 'G', status: 'active', target_date: '2026-07-28' }], // info
      tasks: [{ title: 'T', due_on: '2026-07-01', done: false }], // notable
    })
  )
  assert.deepEqual(
    signals.map((s) => s.severity),
    ['notable', 'info']
  )
})

test(`bill window constant is ${BILL_WINDOW_DAYS} days (spec anchor)`, () => {
  assert.equal(BILL_WINDOW_DAYS, 3)
})
