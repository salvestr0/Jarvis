import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isAuthorizedAgentRequest } from './agent-auth.ts'

const secret = '0123456789abcdef0123456789abcdef'

test('accepts only an exact bearer token', () => {
  assert.equal(
    isAuthorizedAgentRequest(new Headers({ authorization: `Bearer ${secret}` }), secret),
    true
  )
  assert.equal(isAuthorizedAgentRequest(new Headers(), secret), false)
  assert.equal(
    isAuthorizedAgentRequest(new Headers({ authorization: `Bearer ${secret}x` }), secret),
    false
  )
  assert.equal(
    isAuthorizedAgentRequest(new Headers({ authorization: `Basic ${secret}` }), secret),
    false
  )
})

test('fails closed when the configured secret is too short', () => {
  assert.equal(
    isAuthorizedAgentRequest(new Headers({ authorization: 'Bearer short' }), 'short'),
    false
  )
})
