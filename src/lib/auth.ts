import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { isAllowedEmail } from '@/lib/supabase/env'

/**
 * Returns the logged-in user, or redirects to /login.
 *
 * src/proxy.ts already guards these routes, but we check again here.
 * That's deliberate: the proxy protects the route, this protects the DATA.
 * If a page ever gets rendered outside the proxy's matcher, this still holds.
 */
export async function requireUser() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !isAllowedEmail(user.email)) {
    redirect('/login')
  }

  return user
}
