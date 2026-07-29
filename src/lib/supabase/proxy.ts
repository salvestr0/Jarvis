import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { getSupabasePublishableKey, getSupabaseUrl, isAllowedEmail } from './env'

/**
 * Paths reachable without being logged in.
 *
 * `/api/cron` is here because the scheduled price job has no user session —
 * it authenticates itself with a bearer secret inside the route handler.
 * `/api/telegram` is the same story: Telegram authenticates itself with the
 * X-Telegram-Bot-Api-Secret-Token header inside the route handler.
 * Being listed here does NOT make them public: both routes reject requests
 * without the correct secret, and refuse to run at all when unconfigured.
 */
// `/api/reminders` likewise: the deliver endpoint requires Bearer CRON_SECRET.
const PUBLIC_PATHS = ['/login', '/auth', '/api/cron', '/api/telegram', '/api/reminders']

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  )
}

/**
 * Refreshes the auth session on every request and guards private routes.
 *
 * Two jobs:
 *  1. Keep the login cookie fresh, so you don't get randomly logged out.
 *  2. Bounce anyone who isn't you to /login.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: do not put code between createServerClient and getUser().
  // Anything that delays this call can desync the cookie and log you out
  // at random — a genuinely miserable bug to track down.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Logged in but not the allowlisted email: sign them out immediately.
  // This is the second lock on the door, after disabling public signups
  // in the Supabase dashboard.
  if (user && !isAllowedEmail(user.email)) {
    await supabase.auth.signOut()
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('error', 'not_authorized')
    return NextResponse.redirect(url)
  }

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Already logged in and sitting on /login? Send them to the dashboard.
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // Must return this exact response object so the refreshed cookies survive.
  return supabaseResponse
}
