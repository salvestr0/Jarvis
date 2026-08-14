import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ACTION_TOOLS, claimsAction, ranActionTool } from './action-claim.ts'
import { TOOL_SCHEMAS } from './jarvis/tool-schemas.ts'

// --- claim detection --------------------------------------------------------

test('catches the 14 Aug S$81 fabrication', () => {
  assert.equal(
    claimsAction(
      "Logged: S$81.00 Food — Vanessa's & Aaron birthday cake + tiramisu, today 14 Aug."
    ),
    true
  )
})

test('catches the 14 Aug food/sports fabrication', () => {
  assert.equal(
    claimsAction(
      'Logged today (14 Aug):\n- Food 5.70 (PayLah, Jiang Quan)\n' +
        "- Sports 2.50 (MyActiveSG Plus) — guess on category, say if it's something else"
    ),
    true
  )
})

test('catches confirmation openers', () => {
  assert.equal(claimsAction('Saved. Anything else?'), true)
  assert.equal(claimsAction('Done — reminder set for 9am.'), true)
  assert.equal(claimsAction('Cancelled the weekly review.'), true)
})

test('catches claims on a later line of a multi-line reply', () => {
  assert.equal(claimsAction('Here you go.\nLogged: S$5.00 Transport.'), true)
})

test('catches first-person and passive claims mid-sentence', () => {
  assert.equal(claimsAction("Sure — I've logged the S$12 lunch."), true)
  assert.equal(claimsAction('I just created the task for tomorrow.'), true)
  assert.equal(claimsAction('That expense has been recorded.'), true)
})

test('ignores plain answers with no action claim', () => {
  assert.equal(claimsAction('You spent S$351.08 on food this month.'), false)
  assert.equal(claimsAction('BTC is at $64,737 right now.'), false)
  assert.equal(
    claimsAction('Want me to log that as Food or as a transfer?'),
    false
  )
})

test('ignores future-tense promises (the prompt rule covers those)', () => {
  assert.equal(claimsAction('I will log it once you confirm the amount.'), false)
})

test('ignores the empty reply', () => {
  assert.equal(claimsAction(''), false)
})

// --- action-vs-read classification -----------------------------------------

test('reads alone do not count as acting — the 14 Aug miss', () => {
  // The real turn: two email searches and a fetch, then a "Logged today" claim.
  assert.equal(ranActionTool(['search_email', 'search_email', 'get_email']), false)
})

test('a write among reads counts as acting', () => {
  assert.equal(ranActionTool(['search_email', 'log_transaction']), true)
})

test('no tools at all does not count as acting', () => {
  assert.equal(ranActionTool([]), false)
})

test('side-effecting non-DB tools count as acting', () => {
  assert.equal(ranActionTool(['spotify_play']), true)
  assert.equal(ranActionTool(['pc_run_action']), true)
  assert.equal(ranActionTool(['create_email_draft']), true)
})

test('read-only tools are never actions', () => {
  for (const name of [
    'get_month_summary',
    'get_month_transactions',
    'list_reminders',
    'list_content_ideas',
    'pc_read_file',
    'spotify_now_playing',
    'web_search',
  ]) {
    assert.equal(ACTION_TOOLS.has(name), false, `${name} must not be an action`)
  }
})

test('every tool Jarvis has is classified, and every classified tool exists', () => {
  // Keeps ACTION_TOOLS honest as tools are added. An unclassified write would
  // silently let fabrications through; a stale name would be dead weight.
  const readPrefixes = ['get_', 'list_', 'search_']
  const knownReads = new Set([...readPrefixes.flatMap(() => []), 'web_search'])

  const unclassified = TOOL_SCHEMAS.map((t) => t.name).filter((name) => {
    if (ACTION_TOOLS.has(name)) return false
    const looksRead =
      readPrefixes.some((p) => name.startsWith(p)) ||
      knownReads.has(name) ||
      name === 'spotify_now_playing' ||
      name === 'pc_list_dir' ||
      name === 'pc_read_file' ||
      name === 'pc_search_files' ||
      name === 'pc_job_status'
    return !looksRead
  })
  assert.deepEqual(
    unclassified,
    [],
    `these tools are neither in ACTION_TOOLS nor recognisably read-only: ${unclassified.join(', ')}`
  )

  const schemaNames = new Set(TOOL_SCHEMAS.map((t) => t.name))
  const stale = [...ACTION_TOOLS].filter((name) => !schemaNames.has(name))
  assert.deepEqual(stale, [], `ACTION_TOOLS names no longer in TOOL_SCHEMAS: ${stale.join(', ')}`)
})
