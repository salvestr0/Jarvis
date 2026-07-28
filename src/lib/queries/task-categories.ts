import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Db } from '@/lib/queries/db'

export type TaskCategory = {
  id: string
  name: string
  position: number
}

export async function getTaskCategories(db?: Db): Promise<TaskCategory[]> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase.from('task_categories').select('id, name, position')
  // Admin client bypasses RLS, so ownership moves into the query itself.
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query
    .order('position', { ascending: true })
    .order('name', { ascending: true })

  if (error) throw new Error(`Could not load categories: ${error.message}`)
  return (data ?? []) as TaskCategory[]
}

export async function createTaskCategory(
  name: string,
  db?: Db
): Promise<void> {
  const supabase = db?.client ?? (await createClient())
  let userId = db?.userId
  if (!userId) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error('Not signed in.')
    userId = user.id
  }

  // New columns go on the right: one past the current largest position.
  const existing = await getTaskCategories(db)
  const position = existing.reduce((max, c) => Math.max(max, c.position), 0) + 1

  const { error } = await supabase
    .from('task_categories')
    .insert({ name, position, user_id: userId })

  if (error) {
    if (error.code === '23505') {
      throw new Error(`You already have a category called "${name}".`)
    }
    throw new Error(`Could not save: ${error.message}`)
  }
}

export async function renameTaskCategory(
  id: string,
  name: string,
  db?: Db
): Promise<void> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase.from('task_categories').update({ name }).eq('id', id)
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query.select('id')
  if (error) {
    if (error.code === '23505') {
      throw new Error(`You already have a category called "${name}".`)
    }
    throw new Error(`Could not update: ${error.message}`)
  }
  if (!data || data.length === 0) {
    throw new Error('No category found with that id.')
  }
}

export async function deleteTaskCategory(id: string, db?: Db): Promise<void> {
  const supabase = db?.client ?? (await createClient())
  // The tasks FK is "on delete set null" — its tasks move to Uncategorised.
  let query = supabase.from('task_categories').delete().eq('id', id)
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query.select('id')
  if (error) throw new Error(`Could not delete: ${error.message}`)
  if (!data || data.length === 0) {
    throw new Error('No category found with that id.')
  }
}

export async function reorderTaskCategories(
  orderedIds: string[]
): Promise<void> {
  // No db? param on purpose: the bot never reorders columns, so this stays
  // browser-session-only and RLS alone decides ownership.
  const supabase = await createClient()
  const results = await Promise.all(
    orderedIds.map((id, i) =>
      supabase
        .from('task_categories')
        .update({ position: i + 1 })
        .eq('id', id)
        .select('id')
    )
  )
  for (const { error } of results) {
    if (error) throw new Error(`Could not reorder: ${error.message}`)
  }
  const touched = results.reduce((n, r) => n + (r.data?.length ?? 0), 0)
  if (touched !== orderedIds.length) {
    throw new Error('Some categories no longer exist. Reload and try again.')
  }
}
