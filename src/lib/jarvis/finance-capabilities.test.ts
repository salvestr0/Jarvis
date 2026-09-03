import assert from 'node:assert/strict'
import { test } from 'node:test'

import { executeFinanceCapability } from './finance-capabilities.ts'
import { parseFinanceToolRequest } from './finance-capability-schema.ts'

function fakeAdapter() {
  const calls: Array<{ method: string; args: unknown[] }> = []
  return {
    calls,
    adapter: {
      async executeTool(...args: unknown[]) {
        calls.push({ method: 'executeTool', args })
        return { ok: true }
      },
      async getRecentExpenses(...args: unknown[]) {
        calls.push({ method: 'getRecentExpenses', args })
        return []
      },
      async previewEmailExpenses(...args: unknown[]) {
        calls.push({ method: 'previewEmailExpenses', args })
        return { batch_id: 'batch' }
      },
      async commitEmailExpenses(...args: unknown[]) {
        calls.push({ method: 'commitEmailExpenses', args })
        return { committed: 1 }
      },
    },
  }
}

const context = { telegramUpdateId: 42, actionId: 'log-expense-0' }

test('maps log_expense to a forced expense write with a durable Telegram identity', async () => {
  const fake = fakeAdapter()
  const request = parseFinanceToolRequest({
    name: 'log_expense',
    input: { amount: '5.70', category: 'Food', note: 'Lunch' },
  })

  await executeFinanceCapability(request, context, fake.adapter)

  assert.deepEqual(fake.calls, [
    {
      method: 'executeTool',
      args: [
        'log_transaction',
        {
          direction: 'expense',
          amount: '5.70',
          category: 'Food',
          note: 'Lunch',
          date: undefined,
        },
        {
          transactionIdentity: {
            source: 'telegram',
            sourceKey: '42:log-expense-0',
          },
        },
      ],
    },
  ])
})

test('maps summary and recent-expense reads without exposing arbitrary queries', async () => {
  const fake = fakeAdapter()
  await executeFinanceCapability(
    parseFinanceToolRequest({ name: 'get_spending_summary', input: { month: '2026-09' } }),
    context,
    fake.adapter
  )
  await executeFinanceCapability(
    parseFinanceToolRequest({ name: 'get_recent_expenses', input: { limit: 3 } }),
    context,
    fake.adapter
  )

  assert.deepEqual(fake.calls, [
    {
      method: 'executeTool',
      args: ['get_month_summary', { month: '2026-09' }, undefined],
    },
    { method: 'getRecentExpenses', args: [3] },
  ])
})

test('passes the transport update id into preview and commit enforcement', async () => {
  const fake = fakeAdapter()
  await executeFinanceCapability(
    parseFinanceToolRequest({ name: 'preview_email_expenses', input: { days: 7 } }),
    context,
    fake.adapter
  )
  await executeFinanceCapability(
    parseFinanceToolRequest({
      name: 'commit_email_expenses',
      input: {
        batch_id: '7fb41aa5-0d5e-47d1-8310-d22431eb7c84',
        items: [{ index: 0, amount: '5.70', category: 'Food' }],
      },
    }),
    context,
    fake.adapter
  )

  assert.deepEqual(fake.calls, [
    { method: 'previewEmailExpenses', args: [7, 42] },
    {
      method: 'commitEmailExpenses',
      args: [
        '7fb41aa5-0d5e-47d1-8310-d22431eb7c84',
        [{ index: 0, amount: '5.70', category: 'Food', note: undefined, date: undefined }],
        42,
      ],
    },
  ])
})

test('rejects unsafe action identifiers used for transaction idempotency', async () => {
  const fake = fakeAdapter()
  const request = parseFinanceToolRequest({
    name: 'log_expense',
    input: { amount: '5.70', category: 'Food' },
  })
  await assert.rejects(
    executeFinanceCapability(
      request,
      { telegramUpdateId: 42, actionId: '../../same-key' },
      fake.adapter
    ),
    /action id/i
  )
  assert.deepEqual(fake.calls, [])
})
