import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  parseAgentCapabilityEnvelope,
  parseFinanceToolRequest,
} from './finance-capability-schema.ts'

test('accepts only the five narrow finance capabilities', () => {
  const accepted = [
    ['log_expense', { amount: '5.70', category: 'Food', note: 'Lunch' }],
    ['get_spending_summary', { month: '2026-09' }],
    ['get_recent_expenses', { limit: 5 }],
    ['preview_email_expenses', { days: 7 }],
    [
      'commit_email_expenses',
      {
        batch_id: '7fb41aa5-0d5e-47d1-8310-d22431eb7c84',
        items: [
          { index: 0, amount: '5.70', category: 'Food', date: '2026-09-03' },
        ],
      },
    ],
  ] as const

  for (const [name, input] of accepted) {
    assert.equal(parseFinanceToolRequest({ name, input }).name, name)
  }

  assert.throws(
    () => parseFinanceToolRequest({ name: 'search_email', input: { query: 'all' } }),
    /not allowed/i
  )
})

test('log_expense fixes the direction to expense and rejects unexpected fields', () => {
  assert.throws(
    () =>
      parseFinanceToolRequest({
        name: 'log_expense',
        input: { amount: '100', category: 'Salary', direction: 'income' },
      }),
    /unexpected field/i
  )
  assert.throws(
    () =>
      parseFinanceToolRequest({
        name: 'log_expense',
        input: { amount: '-1', category: 'Food' },
      }),
    /amount/i
  )
})

test('preview_email_expenses accepts a bounded lookback and no Gmail query', () => {
  assert.throws(
    () =>
      parseFinanceToolRequest({
        name: 'preview_email_expenses',
        input: { days: 31 },
      }),
    /days/i
  )
  assert.throws(
    () =>
      parseFinanceToolRequest({
        name: 'preview_email_expenses',
        input: { query: 'in:anywhere' },
      }),
    /unexpected field/i
  )
})

test('commit_email_expenses rejects duplicate indexes and malformed batches', () => {
  assert.throws(
    () =>
      parseFinanceToolRequest({
        name: 'commit_email_expenses',
        input: {
          batch_id: 'not-a-uuid',
          items: [{ index: 0, amount: '5', category: 'Food' }],
        },
      }),
    /batch_id/i
  )

  assert.throws(
    () =>
      parseFinanceToolRequest({
        name: 'commit_email_expenses',
        input: {
          batch_id: '7fb41aa5-0d5e-47d1-8310-d22431eb7c84',
          items: [
            { index: 0, amount: '5', category: 'Food' },
            { index: 0, amount: '7', category: 'Transport' },
          ],
        },
      }),
    /duplicate/i
  )
})

test('parses the authenticated transport context separately from model input', () => {
  assert.deepEqual(
    parseAgentCapabilityEnvelope({
      name: 'get_recent_expenses',
      input: { limit: 5 },
      context: { telegram_update_id: 42, action_id: 'recent-0' },
    }),
    {
      request: { name: 'get_recent_expenses', input: { limit: 5 } },
      context: { telegramUpdateId: 42, actionId: 'recent-0' },
    }
  )

  assert.throws(
    () =>
      parseAgentCapabilityEnvelope({
        name: 'get_recent_expenses',
        input: {},
        context: { telegram_update_id: 42, action_id: 'recent-0', user_id: 'other' },
      }),
    /unexpected field/i
  )
})
