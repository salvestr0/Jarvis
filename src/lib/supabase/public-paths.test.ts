import assert from 'node:assert/strict'
import test from 'node:test'

import { isPublicServerPath } from './public-paths.ts'

test('allows only self-authenticating server endpoints without a user session', () => {
  for (const path of [
    '/api/agent/finance',
    '/api/telegram',
    '/api/cron/prices',
    '/api/reminders/deliver',
  ]) {
    assert.equal(isPublicServerPath(path), true, path)
  }
  assert.equal(isPublicServerPath('/api/agents'), false)
  assert.equal(isPublicServerPath('/money'), false)
})
