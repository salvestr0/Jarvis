import 'server-only'

import type { Db } from '@/lib/queries/db'

/**
 * The cloud half of PC access (tasks/pc-access-design.md): insert a job,
 * wait briefly for the local agent to finish it, read heartbeat freshness.
 * Bot-only, so unlike the other query modules there is no cookie-session
 * path — a Db context is required, and every row is stamped/filtered by
 * user_id because the admin client bypasses RLS.
 */

export type PcJob = {
  id: string
  status: 'pending' | 'running' | 'done' | 'error' | 'refused'
  result: Record<string, unknown> | null
  created_at: string
}

const OFFLINE_AFTER_MS = 90_000

/** True when the agent heartbeat is fresh enough to accept jobs. */
export async function isPcOnline(db: Db): Promise<boolean> {
  const { data, error } = await db.client
    .from('pc_heartbeat')
    .select('last_seen')
    .eq('id', true)
    .maybeSingle()
  if (error) throw new Error(`Could not check PC status: ${error.message}`)
  if (!data) return false
  return Date.now() - new Date(data.last_seen).getTime() < OFFLINE_AFTER_MS
}

export async function createPcJob(
  db: Db,
  kind: 'list_dir' | 'read_file' | 'search_files' | 'run_action',
  payload: Record<string, unknown>
): Promise<string> {
  const { data, error } = await db.client
    .from('pc_jobs')
    .insert({ user_id: db.userId, kind, payload })
    .select('id')
    .single()
  if (error) throw new Error(`Could not queue the PC job: ${error.message}`)
  return data.id as string
}

export async function getPcJob(db: Db, id: string): Promise<PcJob | null> {
  const { data, error } = await db.client
    .from('pc_jobs')
    .select('id, status, result, created_at')
    .eq('id', id)
    .eq('user_id', db.userId)
    .maybeSingle()
  if (error) throw new Error(`Could not read the PC job: ${error.message}`)
  return data as PcJob | null
}

/**
 * Poll until the job leaves pending/running or the budget runs out; the
 * caller decides what "still running" means to the user. Telegram runs
 * inside after() with maxDuration 300, so a ~20s wait is comfortable.
 */
export async function waitForPcJob(
  db: Db,
  id: string,
  timeoutMs = 20_000
): Promise<PcJob | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const job = await getPcJob(db, id)
    if (!job || (job.status !== 'pending' && job.status !== 'running')) return job
    if (Date.now() > deadline) return job
    await new Promise((r) => setTimeout(r, 1000))
  }
}
