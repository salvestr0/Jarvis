import assert from 'node:assert/strict'
import { test } from 'node:test'

import { TELEGRAM_MESSAGE_LIMIT, chunkTelegramMessage } from './format.ts'

test('short text arrives as a single chunk', () => {
  assert.deepEqual(chunkTelegramMessage('hello'), ['hello'])
})

test('empty and whitespace-only text produce no chunks', () => {
  assert.deepEqual(chunkTelegramMessage(''), [])
  assert.deepEqual(chunkTelegramMessage('  \n '), [])
})

test('long text splits on a newline boundary, not mid-line', () => {
  const line = 'x'.repeat(100)
  const text = Array.from({ length: 50 }, () => line).join('\n') // ~5050 chars
  const chunks = chunkTelegramMessage(text)

  assert.equal(chunks.length, 2)
  for (const chunk of chunks) {
    assert.ok(chunk.length <= TELEGRAM_MESSAGE_LIMIT)
    // Every chunk is whole lines — no line was cut in half.
    for (const l of chunk.split('\n')) assert.equal(l, line)
  }
  // Nothing lost in the split.
  assert.equal(chunks.join('\n'), text)
})

test('pathological text with no newlines hard-splits at the limit', () => {
  const text = 'a'.repeat(TELEGRAM_MESSAGE_LIMIT + 100)
  const chunks = chunkTelegramMessage(text)

  assert.equal(chunks.length, 2)
  assert.equal(chunks[0].length, TELEGRAM_MESSAGE_LIMIT)
  assert.equal(chunks[1].length, 100)
  assert.equal(chunks.join(''), text)
})

test('hard cut never splits a surrogate pair', () => {
  // 💰 is two UTF-16 units; with limit 5, a naive cut at 5 would slice it.
  const text = 'aaaa💰bbbb'
  const chunks = chunkTelegramMessage(text, 5)

  for (const chunk of chunks) {
    assert.ok(chunk.length <= 5)
    // No chunk may hold half an emoji — Telegram 400s lone surrogates.
    assert.ok(chunk.isWellFormed(), `lone surrogate in ${JSON.stringify(chunk)}`)
  }
  assert.equal(chunks.join(''), text)
})

test('never returns an empty chunk', () => {
  const text = 'a'.repeat(50) + '\n'.repeat(5) + 'b'.repeat(50)
  for (const chunk of chunkTelegramMessage(text, 55)) {
    assert.ok(chunk.length > 0)
  }
})
