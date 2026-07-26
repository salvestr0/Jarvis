import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type SalaryPeriod = 'monthly' | 'annual'

export type Job = {
  id: string
  employer: string
  title: string
  started_on: string
  ended_on: string | null
  salary_cents: number | null
  salary_currency: string
  salary_period: SalaryPeriod
  note: string | null
}

export type Win = {
  id: string
  job_id: string | null
  occurred_on: string
  title: string
  detail: string | null
}

export async function getJobs(): Promise<Job[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('jobs')
    .select(
      'id, employer, title, started_on, ended_on, salary_cents, salary_currency, salary_period, note'
    )
    // Current role (ended_on null) first, then most recent.
    .order('ended_on', { ascending: false, nullsFirst: true })
    .order('started_on', { ascending: false })

  if (error) throw new Error(`Could not load jobs: ${error.message}`)
  return (data ?? []) as Job[]
}

export async function getWins(): Promise<Win[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('job_wins')
    .select('id, job_id, occurred_on, title, detail')
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Could not load wins: ${error.message}`)
  return (data ?? []) as Win[]
}

/** Monthly equivalent of a salary, so annual and monthly roles compare. */
export function monthlySalaryCents(job: Job): number | null {
  if (job.salary_cents === null) return null
  return job.salary_period === 'annual'
    ? Math.round(job.salary_cents / 12)
    : job.salary_cents
}

export type JobInput = {
  employer: string
  title: string
  started_on: string
  ended_on: string | null
  salary_cents: number | null
  salary_currency: string
  salary_period: SalaryPeriod
  note: string | null
}

export async function createJob(input: JobInput): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in.')

  const { error } = await supabase.from('jobs').insert({ ...input, user_id: user.id })
  if (error) throw new Error(`Could not save: ${error.message}`)
}

export async function updateJob(id: string, input: JobInput): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('jobs').update(input).eq('id', id)
  if (error) throw new Error(`Could not update: ${error.message}`)
}

export async function deleteJob(id: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('jobs').delete().eq('id', id)
  if (error) throw new Error(`Could not delete: ${error.message}`)
}

export type WinInput = {
  job_id: string | null
  occurred_on: string
  title: string
  detail: string | null
}

export async function createWin(input: WinInput): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in.')

  const { error } = await supabase
    .from('job_wins')
    .insert({ ...input, user_id: user.id })
  if (error) throw new Error(`Could not save: ${error.message}`)
}

export async function deleteWin(id: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('job_wins').delete().eq('id', id)
  if (error) throw new Error(`Could not delete: ${error.message}`)
}
