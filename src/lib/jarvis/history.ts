import 'server-only'

import type { Db } from '@/lib/queries/db'

/**
 * Conversation memory for the bot.
 *
 * Serverless functions share nothing between invocations, so the last few
 * exchanges live in the chat_messages table and are replayed as context each
 * turn. Only final text is stored — tool calls and results are deliberately
 * dropped, which keeps the replayed transcript a legal user/assistant
 * alternation and keeps tokens (and cost) down.
 */

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

export async function loadHistory(db: Db, limit = 20): Promise<ChatTurn[]> {
  const { data, error } = await db.client
    .from('chat_messages')
    .select('role, content')
    .eq('user_id', db.userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Could not load chat history: ${error.message}`)

  const turns = ((data ?? []) as ChatTurn[]).reverse()

  // The Messages API requires the first message to be from the user. The
  // limit can slice mid-exchange and leave an assistant reply first — drop it.
  while (turns.length > 0 && turns[0].role === 'assistant') turns.shift()

  return turns
}

/**
 * A single assistant message with no user turn — how the morning digest
 * enters the conversation, so a follow-up question ("which bill?") has it
 * in context. Legal for the Messages API: only the FIRST replayed message
 * must be from the user, and loadHistory already drops leading assistant
 * rows when the window slices badly.
 */
export async function saveAssistantNote(db: Db, text: string): Promise<void> {
  const { error } = await db.client.from('chat_messages').insert({
    user_id: db.userId,
    role: 'assistant',
    content: text,
  })
  if (error) throw new Error(`Could not save digest to history: ${error.message}`)
}

export async function saveTurn(
  db: Db,
  userText: string,
  assistantText: string,
  sentAtMs?: number
): Promise<void> {
  // Explicit timestamps 1ms apart: both rows inserted in one statement would
  // share now(), making "user before assistant" ordering a coin flip on read.
  // Callers pass the moment the user message ARRIVED (sentAtMs): saves happen
  // at completion time, so two concurrent turns would otherwise replay in
  // finish order, not the order Jayden sent them.
  const at = sentAtMs ?? Date.now()

  const { error } = await db.client.from('chat_messages').insert([
    {
      user_id: db.userId,
      role: 'user',
      content: userText,
      created_at: new Date(at).toISOString(),
    },
    {
      user_id: db.userId,
      role: 'assistant',
      content: assistantText,
      created_at: new Date(at + 1).toISOString(),
    },
  ])

  // A failed save loses one exchange of context, not the reply itself —
  // callers treat this as non-fatal and just log it.
  if (error) throw new Error(`Could not save chat history: ${error.message}`)
}
