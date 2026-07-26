# Setup — do this once

Roughly 10 minutes. You need a free Supabase account.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com> → sign in → **New project**
2. Name: `jarvis-tracker`
3. **Region: Southeast Asia (Singapore)** — closest to you, so the app feels fast
4. Set a database password and save it in your password manager. You won't
   need it for this app, but losing it is annoying later.
5. Wait ~2 minutes for it to provision.

---

## 2. Copy your two keys

In the dashboard: **Project Settings → API**

| Dashboard label | Goes into |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| Publishable key (or "anon public" on older projects) | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |

Open `.env.local` in this folder and paste them in.

> **Do not touch the `service_role` key yet.** It ignores all database security
> rules — anyone who has it owns your entire database. We only need it in
> Phase 2, and it goes in a server-only variable then.

---

## 3. Lock the front door

Still in Supabase: **Authentication → Sign In / Providers → Email**

- Turn **OFF** "Allow new users to sign up"

This matters. By default a Supabase project lets *anyone on the internet*
create an account. Turning this off means the only account that can ever exist
is the one you make by hand in the next step.

The app also checks your email against `ALLOWED_EMAIL` on every request, so
there are two independent locks. That's intentional — one lock is a single
point of failure.

---

## 4. Create your account by hand

**Authentication → Users → Add user → Create new user**

- Email: the same address as `ALLOWED_EMAIL` in `.env.local`
- Password: pick a strong one, save it in your password manager
- Tick **Auto Confirm User** (otherwise you'll wait on a confirmation email)

---

## 5. Run it

```bash
npm run dev
```

Open <http://localhost:3000> — you should be bounced to `/login`.
Sign in with the account you just made. You should land on the dashboard.

### If something breaks

| What you see | What it means |
|---|---|
| `Missing NEXT_PUBLIC_SUPABASE_URL` | `.env.local` is empty or you didn't restart `npm run dev` after editing it |
| `Incorrect email or password` but you're sure it's right | The email doesn't match `ALLOWED_EMAIL` exactly, or the user wasn't auto-confirmed |
| Redirect loop on `/login` | `ALLOWED_EMAIL` is blank — it fails closed on purpose |

Environment variables are only read when the server **starts**. Always restart
`npm run dev` after editing `.env.local`.
