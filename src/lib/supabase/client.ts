import { createBrowserClient } from '@supabase/ssr'

import { getSupabasePublishableKey, getSupabaseUrl } from './env'

/**
 * Supabase client for use in Client Components (code that runs in the browser).
 *
 * This uses the publishable key, which is safe to expose. The reason it's safe:
 * Row Level Security (RLS) is enabled on every table, so the database itself
 * refuses to return rows that don't belong to the logged-in user. The key alone
 * gets an attacker nothing.
 */
export function createClient() {
  return createBrowserClient(getSupabaseUrl(), getSupabasePublishableKey())
}
