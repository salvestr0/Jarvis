import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Db } from '@/lib/queries/db'

export type TaskPriority = 'low' | 'medium' | 'high'

export type Task = {
  id: string
  goal_id: string | null
  category_id: string | null
  title: string
  priority: TaskPriority
  due_on: string | null
  done: boolean
  done_at: string | null
  note: string | null
  /** Manual order within a board column. 0 = created but never placed. */
  position: number
  created_at: string
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
      'id, goal_id, category_id, title, priority, due_on, done, done_at, note, position, created_at, goals (title)'
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
  // Optional so existing callers (the Telegram bot) compile unchanged.
  category_id?: string | null
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

export async function updateTask(
  id: string,
  input: TaskInput,
  db?: Db
): Promise<void> {
  const supabase = db?.client ?? (await createClient())
  const payload: Record<string, unknown> = {
    goal_id: input.goal_id,
    title: input.title,
    priority: input.priority,
    due_on: input.due_on,
    note: input.note,
  }
  // The Telegram bot rebuilds TaskInput without a category — omitting the key
  // must leave the card in its column, not fling it back to Uncategorised.
  if (input.category_id !== undefined) payload.category_id = input.category_id
  let query = supabase.from('tasks').update(payload).eq('id', id)
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query.select('id')
  if (error) throw new Error(`Could not update: ${error.message}`)
  if (!data || data.length === 0) throw new Error('No task found with that id.')
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

/** One board column's new contents, in its new top-to-bottom order. */
export type ColumnOrder = {
  categoryId: string | null
  orderedIds: string[]
}

/**
 * Persist a board rearrangement: every task in each given column gets that
 * column's category and a dense position 1..n. No db? param on purpose — the
 * bot never reorders, so this stays browser-session-only and RLS alone
 * decides ownership.
 */
export async function reorderTasks(columns: ColumnOrder[]): Promise<void> {
  const total = columns.reduce((n, c) => n + c.orderedIds.length, 0)
  if (total === 0) return
  if (total > 300) throw new Error('Too many tasks to reorder at once.')

  const supabase = await createClient()
  const results = await Promise.all(
    columns.flatMap((col) =>
      col.orderedIds.map((id, i) =>
        supabase
          .from('tasks')
          .update({ category_id: col.categoryId, position: i + 1 })
          .eq('id', id)
          .select('id')
      )
    )
  )
  for (const { error } of results) {
    if (error) throw new Error(`Could not move: ${error.message}`)
  }
  // RLS matching zero rows is silent success to Postgres — but reporting a
  // move that didn't happen would be a lie. Count what was actually touched.
  const touched = results.reduce((n, r) => n + (r.data?.length ?? 0), 0)
  if (touched !== total) {
    throw new Error('Some tasks no longer exist. Reload and try again.')
  }
}

export async function deleteTask(id: string, db?: Db): Promise<void> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase.from('tasks').delete().eq('id', id)
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query.select('id')
  if (error) throw new Error(`Could not delete: ${error.message}`)
  if (!data || data.length === 0) throw new Error('No task found with that id.')
}
