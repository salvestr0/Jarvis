import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

import { getSupabasePublishableKey, getSupabaseUrl } from './env'

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Note `await cookies()` — in Next.js 16 the request APIs (cookies, headers,
 * params, searchParams) are async only. The old synchronous access was removed.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // Called from a Server Component, which cannot set cookies.
          // Safe to ignore: src/proxy.ts refreshes the session on every
          // request, so the cookie still stays current.
        }
      },
    },
  })
}
