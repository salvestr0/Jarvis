import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * An explicit database context for callers that have no browser session —
 * today that means the Telegram bot (src/lib/jarvis).
 *
 * Every query function accepts this as an optional trailing parameter:
 *
 *   - Omitted (the web app): the function builds the normal cookie-session
 *     client and Row Level Security scopes rows in Postgres. Behavior is
 *     exactly what it was before this type existed.
 *   - Provided (the bot): `client` is the service-role admin client, which
 *     BYPASSES RLS — so every read must filter `.eq('user_id', db.userId)`
 *     and every write must stamp `user_id: db.userId` in application code.
 *     Same rule as src/lib/cron/refresh-all.ts, and same reasoning: when
 *     Postgres isn't enforcing ownership, the code must.
 *
 * Global, non-user tables (`price_snapshots`, `fx_rates`) take the client
 * swap but no user filter.
 */
export type Db = {
  client: SupabaseClient
  userId: string
}
