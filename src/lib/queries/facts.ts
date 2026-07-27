import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Db } from '@/lib/queries/db'

export type Fact = {
  id: string
  content: string
  created_at: string
}

/** Oldest first — the order they were learned reads naturally in a prompt. */
export async function getFacts(db?: Db): Promise<Fact[]> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase.from('facts').select('id, content, created_at')
  // Admin client bypasses RLS, so ownership moves into the query itself.
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query.order('created_at', { ascending: true })

  if (error) throw new Error(`Could not load facts: ${error.message}`)
  return (data ?? []) as Fact[]
}

export async function createFact(content: string, db?: Db): Promise<void> {
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
    .from('facts')
    .insert({ user_id: userId, content })

  if (error) throw new Error(`Could not save: ${error.message}`)
}

export async function deleteFact(id: string, db?: Db): Promise<void> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase.from('facts').delete().eq('id', id)
  if (db) query = query.eq('user_id', db.userId)
  // Zero rows matched is silent success to Postgres — but "forgotten" for a
  // fact that doesn't exist would be a lie. select() lets us check.
  const { data, error } = await query.select('id')
  if (error) throw new Error(`Could not delete: ${error.message}`)
  if (!data || data.length === 0) throw new Error('No fact found with that id.')
}
