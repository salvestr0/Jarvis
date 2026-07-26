/**
 * Migration runner.
 *
 * Applies every .sql file in supabase/migrations/ in filename order, and
 * records which ones have already run in a `schema_migrations` table — so
 * running it twice is safe and only new files get applied.
 *
 * Usage:  npm run db:migrate
 *
 * Needs SUPABASE_DB_URL in .env.local. That connection string contains your
 * database password, which is why it lives in a gitignored file and is never
 * pasted into a chat, a commit, or a screenshot.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'supabase', 'migrations')

/** Minimal .env parser — avoids a dependency for something this small. */
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

/** Never print the password, even when reporting which host we hit. */
function safeHost(url) {
  try {
    const u = new URL(url)
    return `${u.hostname}:${u.port || 5432}`
  } catch {
    return 'unknown host'
  }
}

async function main() {
  const env = { ...loadEnvLocal(), ...process.env }
  const connectionString = env.SUPABASE_DB_URL

  if (!connectionString) {
    console.error(
      '\nMissing SUPABASE_DB_URL in .env.local.\n\n' +
        'Supabase dashboard -> Project Settings -> Database -> Connection string\n' +
        '-> URI tab. Copy it and replace [YOUR-PASSWORD] with your database password.\n'
    )
    process.exit(1)
  }

  if (connectionString.includes('[YOUR-PASSWORD]')) {
    console.error(
      '\nSUPABASE_DB_URL still contains the literal [YOUR-PASSWORD] placeholder.\n' +
        'Replace it with your actual database password.\n'
    )
    process.exit(1)
  }

  if (!existsSync(migrationsDir)) {
    console.error(`No migrations directory at ${migrationsDir}`)
    process.exit(1)
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  if (files.length === 0) {
    console.log('No migration files found.')
    return
  }

  console.log(`Connecting to ${safeHost(connectionString)} ...`)

  const client = new pg.Client({
    connectionString,
    // Supabase terminates TLS with a certificate chain Node doesn't ship a
    // root for. The connection is still encrypted; we're only skipping the
    // "is this cert signed by a CA I know" check, which is standard practice
    // for Supabase migration tooling.
    ssl: { rejectUnauthorized: false },
  })

  await client.connect()

  try {
    await client.query(`
      create table if not exists public.schema_migrations (
        filename    text primary key,
        applied_at  timestamptz not null default now()
      )
    `)

    const { rows } = await client.query(
      'select filename from public.schema_migrations'
    )
    const applied = new Set(rows.map((r) => r.filename))

    let ran = 0

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip  ${file} (already applied)`)
        continue
      }

      const sql = readFileSync(join(migrationsDir, file), 'utf8')

      // Each migration runs in a transaction: if any statement fails, the
      // whole file rolls back. You never end up half-migrated.
      try {
        await client.query('begin')
        await client.query(sql)
        await client.query(
          'insert into public.schema_migrations (filename) values ($1)',
          [file]
        )
        await client.query('commit')
        console.log(`  ok    ${file}`)
        ran += 1
      } catch (error) {
        await client.query('rollback')
        console.error(`\n  FAILED ${file}\n  ${error.message}\n`)
        console.error('  Nothing from this file was applied (rolled back).')
        process.exitCode = 1
        return
      }
    }

    console.log(
      ran === 0
        ? '\nAlready up to date.'
        : `\nApplied ${ran} migration${ran === 1 ? '' : 's'}.`
    )
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error('\nMigration failed:', error.message)
  process.exit(1)
})
