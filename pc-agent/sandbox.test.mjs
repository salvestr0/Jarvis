import assert from 'node:assert/strict'
import { test } from 'node:test'

import { deniedSegment, isInside, resolveRequest, shouldSkipDir } from './sandbox.mjs'

const ROOTS = {
  Desktop: 'C:\\Users\\User\\OneDrive\\Desktop',
  Documents: 'C:\\Users\\User\\OneDrive\\Documents',
  Downloads: 'C:\\Users\\User\\Downloads',
}

test('alias resolves case-insensitively with either slash', () => {
  assert.equal(
    resolveRequest('desktop/projects', ROOTS),
    'C:\\Users\\User\\OneDrive\\Desktop\\projects'
  )
  assert.equal(
    resolveRequest('Downloads\\setup.exe', ROOTS),
    'C:\\Users\\User\\Downloads\\setup.exe'
  )
  assert.equal(resolveRequest('Documents', ROOTS), ROOTS.Documents)
})

test('absolute paths pass through, unknown relative paths do not resolve', () => {
  assert.equal(resolveRequest('C:\\temp\\x.txt', ROOTS), 'C:\\temp\\x.txt')
  assert.equal(resolveRequest('projects/notes.md', ROOTS), null)
})

test('alias traversal cannot climb out of the root', () => {
  // normalize collapses the ..; containment then rejects the result.
  const resolved = resolveRequest('Desktop\\..\\..\\.ssh', ROOTS)
  assert.ok(!isInside(ROOTS.Desktop, resolved))
})

test('containment is boundary-aware and case-insensitive', () => {
  assert.ok(isInside(ROOTS.Desktop, 'c:\\users\\user\\onedrive\\desktop\\a\\b.txt'))
  assert.ok(isInside(ROOTS.Desktop, ROOTS.Desktop))
  // Sibling that shares the prefix as a string but not as a directory.
  assert.ok(!isInside(ROOTS.Desktop, 'C:\\Users\\User\\OneDrive\\DesktopEvil\\x'))
  assert.ok(!isInside(ROOTS.Desktop, 'C:\\Users\\User\\OneDrive'))
})

test('deny-list catches secret-shaped names anywhere in the path', () => {
  assert.equal(deniedSegment('C:\\x\\.env.local'), '.env.local')
  assert.equal(deniedSegment('C:\\x\\server.pem'), 'server.pem')
  assert.equal(deniedSegment('C:\\x\\id_rsa'), 'id_rsa')
  assert.equal(deniedSegment('C:\\x\\my-secrets\\notes.txt'), 'my-secrets')
  assert.equal(deniedSegment('C:\\x\\wallet-backup\\a.txt'), 'wallet-backup')
  assert.equal(deniedSegment('C:\\x\\seed phrase.txt'), 'seed phrase.txt')
  assert.equal(deniedSegment('C:\\x\\api_tokens.json'), 'api_tokens.json')
})

test('deny-list leaves ordinary files alone, including drive letters', () => {
  assert.equal(deniedSegment('C:\\Users\\User\\Downloads\\report.pdf'), null)
  assert.equal(deniedSegment('C:\\x\\envelope-design.png'), null)
})

test('search skips bulk directories case-insensitively', () => {
  assert.ok(shouldSkipDir('node_modules'))
  assert.ok(shouldSkipDir('.Git'))
  assert.ok(shouldSkipDir('$Recycle.Bin'))
  assert.ok(!shouldSkipDir('src'))
})
