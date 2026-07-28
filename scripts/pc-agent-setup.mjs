/**
 * One-time mint of the PC agent's database credential.
 *
 *   npm run pc:setup
 *
 * Run AFTER `npm run db:migrate` has applied 0009_pc_access.sql. Connects
 * with SUPABASE_DB_URL (the owner), generates a random password for the
 * `pc_agent` role, enables login, and prints the PC_AGENT_DB_URL line to
 * paste into .env.local. That role can only touch pc_jobs and pc_heartbeat,
 * so the credential on this PC can never read tracker data.
 *
 * Printed, not written — same reasoning as google-auth.mjs. This value is
 * for .env.local ONLY; it must never be added to Vercel.
 */

import { randomBytes } from 'node:crypto'
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[t.slice(0, eq).trim()] = value
  }
  return env
}

const env = { ...loadEnvLocal(), ...process.env }
const ownerUrl = env.SUPABASE_DB_URL
if (!ownerUrl) {
  console.error('SUPABASE_DB_URL is not set in .env.local — see DEPLOY.md.')
  process.exit(1)
}

/**
 * The agent's URL is the owner's with user+password swapped. Supabase's
 * pooler namespaces users as `role.projectref`, so keep any suffix.
 */
function agentUrl(owner, password) {
  const u = new URL(owner)
  const dot = u.username.indexOf('.')
  u.username = dot === -1 ? 'pc_agent' : `pc_agent${u.username.slice(dot)}`
  u.password = password
  return u.toString()
}

// URL-safe alphabet: no percent-encoding surprises in the connection string.
const password = randomBytes(24).toString('base64url')

const client = new pg.Client({ connectionString: ownerUrl })
try {
  await client.connect()

  const { rows } = await client.query(
    "select 1 from pg_roles where rolname = 'pc_agent'"
  )
  if (rows.length === 0) {
    console.error(
      'Role pc_agent does not exist — run `npm run db:migrate` first (0009_pc_access.sql).'
    )
    process.exit(1)
  }

  // Identifier is fixed; only the password is dynamic, and parameterized
  // ALTER ROLE is not supported — quote by doubling any single quotes
  // (base64url has none, but never trust that silently).
  await client.query(
    `alter role pc_agent login password '${password.replaceAll("'", "''")}'`
  )

  console.log('\npc_agent password rotated. Paste this line into .env.local')
  console.log('(replacing any existing PC_AGENT_DB_URL line). Do NOT add it to Vercel:\n')
  console.log(`PC_AGENT_DB_URL=${agentUrl(ownerUrl, password)}\n`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
} finally {
  await client.end()
}
