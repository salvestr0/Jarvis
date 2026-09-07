import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isPublicPath } from './public-paths.ts'

test('the MCP endpoint bypasses browser-session auth and uses its route bearer auth', () => {
  assert.equal(isPublicPath('/api/mcp'), true)
  assert.equal(isPublicPath('/api/mcp/anything'), true)
  assert.equal(isPublicPath('/money'), false)
})
