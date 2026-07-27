import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseUpdate } from './update.ts'

function validUpdate(overrides: Record<string, unknown> = {}) {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      date: 1753600000,
      chat: { id: 12345, type: 'private' },
      from: { id: 12345, is_bot: false, first_name: 'Jayden' },
      text: 'what is my net worth?',
      ...overrides,
    },
  }
}

test('accepts a plain private text message', () => {
  const parsed = parseUpdate(validUpdate())
  assert.deepEqual(parsed, {
    chatId: 12345,
    fromId: 12345,
    text: 'what is my net worth?',
  })
})

test('trims surrounding whitespace from the text', () => {
  const parsed = parseUpdate(validUpdate({ text: '  log $12 lunch \n' }))
  assert.equal(parsed?.text, 'log $12 lunch')
})

test('rejects group and channel chats — replies must stay private', () => {
  for (const type of ['group', 'supergroup', 'channel']) {
    const update = validUpdate({ chat: { id: -100200300, type } })
    assert.equal(parseUpdate(update), null, `should reject chat type ${type}`)
  }
})

test('rejects edited messages — answering them would double-log', () => {
  const update = validUpdate()
  const edited = { update_id: 2, edited_message: update.message }
  assert.equal(parseUpdate(edited), null)
})

test('rejects non-text messages (photos, stickers)', () => {
  assert.equal(parseUpdate(validUpdate({ text: undefined })), null)
})

test('rejects empty and whitespace-only text', () => {
  assert.equal(parseUpdate(validUpdate({ text: '   ' })), null)
})

test('rejects malformed bodies instead of throwing', () => {
  assert.equal(parseUpdate(null), null)
  assert.equal(parseUpdate('not json'), null)
  assert.equal(parseUpdate({}), null)
  assert.equal(parseUpdate({ message: { text: 'hi' } }), null) // no chat/from
  assert.equal(
    parseUpdate(validUpdate({ from: { id: 'not-a-number' } })),
    null
  )
})
