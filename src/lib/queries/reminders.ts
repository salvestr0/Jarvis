import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Db } from '@/lib/queries/db'
import type { ReminderRepeat } from '@/lib/reminders'

export type Reminder = {
  id: string
  body: string
  due_at: string
  repeat: ReminderRepeat
}

export async function createReminder(
  body: string,
  dueAt: Date,
  repeat: ReminderRepeat,
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

  const { error } = await supabase.from('reminders').insert({
    user_id: userId,
    body,
    due_at: dueAt.toISOString(),
    repeat,
  })
  if (error) throw new Error(`Could not create reminder: ${error.message}`)
}

/** Pending reminders, soonest first — the ids feed cancel_reminder. */
export async function getPendingReminders(db?: Db): Promise<Reminder[]> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase
    .from('reminders')
    .select('id, body, due_at, repeat')
    .eq('status', 'pending')
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query.order('due_at', { ascending: true })

  if (error) throw new Error(`Could not load reminders: ${error.message}`)
  return (data ?? []) as Reminder[]
}

/** Status flip, not a delete — reversible and the row stays as audit. */
export async function cancelReminder(id: string, db?: Db): Promise<void> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase
    .from('reminders')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'pending')
  if (db) query = query.eq('user_id', db.userId)
  // Zero rows matched would otherwise report "cancelled" for a reminder
  // that doesn't exist (or already fired) — same honesty check as facts.
  const { data, error } = await query.select('id')
  if (error) throw new Error(`Could not cancel reminder: ${error.message}`)
  if (!data || data.length === 0)
    throw new Error('No pending reminder found with that id.')
}

/**
 * Atomically claim every due reminder by flipping pending → sent in one
 * UPDATE ... RETURNING. Concurrent tickers (PC agent + GitHub Actions) both
 * calling deliver at once each get a disjoint set — a reminder can never be
 * claimed, and therefore never sent, twice.
 */
export async function claimDueReminders(db: Db): Promise<Reminder[]> {
  const now = new Date().toISOString()
  const { data, error } = await db.client
    .from('reminders')
    .update({ status: 'sent', last_sent_at: now })
    .eq('user_id', db.userId)
    .eq('status', 'pending')
    .lte('due_at', now)
    .select('id, body, due_at, repeat')

  if (error) throw new Error(`Could not claim reminders: ${error.message}`)
  return (data ?? []) as Reminder[]
}

/** Recurring reminder delivered: schedule the next occurrence. */
export async function rescheduleReminder(
  db: Db,
  id: string,
  nextDueAt: Date
): Promise<void> {
  const { error } = await db.client
    .from('reminders')
    .update({ status: 'pending', due_at: nextDueAt.toISOString() })
    .eq('id', id)
    .eq('user_id', db.userId)
  if (error) throw new Error(`Could not reschedule reminder: ${error.message}`)
}

/** Send failed after claiming: put it back so the next tick retries. */
export async function revertReminderClaim(db: Db, id: string): Promise<void> {
  const { error } = await db.client
    .from('reminders')
    .update({ status: 'pending', last_sent_at: null })
    .eq('id', id)
    .eq('user_id', db.userId)
  if (error) throw new Error(`Could not revert reminder claim: ${error.message}`)
}
