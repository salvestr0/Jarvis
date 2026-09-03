import assert from 'node:assert/strict'
import test from 'node:test'

import { prepareTelegramDelivery } from './telegram-delivery.ts'

test('claims the update before returning work for background dispatch', async () => {
  const events: string[] = []
  const db = { userId: 'user-1', client: {} }

  const result = await prepareTelegramDelivery(42, {
    createLeaseToken: () => 'lease-1',
    getDb: async () => {
      events.push('db')
      return db
    },
    claim: async (claimedDb, updateId, leaseToken) => {
      events.push('claim')
      assert.equal(claimedDb, db)
      assert.equal(updateId, 42)
      assert.equal(leaseToken, 'lease-1')
      return true
    },
  })

  assert.deepEqual(events, ['db', 'claim'])
  assert.deepEqual(result, { db, leaseToken: 'lease-1' })
})

test('does not dispatch a duplicate and propagates claim failures for Telegram retry', async () => {
  const db = { userId: 'user-1', client: {} }
  const duplicate = await prepareTelegramDelivery(42, {
    createLeaseToken: () => 'lease-1',
    getDb: async () => db,
    claim: async () => false,
  })
  assert.equal(duplicate, null)

  await assert.rejects(
    prepareTelegramDelivery(42, {
      createLeaseToken: () => 'lease-1',
      getDb: async () => db,
      claim: async () => {
        throw new Error('database unavailable')
      },
    }),
    /database unavailable/
  )
})
