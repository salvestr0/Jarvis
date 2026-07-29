/**
 * One-time mint of the Spotify refresh token (playback control + search).
 *
 *   npm run spotify:auth
 *
 * Reads SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET from .env.local (create an
 * app at developer.spotify.com/dashboard first — tasks/spotify-plan.md has
 * the checklist). Unlike Google, Spotify requires the redirect URI to be
 * pre-registered EXACTLY, so this uses a fixed port: the app must list
 * http://127.0.0.1:8888/callback as a Redirect URI.
 *
 * The token is printed rather than written: it must be hand-pasted into
 * Vercel anyway (same convention as scripts/google-auth.mjs).
 */

import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const PORT = 8888
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
].join(' ')

function loadEnvLocal() {
  const file = join(root, '.env.local')
  if (!existsSync(file)) return {}
  const env = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
  return env
}

const env = loadEnvLocal()
const clientId = env.SPOTIFY_CLIENT_ID
const clientSecret = env.SPOTIFY_CLIENT_SECRET

if (!clientId || !clientSecret) {
  console.error(
    'SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in .env.local first.\n' +
      'Create an app at developer.spotify.com/dashboard with redirect URI\n' +
      `${REDIRECT_URI} — see tasks/spotify-plan.md.`
  )
  process.exit(1)
}

const server = createServer()

server.on('error', (error) => {
  console.error(
    error?.code === 'EADDRINUSE'
      ? `Port ${PORT} is in use — close whatever holds it and rerun.`
      : `${error}`
  )
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', () => {
  const authUrl =
    'https://accounts.spotify.com/authorize?' +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
    })

  console.log('\nOpen this URL in your browser and approve the scopes\n' +
    '(read playback state, control playback, read your playlists):\n')
  console.log(authUrl + '\n')
  console.log('Waiting for the redirect...')

  server.on('request', async (req, res) => {
    const url = new URL(req.url, REDIRECT_URI)
    const code = url.searchParams.get('code')
    const denied = url.searchParams.get('error')
    if (!code && !denied) {
      res.end()
      return
    }

    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(
      denied ? 'Access denied — you can close this tab.' : 'Done — you can close this tab.'
    )
    server.close()

    if (denied) {
      console.error(`\nSpotify returned: ${denied}. Nothing was minted.`)
      process.exit(1)
    }

    try {
      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          code,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      })
      const payload = await tokenRes.json().catch(() => null)

      if (!tokenRes.ok || !payload?.refresh_token) {
        console.error(
          `\nToken exchange failed (HTTP ${tokenRes.status}): ${payload?.error ?? 'no refresh_token in response'}.`
        )
        process.exit(1)
      }

      console.log('\nSuccess. Paste this line into .env.local and add the same')
      console.log('value to the Vercel project env vars (then redeploy):\n')
      console.log(`SPOTIFY_REFRESH_TOKEN=${payload.refresh_token}\n`)
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })
})
