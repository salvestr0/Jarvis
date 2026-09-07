# Deploying to Vercel

Gets you a URL you can open on your phone, plus the daily price job.
About 15 minutes. Free.

---

## Before you start

```bash
npm run verify   # check:actions + typecheck + 20 tests + build
npm run audit    # secrets, browser bundle, service-role placement
npm run db:check # every table has RLS and a policy
```

All three must pass. If `audit` fails, **stop** — it is telling you something
would be publicly readable.

---

## 1. One thing you need from Supabase

The scheduled price job runs with no user logged in, so it can't use the normal
browser key. It needs the **service role** key.

**Project Settings → API → `service_role`** (you'll have to click "reveal").

Put it in `.env.local`:

```
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

> This key **ignores every security rule** in your database. Anyone holding it
> can read and write everything. It is used by exactly one file
> (`src/lib/supabase/admin.ts`), which is marked `server-only` so the build
> fails if it's ever imported into browser code. `npm run audit` checks both.
>
> Never paste it into a chat, a commit, or a screenshot.

Then confirm the cron works locally:

```bash
npm run dev
# in another terminal:
curl -H "Authorization: Bearer $(grep '^CRON_SECRET=' .env.local | cut -d= -f2-)" \
  http://localhost:3000/api/cron/prices
```

You want `{"ok":true,...}`.

---

## 2. Push to GitHub

The repo is already initialised locally. Create an **empty private repo** on
GitHub, then:

```bash
git add -A
git commit -m "Jarvis tracker: money, investments, career, projects"
git remote add origin https://github.com/<you>/jarvis-tracker.git
git push -u origin main
```

**Private, not public.** Nothing secret is committed — `npm run audit` proves
that — but there's no reason to publish the shape of your finances.

---

## 3. Import to Vercel

1. <https://vercel.com/new> → import the repo
2. Framework preset: **Next.js** (auto-detected)
3. **Don't deploy yet** — add the environment variables first, or the first
   build will fail and confuse you

---

## 4. Environment variables

**Settings → Environment Variables.** Add each for *all* environments
(Production, Preview, Development):

| Name | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | from `.env.local` | safe in the browser |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | from `.env.local` | safe in the browser — RLS protects it |
| `ALLOWED_EMAIL` | your email | the only account that can sign in |
| `FINNHUB_API_KEY` | from `.env.local` | server-only |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 1 | **server-only, never NEXT_PUBLIC_** |
| `CRON_SECRET` | from `.env.local` | Vercel sends this to the cron route |

**Do NOT add `SUPABASE_DB_URL`.** That's the full database password, and it's
only used by `npm run db:migrate`, which you run from your own machine. The
deployed app never needs it. Every variable you don't upload is one that can't
leak.

Then **Deploy**.

---

## 5. Check it

1. Open the URL → you should be bounced to `/login`
2. Sign in → dashboard loads
3. Open it on your phone. Add it to your home screen.

Test the cron by hand (find `CRON_SECRET` in your `.env.local`):

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" \
  https://<your-app>.vercel.app/api/cron/prices
```

Expect `{"ok":true,"pricesWritten":N,...}`. Without the header you should get
`401` — try it, it's worth seeing.

---

## 6. The daily job

`vercel.json` already schedules it:

```json
{ "crons": [{ "path": "/api/cron/prices", "schedule": "0 1 * * *" }] }
```

`0 1 * * *` is **01:00 UTC = 09:00 Singapore**. It fetches crypto and stock
prices, the USD→SGD rate, and records a net worth snapshot.

That snapshot is what fills in the dashboard chart — after a few days it
becomes a real trend line instead of "not enough history".

Check runs under **Deployments → Cron Jobs**. On Vercel's free Hobby plan cron
runs **once per day**, which is exactly what this needs.

---

## 7. Hermes Cloud + Telegram (Phase 2)

The production assistant runs on Hermes Cloud. Vercel keeps the dashboard,
Supabase access, and a private MCP endpoint with the 15 core Jarvis tools.

Generate a 32-byte secret and add it to Vercel for Production and Preview:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Name | Where it goes |
|---|---|
| `JARVIS_MCP_SECRET` | Vercel and the Hermes MCP `Authorization` header |

After deploying, verify the unauthenticated endpoint returns `401`. Then add
this HTTP MCP server to the Hermes Cloud profile and test it before enabling
Telegram:

```yaml
mcp_servers:
  jarvis:
    url: "https://jarvis-theta-umber-27.vercel.app/api/mcp"
    headers:
      Authorization: "Bearer ${JARVIS_MCP_SECRET}"
    sampling:
      enabled: false
    tools:
      prompts: false
      resources: false
```

Keep the secret in Hermes's `.env`, not literally in `config.yaml`. A successful
MCP test must list exactly 15 tools and no delete/archive capability.

Configure Hermes Telegram with the existing bot token and only your numeric
user id. A Telegram bot token can have only one active consumer, so cut over in
this order:

1. Deploy and test `/api/mcp` without changing Telegram.
2. Add and test the MCP server on Hermes Cloud.
3. Disable the Vercel webhook with Telegram `deleteWebhook`.
4. Configure the existing bot token and allowed user id on Hermes Cloud.
5. Send read-only smoke tests first: net worth, month summary, tasks.
6. Log one small test transaction and verify it in the dashboard.

The former Vercel Telegram route remains as a rollback path. Do not run it at
the same time as Hermes Telegram. To roll back, disable Telegram on Hermes and
rerun `npm run telegram:setup`.

Legacy Vercel bot variables (needed only for rollback):

| Name | Where it comes from |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |
| `TELEGRAM_BOT_TOKEN` | Message @BotFather on Telegram → /newbot |
| `TELEGRAM_WEBHOOK_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `TELEGRAM_USER_ID` | Message @userinfobot on Telegram — your numeric id |

Conversation history after cutover lives in Hermes Cloud. Existing
`chat_messages` rows stay in Supabase as legacy history; they are not silently
copied into the new agent session.

---

## 8. Phase 3 — Google + the morning digest

Jarvis reads your Google Calendar and Gmail, can create calendar events and
Gmail drafts, and sends a morning briefing on Telegram. Behavior is
controlled at **/settings** in the web app.

### One-time Google setup

1. [console.cloud.google.com](https://console.cloud.google.com) → new project
   (e.g. `jarvis-personal`).
2. **APIs & Services → Library** → enable **Google Calendar API** and
   **Gmail API**.
3. **OAuth consent screen** → External → app name "Jarvis", your Gmail
   everywhere it asks for an email.
4. **Publish the app to "In production"** (Publishing status → Publish app).
   It stays *unverified* — fine for personal use. **Do not skip this**: in
   Testing mode, refresh tokens expire after 7 days and the digest silently
   dies a week in.
5. **Credentials → Create credentials → OAuth client ID → Desktop app** →
   copy the Client ID and Client secret into `.env.local`.
6. `npm run google:auth` → open the printed URL → sign in with the Google
   account whose calendar/email Jarvis should use → "Advanced → continue"
   past the unverified warning → allow the four scopes → paste the printed
   `GOOGLE_REFRESH_TOKEN=` line into `.env.local`.

The scopes are `calendar.readonly`, `gmail.readonly`, `calendar.events`
(create/edit events), and `gmail.compose` (manage drafts). Jarvis's tools
only ever CREATE events and drafts — nothing can send mail or delete
anything. A draft sits in Gmail until you send it yourself.

**Re-consent (when scopes change):** the refresh token is bound to the
scopes it was minted with, so after any scope change rerun
`npm run google:auth`, replace `GOOGLE_REFRESH_TOKEN` in `.env.local` AND in
Vercel (Settings → Environment Variables), then redeploy. A write tool
failing with HTTP 403 while reads still work means the token predates the
write scopes.

### Deploy

Three more Vercel env vars (server-only, never `NEXT_PUBLIC_`):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.

Then `npm run db:migrate` (migration `0007_settings.sql`) and push. The new
cron in `vercel.json` registers on deploy — **Settings → Cron Jobs** should
show two:

| Path | Schedule | What |
|---|---|---|
| `/api/cron/prices` | 01:00 UTC (09:00 SGT) | Prices + net worth snapshot |
| `/api/cron/digest` | 02:00 UTC (10:00 SGT) | Morning briefing to Telegram |

The digest deliberately runs an hour after prices: Hobby crons can fire up to
~59 minutes late, and the briefing should see today's numbers. (Hobby also
caps you at two cron jobs — these are both slots.)

Test it by hand:

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" \
  https://<your-app>.vercel.app/api/cron/digest
```

Expect `{"ok":true,...}` with a report, and the briefing on your phone.
Digest behavior (every morning / only when noteworthy / off, and which
sections it covers) lives at **/settings**.

---

## 9. Voice notes

Send Jarvis a voice message instead of typing. Claude's API doesn't take
audio, so transcription runs through Groq (Whisper large-v3-turbo) — free
tier, no credit card.

1. Sign up at [console.groq.com](https://console.groq.com) → **API Keys** →
   create one.
2. Put it in `.env.local` as `GROQ_API_KEY`, and add the same value to the
   Vercel project (server-only, never `NEXT_PUBLIC_`).

Jarvis echoes what it heard (`🎤 "log twelve dollars lunch"`) before acting,
so a mis-heard amount is visible before it becomes a transaction. Notes
longer than 5 minutes are refused. Leaving the key blank disables voice
without affecting anything else.

---

## 10. PC access

Jarvis can list, read, and search files in **Desktop, Documents, and
Downloads**, and run a fixed set of actions — **screenshot** (delivered to
Telegram), **open_app**, **lock_screen**, **sleep** — via a local agent,
only while it is running. Design and threat model:
`tasks/pc-access-design.md`.

Actions are defined in `pc-agent/actions.json` ON the PC: every runnable
thing is a literal command array (no templates, no shell), so the cloud can
invoke by name but never define or reshape a command. Edit that file to
add/remove apps; the agent validates it at startup.

One-time setup:

1. `npm run db:migrate` (migration `0009_pc_access.sql` — tables + the
   boxed `pc_agent` database role).
2. `npm run pc:setup` → paste the printed `PC_AGENT_DB_URL=` line into
   `.env.local`. **Never add this one to Vercel** — it belongs to the PC
   only. It can touch nothing but the two `pc_*` tables.
3. No new Vercel env vars, no deploy config — just push.

Run it when you want PC access on:

```bash
npm run pc:agent
```

Ctrl-C stops it; Jarvis reports "PC offline" within 90 seconds. The agent
opens no ports — it only connects out to the database. Folder allowlist and
the secrets deny-list live in `pc-agent/config.json` and
`pc-agent/sandbox.mjs` on the PC, so nothing cloud-side can widen them.
Every job, including refusals, stays in `pc_jobs` — ask Jarvis "what did
you do on my PC this week?" to audit.

---

## After every change

```bash
npm run verify && npm run audit
git push        # Vercel deploys automatically
```

New database tables? `npm run db:migrate` from your machine first, then
`npm run db:check` to confirm RLS came out right.

---

## If something breaks

| Symptom | Cause |
|---|---|
| Build fails, "Missing NEXT_PUBLIC_SUPABASE_URL" | env var not added, or not applied to Production |
| Login works locally, fails deployed | `ALLOWED_EMAIL` not set in Vercel, or a typo |
| Cron returns 401 | `CRON_SECRET` differs between Vercel and your request |
| Cron returns 500 "SERVICE_ROLE_KEY is not set" | that variable wasn't added |
| Prices never update | check Deployments → Cron Jobs for the run log |

Function logs: **Deployments → your deployment → Functions**. The cron logs a
line starting `[cron/prices]` on every run.
