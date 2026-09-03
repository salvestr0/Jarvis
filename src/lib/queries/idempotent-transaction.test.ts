import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createIdempotentTransaction } from './idempotent-transaction.ts'

type Row = Record<string, unknown>

function fakeClient(options: { inserted?: { id: string } | null; existing?: { id: string } }) {
  const calls: Array<{ kind: string; value?: unknown }> = []
  return {
    calls,
    client: {
      from(table: string) {
        assert.equal(table, 'transactions')
        return {
          upsert(row: Row, opts: unknown) {
            calls.push({ kind: 'upsert', value: { row, opts } })
            return {
              select() {
                return {
                  async maybeSingle() {
                    return { data: options.inserted ?? null, error: null }
                  },
                }
              },
            }
          },
          select() {
            const filters: Array<[string, unknown]> = []
            const query = {
              eq(key: string, value: unknown) {
                filters.push([key, value])
                return query
              },
              async single() {
                calls.push({ kind: 'lookup', value: filters })
                return options.existing
                  ? { data: options.existing, error: null }
                  : { data: null, error: { message: 'missing' } }
              },
            }
            return query
          },
        }
      },
    },
  }
}

const input = {
  occurred_on: '2026-09-03',
  direction: 'expense' as const,
  amount_cents: 570,
  currency: 'SGD',
  category_id: null,
  account_id: null,
  note: 'Lunch',
}

test('returns the inserted transaction for a new source key', async () => {
  const fake = fakeClient({ inserted: { id: 'new-id' } })
  const result = await createIdempotentTransaction(
    fake.client,
    'user-1',
    input,
    { source: 'telegram', sourceKey: 'update-7:log-expense:0' }
  )

  assert.deepEqual(result, { id: 'new-id', created: true })
  assert.equal(fake.calls.filter((call) => call.kind === 'lookup').length, 0)
  assert.deepEqual(fake.calls[0], {
    kind: 'upsert',
    value: {
      row: {
        ...input,
        user_id: 'user-1',
        source: 'telegram',
        source_key: 'update-7:log-expense:0',
      },
      opts: {
        onConflict: 'user_id,source,source_key',
        ignoreDuplicates: true,
      },
    },
  })
})

test('returns the existing transaction when the same source key is retried', async () => {
  const fake = fakeClient({ inserted: null, existing: { id: 'existing-id' } })
  const result = await createIdempotentTransaction(
    fake.client,
    'user-1',
    input,
    { source: 'telegram', sourceKey: 'update-7:log-expense:0' }
  )

  assert.deepEqual(result, { id: 'existing-id', created: false })
  assert.deepEqual(fake.calls[1], {
    kind: 'lookup',
    value: [
      ['user_id', 'user-1'],
      ['source', 'telegram'],
      ['source_key', 'update-7:log-expense:0'],
    ],
  })
})

test('rejects an empty durable source key before touching the database', async () => {
  const fake = fakeClient({})
  await assert.rejects(
    createIdempotentTransaction(fake.client, 'user-1', input, {
      source: 'telegram',
      sourceKey: '   ',
    }),
    /source key is required/i
  )
  assert.deepEqual(fake.calls, [])
})
