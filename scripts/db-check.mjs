/**
 * Database security check.
 *
 * Answers one question: could anyone other than you read your data?
 *
 * Usage:  npm run db:check
 *
 * Run this after every migration, and always before deploying anywhere public.
 * A table in the `public` schema without Row Level Security is readable by
 * anyone holding the publishable key — which is shipped to every browser.
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvLocal() {
  const file = join(root, '.env.local')
  if (!existsSync(file)) return {}
  const env = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

const env = { ...loadEnvLocal(), ...process.env }

if (!env.SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const client = new pg.Client({
  connectionString: env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

await client.connect()

let problems = 0

try {
  // --- 1. Every public table must have RLS switched on --------------------
  const { rows: tables } = await client.query(`
    select c.relname as table_name, c.relrowsecurity as rls_enabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  `)

  console.log('\n=== Tables ===')
  for (const t of tables) {
    const status = t.rls_enabled ? 'RLS on' : '*** RLS OFF ***'
    console.log(`  ${t.table_name.padEnd(20)} ${status}`)
    if (!t.rls_enabled) problems += 1
  }

  // --- 2. RLS on but no policy = table returns nothing to anyone ----------
  const { rows: policies } = await client.query(`
    select tablename, policyname, cmd, roles::text as roles, qual is not null as has_using,
           with_check is not null as has_with_check
    from pg_policies
    where schemaname = 'public'
    order by tablename, policyname
  `)

  console.log('\n=== Policies ===')
  if (policies.length === 0) {
    console.log('  (none)')
  }
  for (const p of policies) {
    const flags = []
    if (!p.has_using) flags.push('no USING')
    // An ALL/INSERT/UPDATE policy without WITH CHECK lets you write rows
    // tagged with someone else's user_id.
    if (!p.has_with_check && ['ALL', 'INSERT', 'UPDATE'].includes(p.cmd)) {
      flags.push('*** no WITH CHECK ***')
      problems += 1
    }
    console.log(
      `  ${p.tablename.padEnd(20)} ${p.policyname.padEnd(18)} ${String(p.cmd).padEnd(6)} ${p.roles}` +
        (flags.length ? `  ${flags.join(', ')}` : '')
    )
  }

  const withRls = new Set(tables.filter((t) => t.rls_enabled).map((t) => t.table_name))
  const withPolicy = new Set(policies.map((p) => p.tablename))
  for (const t of withRls) {
    if (!withPolicy.has(t) && t !== 'schema_migrations') {
      console.log(`\n  NOTE: ${t} has RLS on but no policy — nobody can read it.`)
    }
  }

  // --- 3. Row counts -----------------------------------------------------
  console.log('\n=== Rows ===')
  for (const t of tables) {
    if (t.table_name === 'schema_migrations') continue
    const { rows } = await client.query(
      `select count(*)::int as n from public.${t.table_name}`
    )
    console.log(`  ${t.table_name.padEnd(20)} ${rows[0].n}`)
  }

  console.log(
    problems === 0
      ? '\nAll good — every table is protected.\n'
      : `\n${problems} PROBLEM(S) FOUND — fix before deploying.\n`
  )

  if (problems > 0) process.exitCode = 1
} finally {
  await client.end()
}
