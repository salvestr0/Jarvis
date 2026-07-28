/**
 * Security audit — run before every deploy.
 *
 *   npm run audit
 *
 * Checks, in order of how badly each one would hurt:
 *   1. Secrets are not committed, and cannot be.
 *   2. Secrets do not reach the browser bundle.
 *   3. Dangerous env vars aren't marked NEXT_PUBLIC_ (which ships them).
 *   4. The service-role client is only imported from server-side code.
 *   5. Every 'use server' file only exports async functions.
 *
 * Exits non-zero on any failure so it can gate a deploy.
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
let warnings = 0

function pass(msg) {
  console.log(`  PASS  ${msg}`)
}
function fail(msg) {
  console.log(`  FAIL  ${msg}`)
  failures += 1
}
function warn(msg) {
  console.log(`  WARN  ${msg}`)
  warnings += 1
}

function loadEnvLocal() {
  const file = join(root, '.env.local')
  if (!existsSync(file)) return {}
  const env = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
  return env
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const env = loadEnvLocal()

/** Values that must never appear anywhere public. */
const SECRET_KEYS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'CRON_SECRET',
  'FINNHUB_API_KEY',
  'ANTHROPIC_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
  'GROQ_API_KEY',
  'PC_AGENT_DB_URL',
]

const secrets = SECRET_KEYS.map((k) => [k, env[k]]).filter(
  ([, v]) => v && v.length > 8
)

// Database passwords on their own, since they can appear outside a full URL.
for (const [key, label] of [
  ['SUPABASE_DB_URL', 'DB_PASSWORD'],
  ['PC_AGENT_DB_URL', 'PC_AGENT_PASSWORD'],
]) {
  if (env[key]) {
    const m = env[key].match(/:\/\/[^:]+:([^@]+)@/)
    if (m && m[1].length > 4) secrets.push([label, m[1]])
  }
}

console.log('\n=== 1. Secrets are not committed ===')
{
  const gitignore = existsSync(join(root, '.gitignore'))
    ? readFileSync(join(root, '.gitignore'), 'utf8')
    : ''

  if (/^\.env\*?$/m.test(gitignore) || gitignore.includes('.env*')) {
    pass('.gitignore covers .env*')
  } else {
    fail('.gitignore does not cover .env files')
  }

  try {
    const tracked = execSync('git ls-files', { cwd: root, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean)

    const trackedEnv = tracked.filter(
      (f) => /(^|\/)\.env/.test(f) && !f.endsWith('.example')
    )

    if (trackedEnv.length === 0) pass('no .env file is tracked by git')
    else fail(`git is tracking: ${trackedEnv.join(', ')}`)

    // The decisive check: are any real secret VALUES inside tracked files?
    let leaked = 0
    for (const file of tracked) {
      const full = join(root, file)
      if (!existsSync(full) || statSync(full).isDirectory()) continue
      let content
      try {
        content = readFileSync(full, 'utf8')
      } catch {
        continue
      }
      for (const [name, value] of secrets) {
        if (content.includes(value)) {
          fail(`${name} value found in tracked file ${file}`)
          leaked += 1
        }
      }
    }
    if (leaked === 0 && secrets.length > 0) {
      pass(`no secret values found in ${tracked.length} tracked files`)
    }
  } catch {
    warn('git not available — skipped tracked-file scan')
  }
}

console.log('\n=== 2. Secrets do not reach the browser ===')
{
  const staticDir = join(root, '.next', 'static')
  if (!existsSync(staticDir)) {
    warn('no .next/static — run `npm run build` first for this check to mean anything')
  } else if (secrets.length === 0) {
    warn('no secrets configured in .env.local — nothing to check')
  } else {
    const files = walk(staticDir)
    let leaked = 0
    for (const [name, value] of secrets) {
      const hits = files.filter((f) => {
        try {
          return readFileSync(f, 'utf8').includes(value)
        } catch {
          return false
        }
      })
      if (hits.length > 0) {
        fail(`${name} appears in browser bundle: ${relative(root, hits[0])}`)
        leaked += 1
      }
    }
    if (leaked === 0) {
      pass(`${secrets.length} secrets absent from ${files.length} browser files`)
    }
  }
}

console.log('\n=== 3. No dangerous NEXT_PUBLIC_ vars ===')
{
  // NEXT_PUBLIC_ is what ships a value to the browser. These names must never
  // carry it, regardless of what the value happens to be.
  const banned = /^NEXT_PUBLIC_.*(SERVICE_ROLE|SECRET|PASSWORD|DB_URL|PRIVATE|TOKEN|_KEY$)/i
  const offenders = Object.keys(env).filter(
    (k) => banned.test(k) && !/PUBLISHABLE|ANON/i.test(k)
  )

  if (offenders.length === 0) pass('no sensitive NEXT_PUBLIC_ variables')
  else offenders.forEach((k) => fail(`${k} is exposed to the browser`))
}

console.log('\n=== 4. Service-role client stays server-side ===')
{
  const srcFiles = walk(join(root, 'src')).filter((f) => /\.(ts|tsx)$/.test(f))

  const importers = srcFiles.filter((f) => {
    const c = readFileSync(f, 'utf8')
    return /from ['"]@\/lib\/supabase\/admin['"]/.test(c)
  })

  const clientImporters = importers.filter((f) =>
    /^\s*['"]use client['"]/.test(readFileSync(f, 'utf8'))
  )

  if (clientImporters.length > 0) {
    clientImporters.forEach((f) =>
      fail(`admin client imported from a Client Component: ${relative(root, f)}`)
    )
  } else {
    pass(
      importers.length === 0
        ? 'admin client is unused'
        : `admin client imported only by server code (${importers.length} file${importers.length === 1 ? '' : 's'})`
    )
  }

  const adminFile = join(root, 'src', 'lib', 'supabase', 'admin.ts')
  if (existsSync(adminFile)) {
    if (readFileSync(adminFile, 'utf8').includes("import 'server-only'")) {
      pass("admin.ts has the 'server-only' guard")
    } else {
      fail("admin.ts is missing import 'server-only'")
    }
  }
}

console.log("\n=== 5. 'use server' files export only async functions ===")
{
  try {
    execSync('node scripts/check-actions.mjs', { cwd: root, stdio: 'pipe' })
    pass('all server action files are valid')
  } catch (error) {
    fail('check:actions failed — run `npm run check:actions` for detail')
  }
}

console.log('\n' + '='.repeat(52))
if (failures === 0) {
  console.log(
    `AUDIT PASSED${warnings > 0 ? ` (${warnings} warning${warnings === 1 ? '' : 's'})` : ''}`
  )
  console.log('Remember: `npm run db:check` covers the database side.\n')
} else {
  console.log(`AUDIT FAILED — ${failures} problem${failures === 1 ? '' : 's'}\n`)
  process.exit(1)
}
