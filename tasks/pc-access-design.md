# PC Access — Design (28 Jul 2026)

Status: **design LOCKED 28 Jul 2026 — Jayden made the four calls (see
bottom). Nothing built yet; Phase A is next.**

## Why this needs a design, not a hack

Jarvis reads email (untrusted input) and has outbound channels (drafts,
events, web search). Add "run things on the PC" carelessly and a hostile
email becomes remote code execution: injected text → PC tool → exfiltration.
Every decision below exists to cut that chain somewhere.

## Architecture: outbound-only local agent

Vercel cannot reach the PC, and nothing on the PC will listen for it.

```
Telegram → Vercel (Jarvis tool) → INSERT pc_jobs ┐
                                                 │ Supabase Postgres
PC agent ──(Realtime websocket, outbound)────────┘
   │ executes locally, enforces ALL policy
   └─ UPDATE pc_jobs.result → Vercel poll picks it up → Telegram reply
```

- **`pc-agent/agent.mjs`** — small dependency-light Node script in this
  repo, run on the PC as Jayden's normal user (never admin). Opens an
  outbound websocket to Supabase Realtime for `pc_jobs` INSERTs, with a 5s
  polling fallback if the socket drops. No listening ports, no tunnel,
  nothing exposed to the internet.
- **`pc_jobs` table** — id, kind, payload jsonb, status
  (pending → running → done | error | refused), result jsonb, timestamps.
  One writer per column-family: Vercel only INSERTs jobs, the agent only
  writes status/result. Doubles as a permanent audit log — including
  refusals — so "what did you do on my PC this week?" is a query.
- **`pc_heartbeat`** — one row the agent touches every 30s. Tools treat
  \>90s stale as offline and answer "your PC is offline" immediately
  instead of hanging.
- **Result wait**: the Jarvis tool polls the row for up to ~25s. Longer
  jobs return the job id and a `pc_job_status` tool checks later.
- **Auth**: the agent gets its own long-lived JWT whose RLS policies allow
  ONLY the two `pc_*` tables. The Supabase service key never leaves
  Vercel. If the PC is ever compromised, the blast radius is the job
  queue, not the tracker data.
- **Cost**: data plane is agent↔Supabase direct — zero Vercel function
  invocations, Realtime is free-tier. No cron slots consumed (2-cap).

## Capability tiers

### Tier 1 — read-only (build first)

Tools: `pc_list_dir`, `pc_read_file` (200 KB cap, truncated flag, refuses
binary), `pc_search_files` (filename glob + content grep, capped results).

- **Root allowlist** in a PC-side `config.json` — e.g. Desktop, Documents,
  Downloads. Canonical-path resolution before every access so `..\` and
  symlink/junction tricks cannot escape the roots.
- **Secrets deny-list**, also PC-side: `.env*`, `*.pem`, `id_*`,
  `*secret*`, `*token*`, wallet files, browser profile dirs. The agent
  refuses and the refusal is logged.

### Tier 2 — named actions

An `actions.json` **on the PC** defines every action: name, exact command,
allowed argument enums (no free-form args), and a `needs_confirm` flag.
The cloud can only invoke by name — a compromised model/cloud cannot add,
edit, or parameterize actions. Candidate starter set: `open_app` (enum of
his apps), `screenshot`, `lock_screen`, `sleep`, `run_backup`.
`needs_confirm` actions reuse the existing delete-tier flow: explicit yes
in conversation, one action per yes.

### Tier 3 — arbitrary shell (only if Jayden insists)

Off by default via a PC-side `allow_shell: false` flag the cloud cannot
flip. If ever enabled: echo the exact command, delete-style confirmation,
one command per yes, 60s timeout, output capped.

## The injection→RCE chain, and where it gets cut

1. **Prompt layer** (shipped): email/web/search text is data, not
   instructions.
2. **Tool surface**: tier 1 cannot mutate anything; tier 2 is a fixed verb
   set with enum args.
3. **Confirmation**: anything that mutates the PC needs an explicit
   in-conversation yes.
4. **PC-side enforcement** (the backstop): roots, deny-list, actions.json,
   and the shell flag all live on the PC. Even a fully hijacked cloud
   session cannot expand its own capabilities.
5. **New prompt rule to ship with tier 1**: file contents never leave the
   PC — not into drafts, events, or web-search queries — unless Jayden
   explicitly asked for that in this conversation (anti-exfiltration).

## Ops

Manual start first: `npm run pc:agent` in a terminal; Jarvis works
gracefully when it's off. Task Scheduler auto-start is a later opt-in once
trusted. Agent logs to a local file, one line per job.

## Phases

- **A**: migration (pc_jobs, pc_heartbeat, RLS + scoped JWT), agent
  skeleton + heartbeat, tier 1 tools, path-sandbox + deny-list as pure
  tested modules, prompt rule, DEPLOY.md section. ~1 session.
- **B**: actions.json + `run_pc_action` + confirm flow.
- **C**: shell — only on explicit insistence, never by default.

## Decisions (Jayden, 28 Jul 2026)

1. **Read roots**: Desktop + Documents + Downloads.
2. **Tier-2 actions** (Phase B, after tier 1 proves out): open_app,
   screenshot (sent back via Telegram), lock_screen, sleep. Sleep/lock are
   `needs_confirm: false` (recoverable); nothing destructive in the set.
3. **Tier 3 shell**: later, if ever. Not built in this round; the agent
   ships with no shell code path until he insists.
4. **Startup**: manual — `npm run pc:agent` when wanted; auto-start is a
   later opt-in.

Note for Phase B: screenshot needs a delivery path (job result too big for
a jsonb row → upload to Supabase Storage or send straight to Telegram via
the bot API from Vercel after reading a temp upload). Design that when
Phase B starts.
