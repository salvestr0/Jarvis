import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  dailyTotals,
  errorRow,
  estimateCostCents,
  extractUsageRow,
  p95LatencyMs,
  sgtDateOf,
  totalCostCents,
} from './llm.ts'

type FakeMessage = Parameters<typeof extractUsageRow>[0]

function fakeMessage(overrides: {
  content?: unknown[]
  usage?: Record<string, unknown>
  stop_reason?: string | null
}): FakeMessage {
  return {
    model: 'claude-sonnet-5',
    stop_reason: overrides.stop_reason ?? 'end_turn',
    content: overrides.content ?? [{ type: 'text', text: 'hi' }],
    usage: {
      input_tokens: 1000,
      output_tokens: 200,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
      ...overrides.usage,
    },
  } as unknown as FakeMessage
}

test('extractUsageRow reads tokens and coalesces null cache fields to 0', () => {
  const row = extractUsageRow(fakeMessage({}))
  assert.equal(row.model, 'claude-sonnet-5')
  assert.equal(row.input_tokens, 1000)
  assert.equal(row.output_tokens, 200)
  assert.equal(row.cache_creation_input_tokens, 0)
  assert.equal(row.cache_read_input_tokens, 0)
  assert.equal(row.stop_reason, 'end_turn')
  assert.deepEqual(row.tools_called, [])
  assert.equal(row.error, null)
})

test('extractUsageRow collects tool names, web_search included like any other', () => {
  const row = extractUsageRow(
    fakeMessage({
      content: [
        { type: 'text', text: 'working on it' },
        { type: 'tool_use', id: 't1', name: 'add_expense', input: {} },
        { type: 'tool_use', id: 't2', name: 'web_search', input: { query: 'btc' } },
      ],
      stop_reason: 'tool_use',
    })
  )
  assert.deepEqual(row.tools_called, ['add_expense', 'web_search'])
  assert.equal(row.stop_reason, 'tool_use')
})

test('errorRow carries the message and zero usage', () => {
  const row = errorRow('claude-sonnet-5', new Error('rate limited'))
  assert.equal(row.error, 'rate limited')
  assert.equal(row.input_tokens, 0)
  assert.equal(row.output_tokens, 0)
  assert.equal(errorRow('m', 'boom').error, 'Unknown error')
})

test('estimateCostCents uses the intro rate before Sep 2026', () => {
  // 1M in + 1M out at $2/$10 per MTok = 200 + 1000 cents.
  const cents = estimateCostCents({
    created_at: '2026-08-10T02:00:00Z',
    model: 'claude-sonnet-5',
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  })
  assert.equal(cents, 1200)
})

test('estimateCostCents uses the standard rate from Sep 2026', () => {
  // Same tokens at $3/$15 per MTok = 300 + 1500 cents.
  const cents = estimateCostCents({
    created_at: '2026-09-01T00:00:00Z',
    model: 'claude-sonnet-5',
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  })
  assert.equal(cents, 1800)
})

test('estimateCostCents prices cache writes at 1.25x and reads at 0.1x input', () => {
  const cents = estimateCostCents({
    created_at: '2026-08-10T02:00:00Z',
    model: 'claude-sonnet-5',
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 1_000_000, // 200 * 1.25 = 250
    cache_read_input_tokens: 1_000_000, // 200 * 0.1 = 20
  })
  assert.equal(cents, 270)
})

test('estimateCostCents prices deepseek-v4-flash at $0.14/$0.28 per MTok', () => {
  // 1M in + 1M out = 14 + 28 fractional cents.
  const cents = estimateCostCents({
    created_at: '2026-08-12T02:00:00Z',
    model: 'deepseek-v4-flash',
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  })
  assert.equal(cents, 42)
})

test('estimateCostCents prices deepseek cache reads at 0.02x with no write surcharge', () => {
  const cents = estimateCostCents({
    created_at: '2026-08-12T02:00:00Z',
    model: 'deepseek-v4-flash',
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 1_000_000, // 14 * 1.0 = 14
    cache_read_input_tokens: 1_000_000, // 14 * 0.02 = 0.28
  })
  assert.equal(cents, 14.28)
})

test('estimateCostCents prices the selective deepseek-v4-pro fallback', () => {
  const cents = estimateCostCents({
    created_at: '2026-08-17T02:00:00Z',
    model: 'deepseek-v4-pro',
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 1_000_000,
  })
  // $0.435 input + $0.87 output + $0.003625 cached input = $1.308625.
  assert.equal(cents, 130.8625)
})

test('estimateCostCents returns 0 for an unknown model instead of crashing', () => {
  const cents = estimateCostCents({
    created_at: '2026-08-10T02:00:00Z',
    model: 'some-future-model',
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  })
  assert.equal(cents, 0)
})

test('sgtDateOf buckets UTC instants into Singapore days', () => {
  // 17:00 UTC is already 01:00 the NEXT day in SGT (+8).
  assert.equal(sgtDateOf('2026-08-04T17:00:00Z'), '2026-08-05')
  assert.equal(sgtDateOf('2026-08-04T15:59:00Z'), '2026-08-04')
})

test('dailyTotals sums per SGT day, newest first', () => {
  const base = {
    model: 'claude-sonnet-5',
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
  const totals = dailyTotals([
    { ...base, created_at: '2026-08-04T10:00:00Z', input_tokens: 100, output_tokens: 10 },
    // 17:30 UTC = next SGT day
    { ...base, created_at: '2026-08-04T17:30:00Z', input_tokens: 200, output_tokens: 20 },
    { ...base, created_at: '2026-08-05T01:00:00Z', input_tokens: 300, output_tokens: 30 },
  ])
  assert.equal(totals.length, 2)
  assert.equal(totals[0].date, '2026-08-05')
  assert.equal(totals[0].calls, 2)
  assert.equal(totals[0].inputTokens, 500)
  assert.equal(totals[0].outputTokens, 50)
  assert.equal(totals[1].date, '2026-08-04')
  assert.equal(totals[1].calls, 1)
})

test('totalCostCents sums estimated cost across rows', () => {
  const rows = [
    {
      created_at: '2026-08-10T02:00:00Z',
      model: 'claude-sonnet-5',
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    {
      created_at: '2026-08-10T03:00:00Z',
      model: 'claude-sonnet-5',
      input_tokens: 0,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  ]
  assert.equal(totalCostCents(rows), 1200)
})

test('p95LatencyMs uses nearest rank and survives edge cases', () => {
  assert.equal(p95LatencyMs([]), null)
  assert.equal(p95LatencyMs([{ latency_ms: 100 }]), 100)
  // 10 values 10..100: ceil(10 * 0.95) = 10 -> the 10th value.
  const ten = Array.from({ length: 10 }, (_, i) => ({ latency_ms: (i + 1) * 10 }))
  assert.equal(p95LatencyMs(ten), 100)
  // 20 values 100..2000: ceil(20 * 0.95) = 19 -> the 19th value.
  const twenty = Array.from({ length: 20 }, (_, i) => ({ latency_ms: (i + 1) * 100 }))
  assert.equal(p95LatencyMs(twenty), 1900)
})
