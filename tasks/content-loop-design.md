# Content capture-and-draft loop — design

**Goal:** ideas stop dying in Jayden's head, and posts stop dying on the
blank page. Capture from anywhere via Telegram; Jarvis does the foggy 90%
(remembering, angle-finding, first draft) so shipping = edit + post.
Status: SPEC — awaiting Jayden's go.

**Why this feature exists (the actual problem):** Jayden's posting blocker
is brain fog and the courage to hit post — not a lack of ideas or value.
The tooling's job is to make the moment of shipping as small as possible:
a ready draft in his voice beats an empty compose box.

**Scope boundary:** this feeds his TEXT posts (build-in-public across
platforms). The YouTube channel ("The Automation Verdict") has its own
generated-video pipeline in Desktop/Youtube — out of scope here, though
video ideas captured in passing land in the same ideas inbox.

## The loop

```
capture (anytime)          nudge (evening)              ship (his part)
"content idea: …"    →     "you closed X and shipped    edit draft → post
voice note from bus        Y today — worth a post?      → tell Jarvis
"save that as an idea"     want a draft?"               "mark it posted"
        │                        │                            │
        ▼                        ▼                            ▼
   content_ideas  ────────  content_drafts  ──────────  status: posted
```

## Data (migration 0015)

```sql
create table content_ideas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  text       text not null check (length(text) between 1 and 2000),
  status     text not null default 'inbox'
             check (status in ('inbox', 'drafted', 'posted', 'dropped')),
  created_at timestamptz not null default now()
);

create table content_drafts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  idea_id    uuid references content_ideas (id) on delete set null,
  hook       text not null,          -- the first line; the scroll-stopper
  body       text not null,
  status     text not null default 'draft'
             check (status in ('draft', 'posted', 'dropped')),
  created_at timestamptz not null default now()
);
```

Two tables, deliberately: an idea is a raw spark (cheap, capture-friction
zero); a draft is a workable post (hook + body, ready to edit). RLS +
owner policies like everything else.

## Bot tools (5 new → 54)

- `save_content_idea(text)` — ADD tier, immediate. Prompt guidance: save
  when he explicitly shares an idea OR when he tells a story with obvious
  content value — but in the implicit case, offer first ("that's a post —
  want me to save it as an idea?"), never silently harvest his venting.
- `list_content_ideas()` — inbox first, newest first, with ids.
- `create_content_draft(hook, body, idea_id?)` — ADD tier. Jarvis writes
  the draft IN the conversation first, he reacts, then it saves. Marks the
  linked idea 'drafted'.
- `list_content_drafts(status?)` — default 'draft' (the to-ship pile).
- `set_content_status(kind: idea|draft, id, status)` — MODIFY tier
  ("mark it posted", "drop that one"). Zero-rows check as always.

## The drafting voice (this is the whole ballgame)

A dedicated voice block in the system prompt, applied whenever Jarvis
drafts (not model-invented per draft):

- First person, plain words, short lines. Telegram-plaintext format.
- Narrative + honesty + work ethic is the brand. Show the struggle and
  the receipts; a real loss outranks a polished win.
- Anti-gatekeeping angle SPARINGLY — only when it's genuinely the point.
- Hook is its own field and its own job: concrete and specific, no
  clickbait mechanics, no "I'm excited to announce".
- Banned: AI-slop tells (emoji bullet walls, "game-changer", "Here's the
  kicker", rhetorical-question chains), fake urgency, invented details.
  If a fact is missing, the draft says [ask: …] rather than making it up.
- Drafts are platform-agnostic v1; he adapts lengths per platform.

His stored facts feed this (they already carry brand guidance), and the
voice block is a constant in the repo he can read and edit.

## The evening nudge

A `kind='content_nudge'` reminder row (pipeline inherited wholesale from
reminders/weekly-review — third user of the kind column):

- Daily 21:30 SGT default. The row is the toggle, same as the weekly
  review: "cancel the content nudge" stops it; `npm run nudge:enable`
  re-seeds. Cadence changes = re-seed at another time.
- Composed, not canned: it looks at TODAY's receipts (tasks done, wins,
  metrics — the weekly-review gather, one-day window) and asks one
  pointed question: "You shipped the weekly review feature today — that's
  a post. Want a draft?" On an empty day it stays SHORT ("anything today
  worth capturing? one line is enough") — never guilt, never streak-shame.
- No follow-up if ignored. One nudge, then silence until tomorrow. The
  courage problem is not solved by nagging.
- His reply lands in normal bot conversation where the tools live —
  saveAssistantNote already gives the nudge context to the next turn.

## Explicitly out of scope (v1)

- Auto-posting to any platform (he ships manually — deliberate: the
  courage muscle is his to build; we just shrink the rep)
- Platform-specific variants, threads, image/video generation
- The YouTube pipeline (separate tooling)
- A web UI for ideas/drafts (Telegram is the surface; dashboard card v2)
- Analytics / post-performance tracking

## Decisions taken (flag if you disagree)

1. Nudge daily at 21:30 SGT, composed from the day's receipts, silent if
   ignored (vs weekdays-only, static text, or capture-only with no nudge)
2. Two tables (ideas vs drafts), not one with a kind column
3. Drafts platform-agnostic v1
4. Implicit idea-spotting OFFERS, explicit "save this" acts immediately
5. Voice block lives in the repo as an editable constant

## Build checklist

- [ ] 0015_content.sql + migrate + db:check
- [ ] src/lib/queries/content.ts (ideas + drafts CRUD, window filters)
- [ ] voice block constant + system-prompt wiring
- [ ] 5 tool schemas + execute cases
- [ ] deliver route: content_nudge branch (one-day gather + compose,
      digest-style fallback: a static question — the nudge must not die
      with the model API)
- [ ] scripts/enable-content-nudge.mjs + npm run nudge:enable
- [ ] verify gate, deploy, E2E: due-now nudge row + a full capture→draft
      round-trip from Telegram
