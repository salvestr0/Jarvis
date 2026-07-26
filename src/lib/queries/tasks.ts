import 'server-only'

import { createClient } from '@/lib/supabase/server'

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

export async function getTasks(): Promise<TaskRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tasks')
    .select(
      'id, goal_id, title, priority, due_on, done, done_at, note, goals (title)'
    )
    .order('created_at', { ascending: false })

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

export async function createTask(input: TaskInput): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in.')

  const { error } = await supabase
    .from('tasks')
    .insert({ ...input, user_id: user.id })

  if (error) throw new Error(`Could not save: ${error.message}`)
}

export async function updateTask(id: string, input: TaskInput): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('tasks').update(input).eq('id', id)
  if (error) throw new Error(`Could not update: ${error.message}`)
}

export async function setTaskDone(id: string, done: boolean): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('tasks')
    .update({ done, done_at: done ? new Date().toISOString() : null })
    .eq('id', id)
  if (error) throw new Error(`Could not update: ${error.message}`)
}

export async function deleteTask(id: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw new Error(`Could not delete: ${error.message}`)
}
