import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildRawMessage,
  decodeBase64Url,
  extractPlainText,
  type MimePart,
} from './mime.ts'

function b64url(text: string): string {
  return Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

test('decodes base64url including - and _ characters', () => {
  // '~~~?>>' encodes with characters that differ between base64 and base64url.
  const tricky = '~~~?>>ÿ'
  assert.equal(decodeBase64Url(b64url(tricky)), tricky)
})

test('single-part text/plain body', () => {
  const payload: MimePart = {
    mimeType: 'text/plain',
    body: { data: b64url('Hello Jayden,\nyour invoice is attached.') },
  }
  assert.equal(extractPlainText(payload), 'Hello Jayden,\nyour invoice is attached.')
})

test('nested multipart prefers text/plain over text/html', () => {
  const payload: MimePart = {
    mimeType: 'multipart/mixed',
    parts: [
      {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: b64url('plain wins') } },
          { mimeType: 'text/html', body: { data: b64url('<b>html loses</b>') } },
        ],
      },
      { mimeType: 'application/pdf', body: { data: 'ignored' } },
    ],
  }
  assert.equal(extractPlainText(payload), 'plain wins')
})

test('falls back to tag-stripped html when there is no text/plain', () => {
  const payload: MimePart = {
    mimeType: 'text/html',
    body: {
      data: b64url(
        '<html><style>.x{color:red}</style><body><p>Your OTP is <b>123456</b> &amp; expires soon.</p></body></html>'
      ),
    },
  }
  const text = extractPlainText(payload)
  assert.ok(text.includes('Your OTP is 123456'))
  assert.ok(text.includes('& expires soon.'))
  assert.ok(!text.includes('<'))
  assert.ok(!text.includes('color:red'))
})

test('empty and bodiless payloads return empty string, not a crash', () => {
  assert.equal(extractPlainText(undefined), '')
  assert.equal(extractPlainText({}), '')
  assert.equal(
    extractPlainText({ mimeType: 'multipart/mixed', parts: [] }),
    ''
  )
})

test('buildRawMessage produces headers and a decodable body', () => {
  const raw = buildRawMessage('alice@example.com', 'Hello', 'Hi Alice,\nsee you soon.')
  const decoded = decodeBase64Url(raw)
  assert.ok(decoded.startsWith('To: alice@example.com\r\n'))
  assert.ok(decoded.includes('Subject: Hello\r\n'))
  const bodyB64 = decoded.split('\r\n\r\n')[1]
  assert.equal(
    Buffer.from(bodyB64, 'base64').toString('utf8'),
    'Hi Alice,\nsee you soon.'
  )
})

test('buildRawMessage encodes non-ASCII subjects as an RFC 2047 word', () => {
  const raw = buildRawMessage('a@b.co', 'Café ☕', 'x')
  const decoded = decodeBase64Url(raw)
  const subject = decoded.split('\r\n').find((l) => l.startsWith('Subject: '))
  assert.ok(subject !== undefined)
  assert.ok(subject.startsWith('Subject: =?UTF-8?B?'))
  assert.equal(
    Buffer.from(subject.slice('Subject: =?UTF-8?B?'.length, -2), 'base64').toString('utf8'),
    'Café ☕'
  )
})

test('buildRawMessage rejects header injection via to or subject', () => {
  assert.throws(() => buildRawMessage('a@b.co\r\nBcc: evil@x.co', 's', 'b'))
  assert.throws(() => buildRawMessage('a@b.co', 'hi\nX-Evil: 1', 'b'))
})
