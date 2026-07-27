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

## 7. The Telegram bot (Phase 2)

Four more environment variables (all environments, same as step 4 — and the
same rule applies: **server-only, never `NEXT_PUBLIC_`**):

| Name | Where it comes from |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |
| `TELEGRAM_BOT_TOKEN` | Message @BotFather on Telegram → /newbot |
| `TELEGRAM_WEBHOOK_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `TELEGRAM_USER_ID` | Message @userinfobot on Telegram — your numeric id |

Then:

1. `npm run db:migrate` from your machine (migration `0006_chat.sql` — the
   bot's conversation memory).
2. Add the four variables to Vercel and deploy.
3. `npm run telegram:setup` — registers the webhook at
   `<your-app>/api/telegram` with the secret. It prints `getWebhookInfo` so
   you can see it stuck.
4. Message your bot: *"what's my net worth?"*, *"log $12 lunch"*.

The route answers Telegram instantly and finishes the Claude call afterwards
(`after()` + Vercel Fluid Compute) — if replies ever stop mid-sentence, check
that Fluid Compute is enabled in the project settings before suspecting code.

If the bot doesn't reply: **Deployments → Functions** logs, lines starting
`[telegram]`. `getWebhookInfo` (rerun the setup script) shows Telegram's side
of the story, including its last delivery error.

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
