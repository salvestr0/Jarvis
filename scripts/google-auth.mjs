/**
 * One-time mint of the Google refresh token (read-only Calendar + Gmail).
 *
 *   npm run google:auth
 *
 * Reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from .env.local (create a
 * Desktop-app OAuth client first — DEPLOY.md has the checklist). Runs the
 * loopback flow: prints an auth URL, you approve in the browser, Google
 * redirects to a local server, the code is exchanged, and the refresh token
 * is printed ONCE for you to paste into .env.local and Vercel.
 *
 * The token is printed rather than written: it must be hand-pasted into
 * Vercel anyway, and appending to .env.local would silently collide with an
 * existing empty GOOGLE_REFRESH_TOKEN= line.
 */

import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
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
const clientId = env.GOOGLE_CLIENT_ID
const clientSecret = env.GOOGLE_CLIENT_SECRET

if (!clientId || !clientSecret) {
  console.error(
    'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env.local first.\n' +
      'Create a Desktop-app OAuth client at console.cloud.google.com — see DEPLOY.md.'
  )
  process.exit(1)
}

const server = createServer()

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  const redirectUri = `http://127.0.0.1:${port}`

  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      // Both required for a refresh token to be issued.
      access_type: 'offline',
      prompt: 'consent',
    })

  console.log(
    '\nOpen this URL in your browser and approve the two read-only scopes:\n'
  )
  console.log(authUrl + '\n')
  console.log('(If Google warns the app is unverified: Advanced -> continue.)\n')
  console.log('Waiting for the redirect...')

  server.on('request', async (req, res) => {
    const url = new URL(req.url, redirectUri)
    // Browsers also request /favicon.ico — ignore anything without params.
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
      console.error(`\nGoogle returned: ${denied}. Nothing was minted.`)
      process.exit(1)
    }

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      })
      const payload = await tokenRes.json().catch(() => null)

      if (!tokenRes.ok || !payload?.refresh_token) {
        console.error(
          `\nToken exchange failed (HTTP ${tokenRes.status}): ${payload?.error ?? 'no refresh_token in response'}.\n` +
            'If there was no refresh_token, revoke Jarvis at myaccount.google.com/permissions and rerun.'
        )
        process.exit(1)
      }

      console.log('\nSuccess. Paste this line into .env.local (replacing the empty one)')
      console.log('and add the same value to the Vercel project env vars:\n')
      console.log(`GOOGLE_REFRESH_TOKEN=${payload.refresh_token}\n`)
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })
})
