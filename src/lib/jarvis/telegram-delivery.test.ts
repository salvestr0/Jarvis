import assert from 'node:assert/strict'
import test from 'node:test'

import { prepareJarvisDelivery, prepareTelegramDelivery } from './telegram-delivery.ts'

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

test('legacy backend stays operational before the agent migration is applied', async () => {
  let touchedDatabase = false
  const result = await prepareJarvisDelivery('legacy', 42, {
    createLeaseToken: () => 'lease-1',
    getDb: async () => {
      touchedDatabase = true
      return { userId: 'user-1', client: {} }
    },
    claim: async () => {
      touchedDatabase = true
      return true
    },
  })

  assert.deepEqual(result, { backend: 'legacy' })
  assert.equal(touchedDatabase, false)
})
