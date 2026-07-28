import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveAction, validateActions } from './actions.mjs'
import { Refusal } from './executors.mjs'

const ACTIONS = {
  screenshot: { builtin: 'screenshot', needs_confirm: false },
  lock_screen: { argv: ['rundll32.exe', 'user32.dll,LockWorkStation'], needs_confirm: false },
  open_app: {
    needs_confirm: false,
    variants: { notepad: ['notepad.exe'], chrome: ['C:\\chrome.exe'] },
  },
  wipe_stuff: { argv: ['wipe.exe'], needs_confirm: true },
}

test('resolves plain argv and builtin actions', () => {
  assert.deepEqual(resolveAction(ACTIONS, { action: 'lock_screen' }), {
    name: 'lock_screen',
    argv: ['rundll32.exe', 'user32.dll,LockWorkStation'],
  })
  assert.deepEqual(resolveAction(ACTIONS, { action: 'screenshot' }), {
    name: 'screenshot',
    builtin: 'screenshot',
  })
})

test('variant actions require a known arg, case-insensitively', () => {
  assert.deepEqual(resolveAction(ACTIONS, { action: 'open_app', arg: 'Notepad' }), {
    name: 'open_app',
    argv: ['notepad.exe'],
  })
  assert.throws(() => resolveAction(ACTIONS, { action: 'open_app' }), Refusal)
  assert.throws(() => resolveAction(ACTIONS, { action: 'open_app', arg: 'vscode' }), /notepad, chrome/)
})

test('unknown action is refused and lists what exists', () => {
  assert.throws(() => resolveAction(ACTIONS, { action: 'format_disk' }), Refusal)
  assert.throws(
    () => resolveAction(ACTIONS, { action: 'format_disk' }),
    /screenshot, lock_screen, open_app, wipe_stuff/
  )
  assert.throws(() => resolveAction(ACTIONS, {}), Refusal)
})

test('needs_confirm gates without confirmed: true, passes with it', () => {
  assert.throws(() => resolveAction(ACTIONS, { action: 'wipe_stuff' }), /confirmation/)
  assert.throws(
    () => resolveAction(ACTIONS, { action: 'wipe_stuff', confirmed: 'yes' }),
    Refusal
  )
  assert.deepEqual(resolveAction(ACTIONS, { action: 'wipe_stuff', confirmed: true }), {
    name: 'wipe_stuff',
    argv: ['wipe.exe'],
  })
})

test('validateActions rejects malformed argv shapes', () => {
  assert.throws(() => validateActions({ bad: { argv: 'notepad.exe' } }))
  assert.throws(() => validateActions({ bad: { argv: [] } }))
  assert.throws(() => validateActions({ bad: { needs_confirm: false } }))
  assert.throws(() => validateActions({ bad: { variants: { x: ['ok'], y: [42] } } }))
  assert.equal(validateActions(ACTIONS), ACTIONS)
})
