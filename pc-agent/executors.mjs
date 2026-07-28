/**
 * Tier-1 job executors: list, read, search. Read-only by construction —
 * nothing in this file imports a write API.
 *
 * Every entry point re-validates against the sandbox even though the cloud
 * side also describes the rules to the model: the PC is the enforcement
 * point, the cloud is just a client.
 */

import { promises as fs, realpathSync } from 'node:fs'
import path from 'node:path'

import { deniedSegment, isInside, resolveRequest, shouldSkipDir } from './sandbox.mjs'

const READ_CAP_BYTES = 64 * 1024
const LIST_CAP = 200
const SEARCH_RESULT_CAP = 20
const SEARCH_FILE_SCAN_CAP = 4000
const SEARCH_TIME_CAP_MS = 8000
const CONTENT_GREP_MAX_BYTES = 512 * 1024

/** A policy refusal — distinct from an error so it lands as status 'refused'. */
export class Refusal extends Error {}

/**
 * Alias/absolute request → canonical real path, verified inside a root and
 * clean of denied segments. Throws Refusal with a model-actionable message.
 */
function authorize(requested, roots) {
  const mapped = resolveRequest(String(requested ?? ''), roots)
  if (!mapped) {
    throw new Refusal(
      `Path must be absolute or start with one of: ${Object.keys(roots).join(', ')}.`
    )
  }

  let real
  try {
    // realpath resolves junctions/symlinks BEFORE containment is checked.
    real = realpathSync(mapped)
  } catch {
    throw new Refusal(`Not found: ${mapped}`)
  }

  const rootsReal = Object.values(roots).map((r) => realpathSync(r))
  if (!rootsReal.some((rootReal) => isInside(rootReal, real))) {
    throw new Refusal('That path is outside the allowed folders.')
  }

  const denied = deniedSegment(real)
  if (denied) {
    throw new Refusal(`"${denied}" is on the secrets deny-list.`)
  }
  return real
}

export async function listDir(payload, roots) {
  const dir = authorize(payload.path, roots)
  const stat = await fs.stat(dir)
  if (!stat.isDirectory()) throw new Refusal(`${dir} is a file — use read_file.`)

  const dirents = await fs.readdir(dir, { withFileTypes: true })
  const entries = []
  for (const d of dirents) {
    const entry = { name: d.name, type: d.isDirectory() ? 'dir' : 'file' }
    if (!d.isDirectory()) {
      try {
        const s = await fs.stat(path.join(dir, d.name))
        entry.size = s.size
        entry.modified = s.mtime.toISOString()
      } catch {
        // Stat can fail on locked system files; the name alone still helps.
      }
    }
    entries.push(entry)
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))

  return {
    path: dir,
    total: entries.length,
    truncated: entries.length > LIST_CAP,
    entries: entries.slice(0, LIST_CAP),
  }
}

function looksBinary(buf) {
  return buf.subarray(0, 8192).includes(0)
}

export async function readFile(payload, roots) {
  const file = authorize(payload.path, roots)
  const stat = await fs.stat(file)
  if (stat.isDirectory()) throw new Refusal(`${file} is a folder — use list_dir.`)

  const handle = await fs.open(file, 'r')
  try {
    const buf = Buffer.alloc(Math.min(stat.size, READ_CAP_BYTES))
    await handle.read(buf, 0, buf.length, 0)
    if (looksBinary(buf)) {
      throw new Refusal(`${path.basename(file)} is a binary file (${stat.size} bytes) — text only.`)
    }
    return {
      path: file,
      size: stat.size,
      truncated: stat.size > READ_CAP_BYTES,
      content: buf.toString('utf8'),
    }
  } finally {
    await handle.close()
  }
}

export async function searchFiles(payload, roots) {
  const name = typeof payload.name === 'string' ? payload.name.trim().toLowerCase() : ''
  const content = typeof payload.content === 'string' ? payload.content.trim().toLowerCase() : ''
  if (!name && !content) throw new Refusal('Provide name and/or content to search for.')

  // Optional scope narrows the walk; default is every root.
  const scopes = payload.path
    ? [authorize(payload.path, roots)]
    : Object.values(roots).map((r) => realpathSync(r))

  const deadline = Date.now() + SEARCH_TIME_CAP_MS
  const results = []
  let scanned = 0
  let capped = false

  async function walk(dir) {
    if (results.length >= SEARCH_RESULT_CAP || Date.now() > deadline || scanned > SEARCH_FILE_SCAN_CAP) {
      capped = true
      return
    }
    let dirents
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return // Unreadable dir: skip, don't die.
    }
    for (const d of dirents) {
      if (results.length >= SEARCH_RESULT_CAP) { capped = true; return }
      const full = path.join(dir, d.name)
      if (d.isDirectory()) {
        if (!shouldSkipDir(d.name) && !deniedSegment(full)) await walk(full)
        continue
      }
      scanned++
      if (deniedSegment(full)) continue
      const nameHit = !name || d.name.toLowerCase().includes(name)
      if (!nameHit) continue
      if (content) {
        try {
          const s = await fs.stat(full)
          if (s.size > CONTENT_GREP_MAX_BYTES) continue
          const buf = await fs.readFile(full)
          if (looksBinary(buf) || !buf.toString('utf8').toLowerCase().includes(content)) continue
        } catch {
          continue
        }
      }
      results.push({ path: full })
    }
  }

  for (const scope of scopes) await walk(scope)

  return { matches: results, scanned, capped }
}

export const EXECUTORS = {
  list_dir: listDir,
  read_file: readFile,
  search_files: searchFiles,
}
