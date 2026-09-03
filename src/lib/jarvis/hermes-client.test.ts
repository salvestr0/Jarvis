import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runHermesAgent } from './hermes-client.ts'

const settings = {
  serviceUrl: 'https://jarvis-agent.example/ignored',
  secret: 's'.repeat(32),
}

const input = {
  text: 'log lunch',
  telegramUpdateId: 42,
  history: [{ role: 'user' as const, content: 'hello' }],
}

test('calls only the fixed Hermes run endpoint with bounded external state', async () => {
  let captured: { url?: string; init?: RequestInit } = {}
  const response = await runHermesAgent(input, settings, async (url, init) => {
    captured = { url: String(url), init }
    return Response.json({ ok: true, response: 'Logged.' })
  })

  assert.equal(response, 'Logged.')
  assert.equal(captured.url, 'https://jarvis-agent.example/run')
  assert.equal(captured.init?.method, 'POST')
  assert.equal(
    (captured.init?.headers as Record<string, string>).authorization,
    `Bearer ${'s'.repeat(32)}`
  )
  assert.deepEqual(JSON.parse(String(captured.init?.body)), {
    text: 'log lunch',
    telegram_update_id: 42,
    history: [{ role: 'user', content: 'hello' }],
  })
})

test('does not leak an agent response body when the service fails', async () => {
  await assert.rejects(
    runHermesAgent(input, settings, async () =>
      Response.json({ token: 'must-not-leak' }, { status: 502 })
    ),
    (error: unknown) => {
      assert.match(String(error), /status 502/i)
      assert.doesNotMatch(String(error), /must-not-leak/i)
      return true
    }
  )
})

test('requires an HTTPS service URL and a long shared secret', async () => {
  await assert.rejects(
    runHermesAgent(input, { ...settings, serviceUrl: 'http://agent.example' }),
    /HTTPS/i
  )
  await assert.rejects(
    runHermesAgent(input, { ...settings, secret: 'short' }),
    /secret/i
  )
})
