import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  emptyFilter,
  filterRecurring,
  filterTransactions,
  hasActiveFilter,
} from './filters.ts'
import type { RecurringRow, TransactionRow } from './types.ts'

function tx(overrides: Partial<TransactionRow>): TransactionRow {
  return {
    id: 'id',
    occurred_on: '2026-07-15',
    direction: 'expense',
    amount_cents: 1000,
    currency: 'SGD',
    category_id: null,
    account_id: null,
    note: null,
    category_name: null,
    account_name: null,
    ...overrides,
  }
}

function rec(overrides: Partial<RecurringRow>): RecurringRow {
  return {
    id: 'id',
    name: 'Netflix',
    direction: 'expense',
    amount_cents: 1500,
    currency: 'SGD',
    cadence: 'monthly',
    next_due: '2026-08-01',
    category_id: null,
    active: true,
    category_name: null,
    ...overrides,
  }
}

const rows = [
  tx({ id: 'a', direction: 'income', category_id: 'salary', category_name: 'Salary' }),
  tx({ id: 'b', category_id: 'food', category_name: 'Food', note: 'Chicken rice' }),
  tx({ id: 'c', account_id: 'bank', account_name: 'Bank' }),
]

test('no filter passes everything through', () => {
  assert.equal(filterTransactions(rows, emptyFilter).length, 3)
  assert.equal(hasActiveFilter(emptyFilter), false)
})

test('filters by direction', () => {
  const out = filterTransactions(rows, { ...emptyFilter, type: 'income' })
  assert.deepEqual(out.map((r) => r.id), ['a'])
})

test('filters by category, including uncategorised', () => {
  const food = filterTransactions(rows, { ...emptyFilter, categoryId: 'food' })
  assert.deepEqual(food.map((r) => r.id), ['b'])

  const none = filterTransactions(rows, { ...emptyFilter, categoryId: 'uncategorised' })
  assert.deepEqual(none.map((r) => r.id), ['c'])
})

test('filters by account', () => {
  const out = filterTransactions(rows, { ...emptyFilter, accountId: 'bank' })
  assert.deepEqual(out.map((r) => r.id), ['c'])
})

test('text search is case-insensitive across note, category and account', () => {
  assert.deepEqual(
    filterTransactions(rows, { ...emptyFilter, q: 'CHICKEN' }).map((r) => r.id),
    ['b']
  )
  assert.deepEqual(
    filterTransactions(rows, { ...emptyFilter, q: 'salary' }).map((r) => r.id),
    ['a']
  )
  assert.equal(filterTransactions(rows, { ...emptyFilter, q: 'zzz' }).length, 0)
})

test('filters combine with AND', () => {
  const out = filterTransactions(rows, {
    ...emptyFilter,
    type: 'expense',
    q: 'bank',
  })
  assert.deepEqual(out.map((r) => r.id), ['c'])
})

test('recurring filters by name and ignores the account filter', () => {
  const items = [
    rec({ id: 'n', name: 'Netflix' }),
    rec({ id: 'i', name: 'Car insurance', cadence: 'yearly' }),
  ]

  assert.deepEqual(
    filterRecurring(items, { ...emptyFilter, q: 'insur' }).map((r) => r.id),
    ['i']
  )
  // Recurring items have no account, so an account filter must not hide them.
  assert.equal(
    filterRecurring(items, { ...emptyFilter, accountId: 'bank' }).length,
    2
  )
})
