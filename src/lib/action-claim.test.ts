import assert from 'node:assert/strict'
import { test } from 'node:test'

import { claimsAction } from './action-claim.ts'

test('catches the real 14 Aug fabrication', () => {
  assert.equal(
    claimsAction(
      "Logged: S$81.00 Food — Vanessa's & Aaron birthday cake + tiramisu, today 14 Aug."
    ),
    true
  )
})

test('catches the original ad29bb4-style fabrication', () => {
  assert.equal(
    claimsAction('Logged today:\n- Food 5.70\n- Sports 2.50\nAll captured.'),
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

test('ignores future-tense promises (those are handled by the prompt rule)', () => {
  assert.equal(claimsAction('I will log it once you confirm the amount.'), false)
})

test('ignores the empty reply', () => {
  assert.equal(claimsAction(''), false)
})
