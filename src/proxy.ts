import type { NextRequest } from 'next/server'

import { updateSession } from '@/lib/supabase/proxy'

/**
 * Runs before every matched request.
 *
 * Note the name: in Next.js 16 the `middleware` file convention was renamed
 * to `proxy`. A file called middleware.ts still works but is deprecated.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  // Skip static assets and images — otherwise the auth check would run on
  // every CSS/JS/image request and block the page from even rendering.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
