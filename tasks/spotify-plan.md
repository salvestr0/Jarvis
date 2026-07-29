# Spotify control for Jarvis — plan

Decided 29 Jul 2026 (Jayden picked this over the Supabase export). Goal:
"play my Deep Focus playlist" from Telegram — real playback control on any
of his devices, not just the blind media key.

## Engineering judgment: engineered enough

Mirrors the Google integration exactly (env refresh token, module-cached
access token, one-time mint script). No DB, no new tables, no UI. Three
tools, not eight — pause/next/volume fold into one `spotify_control`.

## Architecture

- `src/lib/spotify/auth.ts` — refresh-token → access-token exchange
  (Basic auth), 60s-early cache, `spotifyFetch` helpers. Same shape as
  `src/lib/google/auth.ts`.
- `src/lib/spotify/player.ts` — search, play (with device fallback),
  queue, pause/resume/skip, volume, now-playing, my-playlists lookup.
- `scripts/spotify-auth.mjs` — one-time refresh-token mint, loopback
  flow on a FIXED port (Spotify requires the redirect URI to be
  pre-registered exactly): `http://127.0.0.1:8888/callback`.
- 3 new tools: `spotify_play` (search+play or resume; `queue: true` to
  queue instead), `spotify_control` (pause/resume/next/previous/volume),
  `spotify_now_playing`.
- Scopes: `user-read-playback-state user-modify-playback-state
  user-read-currently-playing playlist-read-private`.

## Behaviour decisions

- **Playlist requests check HIS playlists first** (case-insensitive
  contains on /me/playlists), then fall back to catalog search.
- **No active device**: pick the first available device automatically;
  if none, tell the model to open Spotify (e.g. `pc_run_action
  open_app spotify`) and retry — the two integrations compose.
- **Errors stay human**: 403 PREMIUM_REQUIRED → "needs Spotify Premium";
  missing env → "run npm run spotify:auth".
- Playback control endpoints need **Spotify Premium** (search and
  now-playing don't). If Jayden is on free tier, only play/pause via the
  PC media key keeps working — the tools will say so rather than fail
  cryptically.

## Jayden's setup steps (blocking — code ships inert until done)

1. https://developer.spotify.com/dashboard → Create app (name: Jarvis).
   - Redirect URI: `http://127.0.0.1:8888/callback` (must be exact)
   - API used: Web API
2. Copy Client ID + Client Secret into `.env.local`:
   `SPOTIFY_CLIENT_ID=...` / `SPOTIFY_CLIENT_SECRET=...`
3. `npm run spotify:auth` → approve in browser → paste the printed
   `SPOTIFY_REFRESH_TOKEN=...` into `.env.local`.
4. Add all three vars to Vercel env (production) and redeploy.

## Checklist

- [x] auth.ts
- [x] player.ts
- [x] mint script + npm script
- [x] tool schemas + execute cases + system-prompt mention
- [x] verify green
- [x] Jayden: dashboard app + mint token + Vercel env (done 29 Jul —
      token verified, his desktop visible as a device, prod redeployed)
- [x] E2E from Telegram (29 Jul: now-playing read + search-and-play both
      verified — "Now playing: Passionfruit — Drake"; he has Premium)
