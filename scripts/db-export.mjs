/**
 * Data export — cheap insurance against losing the tracker's data
 * (Supabase free-tier backups are limited).
 *
 * Usage:  npm run db:export
 *
 * Dumps every table in the public schema (discovered dynamically, so new
 * migrations are covered automatically) to backups/<YYYY-MM-DD>/<table>.json
 * plus a manifest with row counts. backups/ lives inside OneDrive on
 * Jayden's machine, so each export is synced offsite for free. Folders
 * older than the newest KEEP_DAYS are pruned.
 *
 * Data only, on purpose: the schema is reproducible from
 * supabase/migrations/ + `npm run db:migrate`.
 *
 * Needs SUPABASE_DB_URL in .env.local (same as db:migrate). A Windows
 * scheduled task ("Jarvis DB Export") runs this daily; manual runs are
 * always safe — same-day runs just overwrite that day's folder.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const backupsDir = join(root, 'backups')
const KEEP_DAYS = 14

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

function safeHost(url) {
  try {
    const u = new URL(url)
    return `${u.hostname}:${u.port || 5432}`
  } catch {
    return 'unknown host'
  }
}

/** Singapore calendar date — consistent with the app's todayISO convention. */
function todayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

async function main() {
  const env = { ...loadEnvLocal(), ...process.env }
  const connectionString = env.SUPABASE_DB_URL
  if (!connectionString) {
    console.error('Missing SUPABASE_DB_URL in .env.local (same var db:migrate uses).')
    process.exit(1)
  }

  console.log(`Connecting to ${safeHost(connectionString)} ...`)
  const client = new pg.Client({
    connectionString,
    // Same rationale as migrate.mjs: encrypted, CA check skipped.
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  const date = todayISO()
  const outDir = join(backupsDir, date)

  try {
    const { rows: tables } = await client.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name`
    )

    mkdirSync(outDir, { recursive: true })

    const manifest = { exported_at: new Date().toISOString(), date, tables: {} }
    for (const { table_name } of tables) {
      // Table names come from the catalog, not user input; quoted anyway.
      const { rows } = await client.query(`select * from "${table_name}"`)
      writeFileSync(join(outDir, `${table_name}.json`), JSON.stringify(rows, null, 1))
      manifest.tables[table_name] = rows.length
      console.log(`  ${String(rows.length).padStart(6)}  ${table_name}`)
    }
    writeFileSync(join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 2))

    // Prune: keep the newest KEEP_DAYS dated folders.
    const dated = readdirSync(backupsDir)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .reverse()
    for (const old of dated.slice(KEEP_DAYS)) {
      rmSync(join(backupsDir, old), { recursive: true, force: true })
      console.log(`  pruned ${old}`)
    }

    console.log(`\nExported ${tables.length} tables to backups/${date}/`)
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error('\nExport failed:', error.message)
  process.exit(1)
})
