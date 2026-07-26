/**
 * Shown while a signed-in page fetches its data.
 *
 * Every page here is server-rendered per request, so without this the browser
 * sits on the old page with no feedback while the new one loads. Skeleton
 * blocks roughly match the real layout so the page doesn't visibly jump when
 * the data lands.
 */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="space-y-2">
        <div className="h-7 w-40 rounded-md bg-muted" />
        <div className="h-4 w-56 rounded bg-muted" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-lg border bg-muted/40" />
        ))}
      </div>

      <div className="h-56 rounded-lg border bg-muted/40" />
    </div>
  )
}
