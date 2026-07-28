import 'server-only'

/**
 * Google OAuth for the bot — Calendar and Gmail (read, plus event-create and
 * draft-create; nothing here can send mail or delete).
 *
 * One long-lived refresh token (minted once with `npm run google:auth`) is
 * exchanged here for short-lived access tokens. The access token is cached in
 * module scope: on Vercel Fluid Compute warm invocations reuse it, cold ones
 * just refresh. Refreshed 60s early so a token never dies mid-request.
 *
 * Error messages must never include any token value.
 */

const TIMEOUT_MS = 12_000

let cached: { token: string; expiresAt: number } | null = null

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set. Run the Google setup in DEPLOY.md first.`)
  }
  return value
}

export async function getAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token

  const body = new URLSearchParams({
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
    refresh_token: requireEnv('GOOGLE_REFRESH_TOKEN'),
    grant_type: 'refresh_token',
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
    })

    const payload = (await res.json().catch(() => null)) as {
      access_token?: string
      expires_in?: number
      error?: string
    } | null

    if (!res.ok || !payload?.access_token) {
      // "invalid_grant" here means the refresh token was revoked or expired —
      // rerun `npm run google:auth` to mint a new one.
      throw new Error(
        `Google token refresh failed (HTTP ${res.status}): ${payload?.error ?? 'no detail'}`
      )
    }

    cached = {
      token: payload.access_token,
      expiresAt: Date.now() + ((payload.expires_in ?? 3600) - 60) * 1000,
    }
    return cached.token
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Google token refresh timed out after ${TIMEOUT_MS / 1000}s`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** Authenticated GET against a Google API, house fetch style. */
export async function googleGet(url: string, label: string): Promise<unknown> {
  return googleFetch(url, undefined, label)
}

/** Authenticated POST with a JSON body — used by the write tools. */
export async function googlePost(
  url: string,
  body: unknown,
  label: string
): Promise<unknown> {
  return googleFetch(url, body, label)
}

async function googleFetch(
  url: string,
  body: unknown | undefined,
  label: string
): Promise<unknown> {
  const token = await getAccessToken()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    })

    if (!res.ok) {
      // A 401 means the access token went stale early — drop the cache so the
      // next call refreshes instead of failing for up to an hour.
      if (res.status === 401) cached = null
      // A 403 on a write means the refresh token predates the write scopes —
      // rerun `npm run google:auth` and update GOOGLE_REFRESH_TOKEN.
      if (res.status === 403 && body !== undefined) {
        throw new Error(
          `${label} returned HTTP 403 — the Google token may lack write scopes (rerun npm run google:auth)`
        )
      }
      throw new Error(`${label} returned HTTP ${res.status}`)
    }
    return await res.json()
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${label} timed out after ${TIMEOUT_MS / 1000}s`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
