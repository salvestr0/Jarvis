# Lessons

Patterns worth not re-learning the hard way.

---

## `npm audit fix --force` is not a security tool

**What happened:** the fresh scaffold reported 12 high-severity vulnerabilities.
`npm audit fix --force` offered to "fix" them by installing **next@9.3.3** — a
version from 2020, hundreds of real security fixes behind the current one.

**Why it happens:** `audit` walks the whole dependency tree, including build and
lint tooling that never runs in production. When no compatible patch exists, its
only move is to downgrade the top-level package until the warning disappears.
It optimises for a clean report, not for you being safe.

**What the 12 actually were:**
- `minimatch` / `brace-expansion` DoS → inside ESLint. Dev-only, never ships.
- `postcss` → build-time only, and it only processes CSS we wrote ourselves.
- `sharp` (libvips CVEs) → image processing. We upload no images. Also has no
  patched version available yet; it ships inside Next.js.

**Rule:** before acting on an audit warning, ask three questions —
1. Does this package run in production, or only on my machine?
2. Can an attacker actually reach it with input they control?
3. What does the "fix" cost?

A clean `npm audit` is not the goal. Not being exploitable is.

---

## Read the framework's own docs before writing framework code

The scaffold generated an `AGENTS.md` saying "this is NOT the Next.js you know"
and pointing at `node_modules/next/dist/docs/`. Reading it caught two things
that would have produced code that compiles but breaks:

- `middleware.ts` → renamed to `proxy.ts`
- `cookies()` / `searchParams` → async only, sync access removed

Both are recent enough that most tutorials and most model training data still
show the old way. **Version-specific docs beat memory**, especially on a major
version bump.

---

## shadcn v4 is Base UI, not Radix — `render`, not `asChild`

**What happened:** wrote `<Button asChild><Link/></Button>`, the Radix pattern
that every shadcn tutorial online uses. TypeScript rejected it.

**Why:** shadcn v4 switched its primitives from Radix to Base UI
(`@base-ui/react`). Base UI does the same job with a different prop:

```tsx
// Radix (old, everywhere online)
<Button asChild><Link href="/x">Go</Link></Button>

// Base UI (what this project uses)
<Button render={<Link href="/x" />} nativeButton={false}>Go</Button>
```

`nativeButton={false}` matters — it tells Base UI the rendered element is an
`<a>`, not a `<button>`, so it applies the right accessibility attributes.

**Lesson:** when a component library's prop doesn't exist, check what's
actually in `package.json` before assuming your code is wrong. The answer was
in `node_modules/@base-ui/react/button/Button.d.ts` — type definitions are
documentation you always have locally, and they can't be out of date.

---

## Intl formats SGD as a bare "$" — write the symbol yourself

**What happened:** a test asserted `formatMoney(123456) === 'S$1,234.56'`.
It actually returned `'$1,234.56'`.

**Why:** `Intl.NumberFormat('en-SG', {currency:'SGD'})` drops the "S" because
inside Singapore, "$" is unambiguous. The app is not inside that assumption —
Phase 2 puts US stocks next to SGD cash, and a net worth screen showing
`$120.00` beside `$1,234.56` in two different currencies is actively
misleading.

**Fix:** format the *number* with Intl, and prepend the symbol from an
explicit map (`SGD -> S$`, `USD -> US$`).

**Lesson:** locale-aware formatting optimises for a reader who already knows
the context. A multi-currency screen has no such reader. This was only caught
because the test asserted the exact output string — a test that just checked
"contains 1,234.56" would have passed and shipped the bug.

---

## A 'use server' file may only export async functions

**What happened:** adding a transaction blew up with
`A "use server" file can only export async functions, found object.`

The cause was one line in `money/actions.ts`:

```ts
'use server'
export const emptyFormState = { error: null, ok: false }  // not a function
```

**Why the rule exists:** every export from a `'use server'` file becomes a
callable server endpoint that the browser can invoke by ID. A plain object
has no meaning as an endpoint, so Next.js refuses it outright.

Types are fine (`export type FormState` disappears at compile time). Values
are not. Constants go in a separate, ordinary file.

**The bigger lesson — a green build proves less than it looks like:**
`npm run build`, `tsc --noEmit`, and 9 passing unit tests ALL passed with this
bug present. It only surfaced when the form was actually rendered and
submitted in a browser.

Build success means "it compiled", not "it works". For anything behind a
login, the authenticated click-through is a separate, required verification
step — automated checks cannot reach that code path.

---

## Verify the guard, don't assume it

Auth code that compiles tells you nothing. Before calling Phase 0 done, the
app was actually run and `/money` was requested with no session to confirm a
`307 → /login`. That takes a minute and is the difference between "should be
protected" and "is protected."

---

## Fail closed, not open

`isAllowedEmail()` returns `false` when `ALLOWED_EMAIL` is unset. The lazy
version — treating "no allowlist configured" as "allow everyone" — turns a
missing environment variable into a fully public app holding your salary and
holdings. A misconfiguration should lock you out, not let strangers in.

---

## A pseudo-column must copy the real column's skeleton

**What happened:** the kanban board's "+ Add category" tile floated visibly
higher than the columns beside it. Real columns render a header row, then a
`mt-2 p-1` body; the add tile skipped straight to its dashed box, so its top
edge sat where its neighbours' headers were.

**Fix:** give the placeholder the same skeleton — a header-height spacer
(`h-7`) plus the identical body inset — instead of eyeballing margins.

**Lesson:** when a decorative element sits in a row of structured siblings,
alignment comes from copying their structure, not from custom spacing. Any
later change to the real column's header height then moves both together.
