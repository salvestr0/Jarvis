import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Db } from '@/lib/queries/db'

export type TaskPriority = 'low' | 'medium' | 'high'

export type Task = {
  id: string
  goal_id: string | null
  title: string
  priority: TaskPriority
  due_on: string | null
  done: boolean
  done_at: string | null
  note: string | null
}

/** A task joined with the title of the goal it pushes forward. */
export type TaskRow = Task & {
  goal_title: string | null
}

export async function getTasks(db?: Db): Promise<TaskRow[]> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase
    .from('tasks')
    .select(
      'id, goal_id, title, priority, due_on, done, done_at, note, goals (title)'
    )
  // Admin client bypasses RLS, so ownership moves into the query itself.
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query.order('created_at', { ascending: false })

  if (error) throw new Error(`Could not load tasks: ${error.message}`)

  type Raw = Task & { goals: { title: string } | null }
  return ((data ?? []) as unknown as Raw[]).map(({ goals, ...task }) => ({
    ...task,
    goal_title: goals?.title ?? null,
  }))
}

export type TaskInput = {
  goal_id: string | null
  title: string
  priority: TaskPriority
  due_on: string | null
  note: string | null
}

export async function createTask(input: TaskInput, db?: Db): Promise<void> {
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
    .from('tasks')
    .insert({ ...input, user_id: userId })

  if (error) throw new Error(`Could not save: ${error.message}`)
}

export async function updateTask(id: string, input: TaskInput): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('tasks').update(input).eq('id', id)
  if (error) throw new Error(`Could not update: ${error.message}`)
}

export async function setTaskDone(
  id: string,
  done: boolean,
  db?: Db
): Promise<void> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase
    .from('tasks')
    .update({ done, done_at: done ? new Date().toISOString() : null })
    .eq('id', id)
  if (db) query = query.eq('user_id', db.userId)
  // An update matching zero rows is not an error to Postgres — but reporting
  // "marked done" for a task that doesn't exist would be a lie. select()
  // returns the touched rows so we can tell.
  const { data, error } = await query.select('id')
  if (error) throw new Error(`Could not update: ${error.message}`)
  if (!data || data.length === 0) throw new Error('No task found with that id.')
}

export async function deleteTask(id: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw new Error(`Could not delete: ${error.message}`)
}
