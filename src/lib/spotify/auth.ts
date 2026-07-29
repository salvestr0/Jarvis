import 'server-only'

/**
 * Spotify OAuth for the bot — playback control and search.
 *
 * One long-lived refresh token (minted once with `npm run spotify:auth`) is
 * exchanged here for short-lived access tokens, cached in module scope and
 * refreshed 60s early — same shape as src/lib/google/auth.ts.
 *
 * Error messages must never include any token value.
 */

const TIMEOUT_MS = 12_000

let cached: { token: string; expiresAt: number } | null = null

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set — Spotify is not connected yet. Jayden has to run the setup in tasks/spotify-plan.md (npm run spotify:auth).`
    )
  }
  return value
}

export async function getAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token

  const clientId = requireEnv('SPOTIFY_CLIENT_ID')
  const clientSecret = requireEnv('SPOTIFY_CLIENT_SECRET')
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: requireEnv('SPOTIFY_REFRESH_TOKEN'),
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body,
      cache: 'no-store',
    })

    const payload = (await res.json().catch(() => null)) as {
      access_token?: string
      expires_in?: number
      error?: string
    } | null

    if (!res.ok || !payload?.access_token) {
      // "invalid_grant" means the refresh token was revoked — rerun
      // `npm run spotify:auth` to mint a new one.
      throw new Error(
        `Spotify token refresh failed (HTTP ${res.status}): ${payload?.error ?? 'no detail'}`
      )
    }

    cached = {
      token: payload.access_token,
      expiresAt: Date.now() + ((payload.expires_in ?? 3600) - 60) * 1000,
    }
    return cached.token
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Spotify token refresh timed out after ${TIMEOUT_MS / 1000}s`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Authenticated call against the Spotify Web API. Returns parsed JSON, or
 * null for the 204/empty responses the player endpoints use for success.
 */
export async function spotifyFetch(
  path: string,
  label: string,
  init?: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown }
): Promise<unknown> {
  const token = await getAccessToken()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`https://api.spotify.com/v1${path}`, {
      method: init?.method ?? 'GET',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    })

    if (!res.ok) {
      // Stale access token — drop the cache so the next call refreshes.
      if (res.status === 401) cached = null
      const detail = (await res.json().catch(() => null)) as {
        error?: { message?: string; reason?: string }
      } | null
      const reason = detail?.error?.reason ?? ''
      if (res.status === 403 && /premium/i.test(reason + (detail?.error?.message ?? ''))) {
        throw new Error(
          `${label}: Spotify says this needs a Premium account — playback control is Premium-only.`
        )
      }
      if (res.status === 404 && reason === 'NO_ACTIVE_DEVICE') {
        throw new Error(
          `${label}: no active Spotify device. Open Spotify somewhere first (e.g. pc_run_action open_app spotify), wait a moment, then retry.`
        )
      }
      throw new Error(
        `${label} returned HTTP ${res.status}${detail?.error?.message ? ` — ${detail.error.message}` : ''}`
      )
    }

    if (res.status === 204) return null
    const text = await res.text()
    return text ? JSON.parse(text) : null
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${label} timed out after ${TIMEOUT_MS / 1000}s`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
