/**
 * Seed (or re-seed) the evening content nudge — tasks/content-loop-design.md.
 *
 *   npm run nudge:enable                          -> next 21:30 SGT, daily
 *   npm run nudge:enable -- "2026-08-01 20:00"    -> a specific SGT time, daily
 *
 * Idempotent: refuses if a pending content_nudge row already exists. To
 * change the cadence, tell Jarvis to cancel the content nudge, then re-run.
 * Disabling is just cancelling it (from Telegram or here in the DB).
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvLocal() {
  const file = join(root, '.env.local')
  if (!existsSync(file)) return {}
  const env = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    let value = t.slice(eq + 1).trim()
    const quoted = value.match(/^(['"])(.*)\1$/)
    if (quoted) value = quoted[2]
    env[t.slice(0, eq).trim()] = value
  }
  return env
}

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** Next 21:30 SGT as a UTC Date (today if 21:30 is still ahead). */
function nextEvening() {
  const sgtMs = Date.now() + SGT_OFFSET_MS
  const dayStartMs = Math.floor(sgtMs / DAY_MS) * DAY_MS
  let candidate = dayStartMs + (21 * 60 + 30) * 60 * 1000
  if (candidate <= sgtMs) candidate += DAY_MS
  return new Date(candidate - SGT_OFFSET_MS)
}

function parseSgtArg(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(text.trim())
  if (!m) return null
  const [, y, mo, d, h, mi] = m.map(Number)
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - SGT_OFFSET_MS)
}

const env = loadEnvLocal()
const dbUrl = env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('SUPABASE_DB_URL is not set in .env.local.')
  process.exit(1)
}

const arg = process.argv[2]
const dueAt = arg ? parseSgtArg(arg) : nextEvening()
if (!dueAt) {
  console.error(`Could not parse "${arg}" — use "YYYY-MM-DD HH:MM" (SGT).`)
  process.exit(1)
}
if (dueAt.getTime() <= Date.now()) {
  console.error('That time is in the past.')
  process.exit(1)
}

const client = new pg.Client({ connectionString: dbUrl })
await client.connect()

try {
  const { rows: users } = await client.query('select id from auth.users limit 1')
  if (users.length === 0) throw new Error('No auth user found.')

  const { rows: existing } = await client.query(
    "select id, due_at from reminders where kind = 'content_nudge' and status = 'pending'"
  )
  if (existing.length > 0) {
    console.log(
      `A content nudge is already scheduled (due ${existing[0].due_at.toISOString()}).`
    )
    console.log('Cancel it first (ask Jarvis) to change the schedule.')
    process.exit(0)
  }

  await client.query(
    `insert into reminders (user_id, body, due_at, repeat, kind)
     values ($1, 'Evening content nudge', $2, 'daily', 'content_nudge')`,
    [users[0].id, dueAt.toISOString()]
  )
  const sgt = new Date(dueAt.getTime() + SGT_OFFSET_MS)
  console.log(
    `Content nudge scheduled: first send ${sgt.toISOString().slice(0, 16).replace('T', ' ')} SGT, then daily.`
  )
} finally {
  await client.end()
}
