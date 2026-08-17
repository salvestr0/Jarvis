import assert from 'node:assert/strict'
import { test } from 'node:test'

import { actionReceiptFromResult, formatActionReceipts } from './action-receipt.ts'

test('builds an exact transaction confirmation from the database result', () => {
  const receipt = actionReceiptFromResult(
    'log_transaction',
    { amount: '5.70', category: 'Food', note: 'Lunch' },
    JSON.stringify({
      logged: {
        date: '2026-08-17',
        direction: 'expense',
        amount: { cents: 570, display: 'S$5.70' },
        category: 'Food',
        note: 'Lunch',
      },
    }),
    false
  )
  assert.ok(receipt)
  assert.equal(
    formatActionReceipts([receipt]),
    'Logged: S$5.70 · Food — Lunch (2026-08-17).'
  )
})

test('one successful action cannot hide another failed action', () => {
  const success = actionReceiptFromResult(
    'create_task',
    { title: 'Submit form' },
    JSON.stringify({ created: { title: 'Submit form', priority: 'medium' } }),
    false
  )
  const failure = actionReceiptFromResult(
    'log_transaction',
    { amount: 'five-ish' },
    'amount must be a number with at most 2 decimal places.',
    true
  )
  assert.ok(success)
  assert.ok(failure)
  const result = formatActionReceipts([success, failure])
  assert.match(result, /Task created: Submit form\./)
  assert.match(result, /Couldn’t complete log transaction: amount must be/)
})

test('handled no-ops are failures, not action confirmations', () => {
  const spotify = actionReceiptFromResult(
    'spotify_play',
    { query: 'song that does not exist' },
    JSON.stringify({ found: false, note: 'No track matched that query.' }),
    false
  )
  assert.ok(spotify)
  assert.equal(spotify.outcome, 'failed')
  assert.equal(
    formatActionReceipts([spotify]),
    'Couldn’t complete spotify play: No track matched that query.'
  )
})

test('read-only tools never create action receipts', () => {
  assert.equal(
    actionReceiptFromResult('search_email', { query: 'bank' }, '{"results":[]}', false),
    null
  )
})

test('pending PC jobs are reported as pending rather than completed', () => {
  const receipt = actionReceiptFromResult(
    'pc_run_action',
    { action: 'screenshot' },
    JSON.stringify({ job_id: 'abc', status: 'still_running' }),
    false
  )
  assert.ok(receipt)
  assert.equal(receipt.outcome, 'pending')
  assert.equal(formatActionReceipts([receipt]), 'Still working on pc run action (job abc).')
})

test('email receipts explicitly say drafts were not sent', () => {
  const receipt = actionReceiptFromResult(
    'create_email_draft',
    { to: 'hr@example.com', subject: 'Leave request', body: 'Hello' },
    JSON.stringify({ draft_created: true, draft_id: 'draft-1' }),
    false
  )
  assert.ok(receipt)
  assert.equal(
    formatActionReceipts([receipt]),
    'Gmail draft created: “Leave request” to hr@example.com. It has not been sent.'
  )
})
