import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedEmail } from '@/lib/supabase/env'
import type { Db } from '@/lib/queries/db'

/**
 * The bot's database handle: the service-role client scoped (in code, since
 * RLS doesn't apply to it) to the one allowed user.
 *
 * The webhook only knows a Telegram id; the Supabase user UUID is resolved by
 * matching ALLOWED_EMAIL against the auth user list. Cached after the first
 * lookup — it can't change without redeploying anyway.
 */
let cachedUserId: string | null = null

export async function getBotDb(): Promise<Db> {
  const client = createAdminClient()

  if (!cachedUserId) {
    const { data, error } = await client.auth.admin.listUsers()
    if (error) throw new Error(`Could not list users: ${error.message}`)

    // isAllowedEmail fails closed: with ALLOWED_EMAIL unset, nobody matches.
    const user = data.users.find((u) => isAllowedEmail(u.email))
    if (!user) {
      throw new Error(
        'No auth user matches ALLOWED_EMAIL — the bot has nobody to act for.'
      )
    }
    cachedUserId = user.id
  }

  return { client, userId: cachedUserId }
}
