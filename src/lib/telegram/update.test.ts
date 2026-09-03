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
    updateId: 1,
    chatId: 12345,
    fromId: 12345,
    kind: 'text',
    text: 'what is my net worth?',
  })
})

test('trims surrounding whitespace from the text', () => {
  const parsed = parseUpdate(validUpdate({ text: '  log $12 lunch \n' }))
  assert.equal(parsed?.kind === 'text' && parsed.text, 'log $12 lunch')
})

test('accepts a voice note and carries its file id and duration', () => {
  const parsed = parseUpdate(
    validUpdate({
      text: undefined,
      voice: { file_id: 'AwACAgU', duration: 7, mime_type: 'audio/ogg' },
    })
  )
  assert.deepEqual(parsed, {
    updateId: 1,
    chatId: 12345,
    fromId: 12345,
    kind: 'voice',
    fileId: 'AwACAgU',
    duration: 7,
  })
})

test('a voice note without a file id is not usable', () => {
  assert.equal(
    parseUpdate(validUpdate({ text: undefined, voice: { duration: 7 } })),
    null
  )
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

test('rejects non-text, non-voice messages (photos, stickers)', () => {
  assert.equal(parseUpdate(validUpdate({ text: undefined })), null)
  assert.equal(
    parseUpdate(validUpdate({ text: undefined, sticker: { file_id: 'x' } })),
    null
  )
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

test('rejects updates without a numeric update id', () => {
  const missing = validUpdate()
  delete (missing as { update_id?: number }).update_id
  assert.equal(parseUpdate(missing), null)
  assert.equal(parseUpdate({ ...validUpdate(), update_id: '1' }), null)
})
