import assert from 'node:assert/strict'
import { test } from 'node:test'

import { TOOL_SCHEMAS } from './tool-schemas.ts'
import {
  CORE_TOOL_NAMES,
  forcedToolNameForRequest,
  isExplicitToolRequest,
  selectToolsForTurn,
  TOOL_GROUPS,
} from './tool-routing.ts'

function names(text: string, history: string[] = []): string[] {
  return selectToolsForTurn(text, history).tools.map((tool) => tool.name)
}

test('every Jarvis tool belongs to exactly one routed group or the core', () => {
  const classified = [
    ...CORE_TOOL_NAMES,
    ...Object.values(TOOL_GROUPS).flat(),
  ]
  assert.equal(new Set(classified).size, classified.length, 'a tool is in multiple groups')
  assert.deepEqual(
    [...classified].sort(),
    TOOL_SCHEMAS.map((tool) => tool.name).sort()
  )
})

test('plain conversation receives only the three cross-domain tools', () => {
  assert.deepEqual(names('How are you?'), ['web_search', 'remember', 'forget'])
})

test('simple expense request sees finance tools, not the entire product', () => {
  const selected = names('Log S$5.70 for lunch as Food')
  assert.ok(selected.includes('log_transaction'))
  assert.ok(selected.includes('get_month_summary'))
  assert.ok(!selected.includes('create_task'))
  assert.ok(!selected.includes('create_calendar_event'))
  assert.ok(selected.length <= 13)
  assert.ok(names('Log 5.70 lunch').includes('log_transaction'))
})

test('common domains route to their expected action tools', () => {
  const cases: Array<[string, string]> = [
    ['Remind me tomorrow at 9am to call the bank', 'create_reminder'],
    ['Create a task to submit the SingSaver form', 'create_task'],
    ['Draft an email to HR about leave', 'create_email_draft'],
    ['Play my Deep Focus playlist on Spotify', 'spotify_play'],
    ['Save this as a content idea', 'save_content_idea'],
    ['Take a screenshot of my PC', 'pc_run_action'],
    ['Set a BTC price alert below 80000', 'create_price_alert'],
    ['Record Koda MRR as S$100', 'record_project_metric'],
  ]

  for (const [prompt, expected] of cases) {
    assert.ok(names(prompt).includes(expected), `${prompt} should include ${expected}`)
  }
})

test('multi-domain requests receive both small tool groups', () => {
  const selected = names('Check my Gmail for the bank receipt and log the S$12 expense')
  assert.ok(selected.includes('search_email'))
  assert.ok(selected.includes('get_email'))
  assert.ok(selected.includes('log_transaction'))
  assert.ok(!selected.includes('spotify_play'))

  const retry = names('try again', [
    "Log today's spending, see my email.",
    "I found the charges, but I couldn't save them to the tracker.",
  ])
  assert.ok(retry.includes('search_email'))
  assert.ok(retry.includes('log_transaction'))
})

test('short confirmation inherits the immediately preceding domain', () => {
  const selected = names('Yes, do it', [
    'Delete the task about the expired application',
    'That will permanently delete the task. Confirm?',
  ])
  assert.ok(selected.includes('get_tasks'))
  assert.ok(selected.includes('delete_task'))
  assert.ok(!selected.includes('delete_transaction'))

  const transactionConfirmation = names('confirm', [
    'Remove the Kim Sing Chicken Rice transaction.',
    'I will permanently delete the S$4.50 Food transaction. Confirm?',
  ])
  assert.ok(transactionConfirmation.includes('get_month_transactions'))
  assert.ok(transactionConfirmation.includes('delete_transaction'))
})

test('only explicit non-destructive commands force a first-round tool call', () => {
  assert.equal(isExplicitToolRequest('Log S$5.70 for lunch'), true)
  assert.equal(isExplicitToolRequest('Could you create a task for tomorrow?'), true)
  assert.equal(isExplicitToolRequest('Did I log lunch already?'), false)
  assert.equal(isExplicitToolRequest('Should I delete this task?'), false)
  assert.equal(isExplicitToolRequest('Delete this task'), false)
})

test('confirmed destructive follow-up forces the action tool', () => {
  assert.equal(
    isExplicitToolRequest('yes', [
      'Delete the old task',
      'This permanently deletes it. Are you sure?',
    ]),
    true
  )
  assert.equal(
    isExplicitToolRequest('confirm', [
      'Remove the Kim Sing Chicken Rice transaction.',
      'I will permanently delete it. Confirm?',
    ]),
    true
  )
  assert.equal(
    forcedToolNameForRequest('confirm', [
      'Remove the Kim Sing Chicken Rice transaction.',
      'I will permanently delete the S$4.50 Food transaction. Confirm?',
    ]),
    'get_month_transactions'
  )
})

test('exact forcing is limited to requests with enough identifying detail', () => {
  assert.equal(forcedToolNameForRequest('Log S$5.70 for lunch as Food'), 'log_transaction')
  assert.equal(forcedToolNameForRequest('Create a task to submit the form'), 'create_task')
  assert.equal(forcedToolNameForRequest('Remind me tomorrow at 9am to call the bank'), 'create_reminder')
  assert.equal(forcedToolNameForRequest('Play Deep Focus on Spotify'), 'spotify_play')
  assert.equal(forcedToolNameForRequest('Take a screenshot'), 'pc_run_action')
  assert.equal(
    forcedToolNameForRequest("Log today's spending, see my email"),
    'search_email'
  )
  assert.equal(
    forcedToolNameForRequest('try again', [
      "Log today's spending, see my email.",
      "I found the charges, but I couldn't save them to the tracker.",
    ]),
    'search_email'
  )
  assert.equal(forcedToolNameForRequest('Log lunch'), null)
  assert.equal(forcedToolNameForRequest('Create a task'), null)
  assert.equal(forcedToolNameForRequest('Should I log S$5.70 for lunch?'), null)
  assert.equal(forcedToolNameForRequest('Delete this task'), null)
})

test('every exact forced tool is present in that request’s routed surface', () => {
  for (const prompt of [
    'Log S$5.70 for lunch as Food',
    'Create a task to submit the form',
    'Remind me tomorrow at 9am to call the bank',
    'Remember that I prefer short answers',
    'Save this thought as a content idea',
    'Play Deep Focus on Spotify',
    'Pause the music',
    'Take a screenshot',
    'Open Spotify',
    'Set a BTC price alert below $80000',
  ]) {
    const forced = forcedToolNameForRequest(prompt)
    assert.ok(forced, `${prompt} should force a tool`)
    assert.ok(names(prompt).includes(forced), `${forced} must be offered for: ${prompt}`)
  }
})
