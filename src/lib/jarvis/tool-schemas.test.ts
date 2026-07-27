import assert from 'node:assert/strict'
import { test } from 'node:test'

import { TOOL_SCHEMAS } from './tool-schemas.ts'

test('every tool has a name, a prescriptive description, and an object schema', () => {
  for (const tool of TOOL_SCHEMAS) {
    assert.ok(tool.name.length > 0)
    // Descriptions tell the model WHEN to call, not just what it does.
    assert.ok(
      tool.description.startsWith('Call this when'),
      `${tool.name} description should start with "Call this when"`
    )
    assert.equal(tool.input_schema.type, 'object')
    assert.ok(typeof tool.input_schema.properties === 'object')
  }
})

test('tool names are unique', () => {
  const names = TOOL_SCHEMAS.map((t) => t.name)
  assert.equal(new Set(names).size, names.length)
})

test('required fields all exist in properties', () => {
  for (const tool of TOOL_SCHEMAS) {
    for (const key of tool.input_schema.required ?? []) {
      assert.ok(
        key in tool.input_schema.properties,
        `${tool.name} requires "${key}" which is not in properties`
      )
    }
  }
})

test('money amounts are strings, never numbers — parseMoney owns validation', () => {
  const log = TOOL_SCHEMAS.find((t) => t.name === 'log_transaction')
  assert.ok(log)
  const amount = log.input_schema.properties.amount as { type: string }
  assert.equal(amount.type, 'string')
})
