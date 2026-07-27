import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

import { getSupabaseUrl } from './env'

/**
 * ============================ DANGER ============================
 *
 * A Supabase client using the SERVICE ROLE key, which BYPASSES Row Level
 * Security entirely. It can read and write every row belonging to every user.
 *
 * Rules:
 *   - Only two things use this, both sessionless by nature:
 *       1. the scheduled price job (src/app/api/cron/prices)
 *       2. the Telegram bot (src/app/api/telegram -> src/lib/jarvis), which
 *          scopes every query by user_id in code via the Db contract in
 *          src/lib/queries/db.ts
 *   - Never import this from a Client Component or anything under a
 *     'use client' boundary. The `server-only` import above turns that into a
 *     build error rather than a silent leak.
 *   - The key must never carry a NEXT_PUBLIC_ prefix. That prefix is what
 *     ships a value to the browser, and this value in a browser means anyone
 *     viewing the page owns the database.
 *
 * Everything a signed-in user does goes through the normal client in
 * ./server.ts, where RLS applies. This exists only because a cron job and a
 * chat bot have no user session to authenticate as.
 *
 * ================================================================
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. The price cron and the Telegram bot cannot run without it.'
    )
  }

  return createSupabaseClient(getSupabaseUrl(), key, {
    auth: {
      // A service-role client has no user and must never try to persist or
      // refresh a session — doing so could leak the key into storage.
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
