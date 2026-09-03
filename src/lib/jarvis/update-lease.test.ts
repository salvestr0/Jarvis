import assert from 'node:assert/strict'
import { test } from 'node:test'

import { claimTelegramUpdate, finishTelegramUpdate } from './update-lease.ts'

function fakeDb(results: Array<{ data: boolean | null; error: { message: string } | null }>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  return {
    calls,
    db: {
      userId: 'user-1',
      client: {
        async rpc(name: string, args: Record<string, unknown>) {
          calls.push({ name, args })
          const next = results.shift()
          if (!next) throw new Error('missing fake result')
          return next
        },
      },
    },
  }
}

test('claims a Telegram update with a fenced lease token', async () => {
  const fake = fakeDb([{ data: true, error: null }])
  const claimed = await claimTelegramUpdate(fake.db, 42, 'lease-token', 240)

  assert.equal(claimed, true)
  assert.deepEqual(fake.calls, [
    {
      name: 'claim_telegram_update',
      args: {
        p_user_id: 'user-1',
        p_update_id: 42,
        p_lease_token: 'lease-token',
        p_lease_seconds: 240,
      },
    },
  ])
})

test('returns false when a completed or actively leased update cannot be claimed', async () => {
  const fake = fakeDb([{ data: false, error: null }])
  assert.equal(await claimTelegramUpdate(fake.db, 42, 'lease-token'), false)
})

test('finishes only the update owned by the same lease token', async () => {
  const fake = fakeDb([{ data: true, error: null }])
  const finished = await finishTelegramUpdate(fake.db, 42, 'lease-token', {
    succeeded: false,
    error: 'provider unavailable',
  })

  assert.equal(finished, true)
  assert.deepEqual(fake.calls[0], {
    name: 'finish_telegram_update',
    args: {
      p_user_id: 'user-1',
      p_update_id: 42,
      p_lease_token: 'lease-token',
      p_succeeded: false,
      p_error: 'provider unavailable',
    },
  })
})

test('surfaces database errors instead of treating them as duplicate updates', async () => {
  const fake = fakeDb([{ data: null, error: { message: 'rpc unavailable' } }])
  await assert.rejects(
    claimTelegramUpdate(fake.db, 42, 'lease-token'),
    /rpc unavailable/
  )
})
