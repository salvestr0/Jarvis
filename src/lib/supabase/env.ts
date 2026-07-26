/**
 * Central place to read Supabase config.
 *
 * Why this file exists: Supabase renamed the browser-safe key from
 * "anon key" to "publishable key". Depending on how old your project is,
 * the dashboard shows one name or the other. We accept either so you never
 * get a confusing "undefined key" error just because of naming.
 *
 * SECURITY: only these two values are allowed to reach the browser.
 * The service role key is read separately, server-side only, in
 * src/lib/supabase/admin.ts — never here.
 */

export function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL. Copy .env.local.example to .env.local and fill it in.'
    )
  }
  return url
}

export function getSupabasePublishableKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY). ' +
        'Copy .env.local.example to .env.local and fill it in.'
    )
  }
  return key
}

/**
 * The only email allowed to use this app.
 *
 * This is defence-in-depth. You should ALSO turn off public signups in the
 * Supabase dashboard (Authentication > Sign In / Providers > disable
 * "Allow new users to sign up"). This constant means that even if a user
 * somehow gets created, they still cannot use the app.
 */
export function getAllowedEmail(): string {
  return (process.env.ALLOWED_EMAIL ?? '').trim().toLowerCase()
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  const allowed = getAllowedEmail()
  // Fail closed: if no allowlist is configured, nobody gets in.
  if (!allowed) return false
  if (!email) return false
  return email.trim().toLowerCase() === allowed
}
