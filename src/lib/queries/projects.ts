import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Db } from '@/lib/queries/db'

export type ProjectStatus =
  | 'idea'
  | 'building'
  | 'beta'
  | 'launched'
  | 'paused'
  | 'archived'

export type ProjectKind = 'product' | 'content' | 'business'

export type Project = {
  id: string
  name: string
  status: ProjectStatus
  kind: ProjectKind
  launch_date: string | null
  mrr_target_cents: number
  url: string | null
  note: string | null
}

export type ProjectMetric = {
  id: string
  project_id: string
  as_of: string
  mrr_cents: number
  users_count: number | null
}

export type ProjectWithProgress = Project & {
  currentMrrCents: number
  metricAsOf: string | null
  usersCount: number | null
  /** 0-100, or null when the project has no revenue target. */
  progressPct: number | null
}

export async function getProjects(db?: Db): Promise<Project[]> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase
    .from('projects')
    .select('id, name, status, kind, launch_date, mrr_target_cents, url, note')
  // Admin client bypasses RLS, so ownership moves into the query itself.
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query.order('name')

  if (error) throw new Error(`Could not load projects: ${error.message}`)
  return (data ?? []) as Project[]
}

export async function getMetrics(db?: Db): Promise<ProjectMetric[]> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase
    .from('project_metrics')
    .select('id, project_id, as_of, mrr_cents, users_count')
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query.order('as_of', { ascending: false })

  if (error) throw new Error(`Could not load metrics: ${error.message}`)
  return (data ?? []) as ProjectMetric[]
}

/**
 * Attach each project's most recent metric.
 *
 * Metrics arrive newest-first, so the first one seen per project wins.
 */
export function withProgress(
  projects: Project[],
  metrics: ProjectMetric[]
): ProjectWithProgress[] {
  const latest = new Map<string, ProjectMetric>()
  for (const m of metrics) {
    if (!latest.has(m.project_id)) latest.set(m.project_id, m)
  }

  return projects.map((p) => {
    const metric = latest.get(p.id) ?? null
    const currentMrrCents = metric?.mrr_cents ?? 0

    return {
      ...p,
      currentMrrCents,
      metricAsOf: metric?.as_of ?? null,
      usersCount: metric?.users_count ?? null,
      // A project with no revenue target (a content or brand play) has no
      // meaningful "percent of goal" — showing 0% would read as failure.
      progressPct:
        p.mrr_target_cents === 0
          ? null
          : Math.min(100, (currentMrrCents / p.mrr_target_cents) * 100),
    }
  })
}

export type ProjectInput = {
  name: string
  status: ProjectStatus
  kind: ProjectKind
  launch_date: string | null
  mrr_target_cents: number
  url: string | null
  note: string | null
}

export async function createProject(input: ProjectInput): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in.')

  const { error } = await supabase
    .from('projects')
    .insert({ ...input, user_id: user.id })

  if (error) {
    if (error.code === '23505') {
      throw new Error(`You already have a project called "${input.name}".`)
    }
    throw new Error(`Could not save: ${error.message}`)
  }
}

export async function updateProject(
  id: string,
  input: ProjectInput
): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('projects').update(input).eq('id', id)
  if (error) throw new Error(`Could not update: ${error.message}`)
}

export async function deleteProject(id: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) throw new Error(`Could not delete: ${error.message}`)
}

export async function setProjectStatus(
  id: string,
  status: ProjectStatus,
  db?: Db
): Promise<void> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase.from('projects').update({ status }).eq('id', id)
  if (db) query = query.eq('user_id', db.userId)
  // Zero rows matched is silent success to Postgres — but "status updated"
  // for a project that doesn't exist would be a lie. select() lets us check.
  const { data, error } = await query.select('id')
  if (error) throw new Error(`Could not update: ${error.message}`)
  if (!data || data.length === 0)
    throw new Error('No project found with that id.')
}

export type MetricInput = {
  project_id: string
  as_of: string
  mrr_cents: number
  users_count: number | null
}

/**
 * Record (or overwrite) a project's numbers for a given date.
 *
 * Upsert rather than insert: logging twice on the same day should correct the
 * figure, not create a duplicate row that quietly breaks "latest".
 */
export async function recordMetric(input: MetricInput, db?: Db): Promise<void> {
  const supabase = db?.client ?? (await createClient())
  let userId = db?.userId
  if (!userId) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error('Not signed in.')
    userId = user.id
  }

  const { error } = await supabase
    .from('project_metrics')
    .upsert({ ...input, user_id: userId }, { onConflict: 'project_id,as_of' })

  if (error) throw new Error(`Could not save: ${error.message}`)
}
