/**
 * One-way sync: Koda AI Second Brain -> Jarvis's `facts` table.
 *
 * Usage:  node scripts/sync-brain-to-jarvis.mjs <dump.json>
 *
 * <dump.json> is an array of brain nodes ({ type, name, summary, status, ... })
 * produced in-session via the koda_brain_query MCP tool — the brain's graph.json
 * is encrypted at rest, so the sanctioned query tool is the only reader. The
 * /sync-brain-to-jarvis skill in .claude/skills/ automates the dump + this run.
 *
 * Every synced row's content starts with "[brain:<name>]", which makes the sync
 * stateless: existing rows are matched by that prefix, so reruns are idempotent
 * from any machine. Unchanged facts are skipped, changed ones replaced,
 * superseded ones removed. Facts WITHOUT the prefix (Jarvis's own `remember`
 * tool) are never touched.
 *
 * Caveat: if Jarvis is told to `forget` a synced fact, the next sync reinstates
 * it — to remove one for good, delete it from the Koda brain side.
 *
 * Needs SUPABASE_DB_URL and ALLOWED_EMAIL in .env.local.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Identity types only — reading-queue "learning" nodes stay out of Jarvis's
// every-turn context on purpose.
const IDENTITY_TYPES = new Set(['person', 'preference', 'goal', 'project', 'skill', 'belief'])

// Content/brand-strategy facts stay out of Jarvis (decided 5 Aug 2026): every
// fact is injected into every bot turn, and content strategy lives in Koda
// sessions, not the Telegram assistant. Tag-based so future brain facts with
// these tags are excluded automatically; matching rows already in the table
// are removed like superseded ones.
const EXCLUDE_TAGS = new Set([
  'content', 'content-strategy', 'content-rules', 'youtube', 'video', 'capcut',
  'instagram', 'faceless', 'branding', 'personal-branding', 'brand',
  'brand-voice', 'positioning', 'messaging', 'marketing', 'audience', 'pov',
])

function isExcluded(node) {
  return (
    Array.isArray(node.tags) &&
    node.tags.some((tag) => EXCLUDE_TAGS.has(String(tag).toLowerCase()))
  )
}

// facts.content has a 500-char check constraint (0008_facts.sql).
const MAX_CONTENT = 500

/** Minimal .env parser — same as db-export.mjs. */
function loadEnvLocal() {
  const file = join(root, '.env.local')
  if (!existsSync(file)) return {}

  const env = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function factContent(node) {
  const head = `[brain:${node.name}] (${node.type}) `
  let summary = String(node.summary ?? '').replace(/\s+/g, ' ').trim()
  const room = MAX_CONTENT - head.length
  if (summary.length > room) {
    const cut = summary.slice(0, room - 1)
    const lastSpace = cut.lastIndexOf(' ')
    summary = (lastSpace > room / 2 ? cut.slice(0, lastSpace) : cut) + '…'
  }
  return head + summary
}

async function main() {
  const dumpPath = process.argv[2]
  if (!dumpPath) {
    console.error('Usage: node scripts/sync-brain-to-jarvis.mjs <dump.json>')
    process.exit(1)
  }

  let nodes
  try {
    nodes = JSON.parse(readFileSync(dumpPath, 'utf8'))
  } catch (error) {
    console.error(`Could not read dump file: ${error.message}`)
    process.exit(1)
  }
  if (!Array.isArray(nodes) || nodes.length === 0) {
    console.error('Dump is empty or not an array — refusing to run against an empty dump.')
    process.exit(1)
  }

  // Dedupe by name (per-type queries can overlap) and drop non-identity types.
  const byName = new Map()
  for (const node of nodes) {
    if (!node || !node.name || !IDENTITY_TYPES.has(node.type)) continue
    // Summary-less nodes would sync as empty noise — but keep superseded ones
    // so their previously-synced rows still get removed.
    if (!String(node.summary ?? '').trim() && node.status !== 'superseded') continue
    if (!byName.has(node.name)) byName.set(node.name, node)
  }
  if (byName.size === 0) {
    console.error('Dump contained no identity-type facts.')
    process.exit(1)
  }

  const env = { ...loadEnvLocal(), ...process.env }
  if (!env.SUPABASE_DB_URL || !env.ALLOWED_EMAIL) {
    console.error('Missing SUPABASE_DB_URL or ALLOWED_EMAIL in .env.local.')
    process.exit(1)
  }

  const client = new pg.Client({
    connectionString: env.SUPABASE_DB_URL,
    // Same rationale as migrate.mjs: encrypted, CA check skipped.
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  try {
    const { rows: users } = await client.query(
      'select id from auth.users where email = $1',
      [env.ALLOWED_EMAIL]
    )
    if (users.length === 0) {
      console.error(`No auth user found for ${env.ALLOWED_EMAIL}.`)
      process.exit(1)
    }
    const userId = users[0].id

    const { rows: existing } = await client.query(
      `select id, content from public.facts
       where user_id = $1 and content like '[brain:%'`,
      [userId]
    )
    // name -> [{id, content}] (array so accidental duplicates get cleaned up)
    const existingByName = new Map()
    for (const row of existing) {
      const match = row.content.match(/^\[brain:([^\]]+)\]/)
      if (!match) continue
      const list = existingByName.get(match[1]) ?? []
      list.push(row)
      existingByName.set(match[1], list)
    }

    let inserted = 0
    let updated = 0
    let unchanged = 0
    let removed = 0

    for (const node of byName.values()) {
      const rows = existingByName.get(node.name) ?? []

      if (node.status === 'superseded' || isExcluded(node)) {
        for (const row of rows) {
          await client.query('delete from public.facts where id = $1', [row.id])
          removed++
        }
        continue
      }

      const content = factContent(node)
      if (rows.length === 1 && rows[0].content === content) {
        unchanged++
        continue
      }
      for (const row of rows) {
        await client.query('delete from public.facts where id = $1', [row.id])
      }
      await client.query(
        'insert into public.facts (user_id, content) values ($1, $2)',
        [userId, content]
      )
      if (rows.length > 0) updated++
      else inserted++
    }

    console.log(
      `Synced ${byName.size} brain facts -> Jarvis: ` +
        `${inserted} new, ${updated} updated, ${unchanged} unchanged, ${removed} removed.`
    )
    // Orphans (synced earlier, missing from this dump) are left alone on
    // purpose — per-type queries cap at 25, so absence may just mean the dump
    // was partial, not that the fact is gone.
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error('\nSync failed:', error.message)
  process.exit(1)
})
