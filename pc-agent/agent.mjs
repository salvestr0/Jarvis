/**
 * The PC agent — tier 1 (read-only), per tasks/pc-access-design.md.
 *
 *   npm run pc:agent
 *
 * Connects OUTWARD to Postgres as the boxed `pc_agent` role (nothing
 * listens on this machine), claims pending pc_jobs, executes them behind
 * the sandbox, and writes results back. Heartbeats every 30s so the cloud
 * can answer "PC offline" instantly when this isn't running.
 *
 * Policy lives HERE (config.json + sandbox.mjs), not in the cloud: a
 * compromised cloud session cannot expand what this process will do.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

import { runAction, validateActions } from './actions.mjs'
import { EXECUTORS, Refusal } from './executors.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const VERSION = 'pc-agent/2 tier-1+actions'
// A job older than this was queued while the PC was offline; running stale
// requests long after they were asked would surprise, so they expire.
const EXPIRE_SECONDS = 120

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
const dbUrl = env.PC_AGENT_DB_URL
if (!dbUrl) {
  console.error('PC_AGENT_DB_URL is not set in .env.local — run `npm run pc:setup` first.')
  process.exit(1)
}

const config = JSON.parse(readFileSync(join(here, 'config.json'), 'utf8'))
for (const [alias, dir] of Object.entries(config.roots)) {
  if (!existsSync(dir)) {
    console.error(`Root "${alias}" does not exist: ${dir} — fix pc-agent/config.json.`)
    process.exit(1)
  }
}

// Tier 2: the named-action allowlist, validated up front so a broken edit
// stops the agent instead of failing job by job.
const actions = validateActions(
  JSON.parse(readFileSync(join(here, 'actions.json'), 'utf8'))
)

const HANDLERS = {
  ...EXECUTORS,
  run_action: (payload) => runAction(payload, actions),
}

let client = null
let stopping = false

async function connect() {
  const c = new pg.Client({ connectionString: dbUrl })
  await c.connect()
  return c
}

async function heartbeat() {
  await client.query(
    `insert into pc_heartbeat (id, last_seen, version) values (true, now(), $1)
     on conflict (id) do update set last_seen = now(), version = $1`,
    [VERSION]
  )
}

async function expireStale() {
  await client.query(
    `update pc_jobs
     set status = 'error', finished_at = now(),
         result = '{"error": "expired — the PC was offline when this was requested"}'
     where status = 'pending' and created_at < now() - make_interval(secs => $1)`,
    [EXPIRE_SECONDS]
  )
}

/** Claim the oldest fresh pending job, or null. Single agent, but atomic anyway. */
async function claim() {
  const { rows } = await client.query(
    `update pc_jobs set status = 'running'
     where id = (select id from pc_jobs where status = 'pending' order by created_at limit 1)
       and status = 'pending'
     returning id, kind, payload`
  )
  return rows[0] ?? null
}

async function finish(id, status, result) {
  await client.query(
    `update pc_jobs set status = $2, result = $3, finished_at = now() where id = $1`,
    [id, status, JSON.stringify(result)]
  )
}

async function runJob(job) {
  const executor = HANDLERS[job.kind]
  if (!executor) {
    await finish(job.id, 'error', { error: `Unknown job kind: ${job.kind}` })
    return
  }
  try {
    const result = await executor(job.payload ?? {}, config.roots)
    await finish(job.id, 'done', result)
    console.log(`[${new Date().toISOString()}] done   ${job.kind} ${JSON.stringify(job.payload)}`)
  } catch (error) {
    const refused = error instanceof Refusal
    await finish(job.id, refused ? 'refused' : 'error', {
      error: error instanceof Error ? error.message : 'Job failed.',
    })
    console.log(
      `[${new Date().toISOString()}] ${refused ? 'refuse' : 'error '} ${job.kind}: ${error.message}`
    )
  }
}

async function main() {
  console.log(`${VERSION} starting. Roots: ${Object.values(config.roots).join(', ')}`)
  console.log(`Actions: ${Object.keys(actions).join(', ')}`)
  let lastHeartbeat = 0

  while (!stopping) {
    try {
      client ??= await connect()

      if (Date.now() - lastHeartbeat > config.heartbeatMs) {
        await heartbeat()
        lastHeartbeat = Date.now()
      }
      await expireStale()

      // Drain everything queued, then sleep one poll interval.
      let job
      while (!stopping && (job = await claim())) await runJob(job)
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] connection trouble: ${error instanceof Error ? error.message : error} — retrying in 5s`
      )
      try { await client?.end() } catch { /* already gone */ }
      client = null
      lastHeartbeat = 0
      await new Promise((r) => setTimeout(r, 5000))
      continue
    }
    await new Promise((r) => setTimeout(r, config.pollMs))
  }

  try { await client?.end() } catch { /* shutting down */ }
}

process.on('SIGINT', () => {
  console.log('\nStopping — Jarvis will report the PC offline within 90s.')
  stopping = true
})

await main()
