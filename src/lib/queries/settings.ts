import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Db } from '@/lib/queries/db'

export type DigestMode = 'daily' | 'noteworthy' | 'off'

export type Settings = {
  digest_mode: DigestMode
  digest_calendar: boolean
  digest_email: boolean
  digest_money: boolean
  digest_portfolio: boolean
  digest_tasks: boolean
}

/** What the digest does before the user has ever touched /settings. */
export const DEFAULT_SETTINGS: Settings = {
  digest_mode: 'daily',
  digest_calendar: true,
  digest_email: true,
  digest_money: true,
  digest_portfolio: true,
  digest_tasks: true,
}

const COLUMNS =
  'digest_mode, digest_calendar, digest_email, digest_money, digest_portfolio, digest_tasks'

/**
 * The user's settings, or the defaults when no row exists yet. Deliberately
 * never writes on read — the row appears on first save.
 */
export async function getSettings(db?: Db): Promise<Settings> {
  const supabase = db?.client ?? (await createClient())

  let query = supabase.from('settings').select(COLUMNS)
  // Admin client bypasses RLS, so ownership moves into the query itself.
  if (db) query = query.eq('user_id', db.userId)

  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`Could not load settings: ${error.message}`)

  return (data as Settings | null) ?? DEFAULT_SETTINGS
}

export async function saveSettings(input: Settings, db?: Db): Promise<void> {
  const supabase = db?.client ?? (await createClient())

  let userId = db?.userId
  if (!userId) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error('Not signed in.')
    userId = user.id
  }

  const { error } = await supabase.from('settings').upsert(
    { user_id: userId, ...input, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  )

  if (error) throw new Error(`Could not save settings: ${error.message}`)
}
