import assert from 'node:assert/strict'
import { test } from 'node:test'

import { requestOptionsForIteration } from './llm-request.ts'

test('keeps thinking disabled after a forced first tool call', () => {
  assert.deepEqual(requestOptionsForIteration(0, 'search_email', true), {
    thinking: { type: 'disabled' },
    tool_choice: { type: 'tool', name: 'search_email' },
  })
  assert.deepEqual(requestOptionsForIteration(1, 'search_email', true), {
    thinking: { type: 'disabled' },
  })
})

test('uses configured thinking effort when no tool is forced', () => {
  assert.deepEqual(requestOptionsForIteration(0, null, true), {
    output_config: { effort: 'max' },
  })
  assert.deepEqual(requestOptionsForIteration(1, null, true), {
    output_config: { effort: 'high' },
  })
})
