import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ACTION_TOOLS } from '../action-claim.ts'
import { TOOL_SCHEMAS } from './tool-schemas.ts'
import {
  executeJarvisMcpTool,
  isAuthorizedMcpRequest,
  jarvisMcpTools,
} from './mcp-core.ts'

test('MCP authorization fails closed and accepts only the exact bearer secret', () => {
  const secret = 'a'.repeat(32)

  assert.equal(isAuthorizedMcpRequest(new Headers(), undefined), false)
  assert.equal(
    isAuthorizedMcpRequest(new Headers({ authorization: `Bearer ${secret}` }), 'short'),
    false
  )
  assert.equal(
    isAuthorizedMcpRequest(new Headers({ authorization: `Bearer ${secret}x` }), secret),
    false
  )
  assert.equal(
    isAuthorizedMcpRequest(new Headers({ authorization: `Bearer ${secret}` }), secret),
    true
  )
  assert.equal(
    isAuthorizedMcpRequest(new Headers({ authorization: `bearer ${secret}` }), secret),
    true
  )
})

test('MCP catalog exposes only the documented core Jarvis tools in MCP format', () => {
  const expectedNames = [
    'get_net_worth',
    'get_net_worth_history',
    'get_month_summary',
    'get_month_transactions',
    'get_recurring',
    'get_holdings',
    'get_goals',
    'get_tasks',
    'get_jobs',
    'get_projects',
    'search_email',
    'get_email',
    'log_transaction',
    'create_task',
    'set_task_done',
    'create_goal',
    'set_goal_status',
  ]

  assert.deepEqual(
    jarvisMcpTools().map(({ name }) => name),
    expectedNames
  )
  assert.deepEqual(
    jarvisMcpTools(),
    expectedNames.map((name) => {
      const schema = TOOL_SCHEMAS.find((tool) => tool.name === name)!
      return {
        name,
        description: schema.description,
        inputSchema: schema.input_schema,
      }
    })
  )
})

test('MCP dispatch rejects unknown tools before reaching the executor', async () => {
  let called = false

  await assert.rejects(
    executeJarvisMcpTool('drop_database', {}, async () => {
      called = true
      return 'never'
    }),
    /not available/i
  )
  assert.equal(called, false)
})

test('MCP dispatch returns structured executor JSON and identifies writes', async () => {
  const result = await executeJarvisMcpTool(
    'log_transaction',
    { direction: 'expense', amount: '12.34', category: 'Food' },
    async (name, input) => {
      assert.equal(name, 'log_transaction')
      assert.deepEqual(input, {
        direction: 'expense',
        amount: '12.34',
        category: 'Food',
      })
      return JSON.stringify({ logged: { amount: 'SGD 12.34' } })
    }
  )

  assert.equal(ACTION_TOOLS.has('log_transaction'), true)
  assert.deepEqual(result, { logged: { amount: 'SGD 12.34' } })
})

test('MCP dispatch fails closed on malformed executor output', async () => {
  await assert.rejects(
    executeJarvisMcpTool('get_net_worth', {}, async () => 'not-json'),
    /malformed JSON/i
  )
})
