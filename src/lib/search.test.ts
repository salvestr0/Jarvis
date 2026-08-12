import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatSearchResults } from './search.ts'

test('formatSearchResults strips HTML from titles and snippets', () => {
  const out = JSON.parse(
    formatSearchResults({
      web: {
        results: [
          {
            title: 'Bitcoin &amp; the <strong>halving</strong>',
            url: 'https://example.com/btc',
            description: 'BTC is at <strong>$64,737</strong> today&nbsp;&#x27;live&#x27;',
          },
        ],
      },
    })
  )
  assert.equal(out.results.length, 1)
  assert.equal(out.results[0].title, 'Bitcoin & the halving')
  assert.equal(out.results[0].url, 'https://example.com/btc')
  assert.equal(out.results[0].description, "BTC is at $64,737 today 'live'")
})

test('formatSearchResults caps at five results', () => {
  const results = Array.from({ length: 9 }, (_, i) => ({
    title: `r${i}`,
    url: `https://example.com/${i}`,
    description: '',
  }))
  const out = JSON.parse(formatSearchResults({ web: { results } }))
  assert.equal(out.results.length, 5)
})

test('formatSearchResults drops malformed entries instead of crashing', () => {
  const out = JSON.parse(
    formatSearchResults({
      web: {
        results: [
          null,
          { url: 'https://example.com/no-title' },
          { title: 'no url' },
          { title: 'ok', url: 'https://example.com/ok' },
        ],
      },
    })
  )
  assert.equal(out.results.length, 1)
  assert.equal(out.results[0].title, 'ok')
  assert.equal(out.results[0].description, '')
})

test('formatSearchResults says so when there is nothing', () => {
  for (const raw of [{}, { web: {} }, { web: { results: [] } }, null]) {
    const out = JSON.parse(formatSearchResults(raw))
    assert.deepEqual(out.results, [])
    assert.ok(out.note.includes('No results'))
  }
})
