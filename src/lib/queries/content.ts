import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Db } from '@/lib/queries/db'

/**
 * Content capture-and-draft loop (tasks/content-loop-design.md): ideas are
 * raw sparks, drafts are workable posts. Same shared-queries contract as
 * everything else — the bot's tools and any future web UI go through here.
 */

export type IdeaStatus = 'inbox' | 'drafted' | 'posted' | 'dropped'
export type DraftStatus = 'draft' | 'posted' | 'dropped'

export type ContentIdea = {
  id: string
  text: string
  status: IdeaStatus
  created_at: string
}

export type ContentDraft = {
  id: string
  idea_id: string | null
  hook: string
  body: string
  status: DraftStatus
  created_at: string
}

const IDEA_CAP = 100

/** Inbox first (the pile that matters), then the rest — newest first within each. */
export async function getContentIdeas(db?: Db): Promise<ContentIdea[]> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase
    .from('content_ideas')
    .select('id, text, status, created_at')
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(IDEA_CAP)

  if (error) throw new Error(`Could not load content ideas: ${error.message}`)
  const ideas = (data ?? []) as ContentIdea[]
  return [
    ...ideas.filter((i) => i.status === 'inbox'),
    ...ideas.filter((i) => i.status !== 'inbox'),
  ]
}

export async function createContentIdea(text: string, db?: Db): Promise<void> {
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
    .from('content_ideas')
    .insert({ user_id: userId, text })
  if (error) throw new Error(`Could not save idea: ${error.message}`)
}

export async function setContentIdeaStatus(
  id: string,
  status: IdeaStatus,
  db?: Db
): Promise<void> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase.from('content_ideas').update({ status }).eq('id', id)
  if (db) query = query.eq('user_id', db.userId)
  // Zero rows matched would report an update that never happened.
  const { data, error } = await query.select('id')
  if (error) throw new Error(`Could not update idea: ${error.message}`)
  if (!data || data.length === 0) throw new Error('No idea found with that id.')
}

/** The to-ship pile by default; posted/dropped are the archive views. */
export async function getContentDrafts(
  status: DraftStatus,
  db?: Db
): Promise<ContentDraft[]> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase
    .from('content_drafts')
    .select('id, idea_id, hook, body, status, created_at')
    .eq('status', status)
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw new Error(`Could not load drafts: ${error.message}`)
  return (data ?? []) as ContentDraft[]
}

export async function createContentDraft(
  input: { hook: string; body: string; idea_id: string | null },
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

  const { error } = await supabase.from('content_drafts').insert({
    user_id: userId,
    idea_id: input.idea_id,
    hook: input.hook,
    body: input.body,
  })
  if (error) throw new Error(`Could not save draft: ${error.message}`)

  // The linked idea graduates out of the inbox. Best-effort by design: the
  // draft exists either way, and an idea already marked (or re-drafted)
  // matching zero rows is fine — unlike the status tools, this is not a
  // user-visible claim about the idea.
  if (input.idea_id) {
    const { error: ideaError } = await supabase
      .from('content_ideas')
      .update({ status: 'drafted' })
      .eq('id', input.idea_id)
      .eq('status', 'inbox')
    if (ideaError) {
      console.error(`[content] idea status flip failed: ${ideaError.message}`)
    }
  }
}

export async function setContentDraftStatus(
  id: string,
  status: DraftStatus,
  db?: Db
): Promise<void> {
  const supabase = db?.client ?? (await createClient())
  let query = supabase.from('content_drafts').update({ status }).eq('id', id)
  if (db) query = query.eq('user_id', db.userId)
  const { data, error } = await query.select('id')
  if (error) throw new Error(`Could not update draft: ${error.message}`)
  if (!data || data.length === 0) throw new Error('No draft found with that id.')
}

/** Inbox + to-ship counts — fed to the evening nudge composer. */
export async function getContentCounts(
  db: Db
): Promise<{ ideas_inbox: number; drafts_waiting: number }> {
  const [ideas, drafts] = await Promise.all([
    db.client
      .from('content_ideas')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', db.userId)
      .eq('status', 'inbox'),
    db.client
      .from('content_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', db.userId)
      .eq('status', 'draft'),
  ])
  if (ideas.error) throw new Error(`Could not count ideas: ${ideas.error.message}`)
  if (drafts.error) throw new Error(`Could not count drafts: ${drafts.error.message}`)
  return { ideas_inbox: ideas.count ?? 0, drafts_waiting: drafts.count ?? 0 }
}
