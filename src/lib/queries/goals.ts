import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Db } from '@/lib/queries/db'

export type GoalHorizon = 'short' | 'long'

export type GoalStatus = 'active' | 'achieved' | 'dropped'

export type Goal = {
  id: string
  title: string
  horizon: GoalHorizon
  status: GoalStatus
  target_date: string | null
  note: string | null
}

export async function getGoals(db?: Db): Promise<Goal[]> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase
    .from('goals')
    .select('id, title, horizon, status, target_date, note')
  // Admin client bypasses RLS, so ownership moves into the query itself.
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query
    .order('target_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Could not load goals: ${error.message}`)
  return (data ?? []) as Goal[]
}

export type GoalInput = {
  title: string
  horizon: GoalHorizon
  status: GoalStatus
  target_date: string | null
  note: string | null
}

export async function createGoal(input: GoalInput, db?: Db): Promise<void> {
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
    .from('goals')
    .insert({ ...input, user_id: userId })

  if (error) {
    if (error.code === '23505') {
      throw new Error(`You already have a goal called "${input.title}".`)
    }
    throw new Error(`Could not save: ${error.message}`)
  }
}

export async function updateGoal(id: string, input: GoalInput): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('goals').update(input).eq('id', id)
  if (error) throw new Error(`Could not update: ${error.message}`)
}

export async function setGoalStatus(
  id: string,
  status: GoalStatus,
  db?: Db
): Promise<void> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase.from('goals').update({ status }).eq('id', id)
  if (db) query = query.eq('user_id', db.userId)
  const { error } = await query
  if (error) throw new Error(`Could not update: ${error.message}`)
}

export async function deleteGoal(id: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('goals').delete().eq('id', id)
  if (error) throw new Error(`Could not delete: ${error.message}`)
}
