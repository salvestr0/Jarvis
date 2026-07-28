/**
 * Path policy for the PC agent — the security boundary of tier 1.
 *
 * Pure logic only (no fs): resolving aliases, containment checks, and the
 * secrets deny-list. agent/executors feed it already-realpath'd strings.
 * Dependency-free so `node --test` exercises every edge.
 */

import path from 'node:path'

/**
 * "Desktop", "Desktop\projects", "Documents/tax" → absolute path under the
 * matching root. Absolute paths pass through untouched. Returns null for a
 * relative path that names no alias — there is no implicit working dir.
 */
export function resolveRequest(requested, roots) {
  const trimmed = requested.trim()
  if (path.win32.isAbsolute(trimmed)) return path.win32.normalize(trimmed)

  const [head, ...rest] = trimmed.split(/[\\/]+/)
  const root = Object.entries(roots).find(
    ([alias]) => alias.toLowerCase() === head.toLowerCase()
  )
  if (!root) return null
  return path.win32.normalize(path.win32.join(root[1], ...rest))
}

/**
 * Containment: is `candidate` the root itself or strictly inside it?
 * Both arguments must already be canonical (realpath'd) absolute paths —
 * comparing pre-realpath strings would let junctions escape. Windows paths
 * compare case-insensitively.
 */
export function isInside(rootReal, candidateReal) {
  const root = path.win32.normalize(rootReal).toLowerCase().replace(/[\\/]+$/, '')
  const cand = path.win32.normalize(candidateReal).toLowerCase().replace(/[\\/]+$/, '')
  return cand === root || cand.startsWith(root + path.win32.sep)
}

/**
 * Secrets deny-list, applied to EVERY segment of the path — a denied folder
 * name blocks everything under it. Substring rules are deliberately blunt
 * (tokenizer.py gets refused): refusals are visible and false positives are
 * cheap; a leaked key is not.
 */
const DENY_SEGMENT = [
  /^\.env/i, // .env, .env.local, …
  /\.(pem|key|pfx|p12|kdbx|ppk|crt|asc|gpg)$/i,
  /^id_(rsa|ed25519|ecdsa|dsa)/i,
  /secret/i,
  /token/i,
  /password/i,
  /credential/i,
  /^wallet/i,
  /seed[-_ ]?phrase/i,
  /private[-_ ]?key/i,
]

/** First denied segment of an absolute path, or null if the path is clean. */
export function deniedSegment(absPath) {
  for (const segment of path.win32.normalize(absPath).split(/[\\/]+/)) {
    if (!segment || /^[A-Za-z]:$/.test(segment)) continue
    if (DENY_SEGMENT.some((re) => re.test(segment))) return segment
  }
  return null
}

/** Directories never worth walking during search — noise and huge. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.vercel',
  '.cache',
  '$recycle.bin',
  'system volume information',
])

export function shouldSkipDir(name) {
  return SKIP_DIRS.has(name.toLowerCase())
}
