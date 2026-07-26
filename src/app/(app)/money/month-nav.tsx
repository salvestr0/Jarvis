import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { currentMonth, formatMonthLabel, shiftMonth } from '@/lib/date'

export function MonthNav({
  month,
  extraQuery = '',
}: {
  month: string
  /** Already-encoded params (e.g. active filters) to carry across months. */
  extraQuery?: string
}) {
  const prev = shiftMonth(month, -1)
  const next = shiftMonth(month, 1)
  const suffix = extraQuery ? `&${extraQuery}` : ''

  // Nothing has happened in the future yet, so don't offer to navigate there.
  const atCurrent = month >= currentMonth()

  return (
    <div className="flex items-center gap-2">
      {/* Base UI uses `render` (not Radix's `asChild`) to swap the element.
          nativeButton={false} tells it the result is an <a>, not a <button>. */}
      <Button
        render={<Link href={`/money?month=${prev}${suffix}`} aria-label="Previous month" />}
        nativeButton={false}
        variant="outline"
        size="sm"
      >
        ←
      </Button>

      <span className="min-w-[9rem] text-center text-sm font-medium">
        {formatMonthLabel(month)}
      </span>

      {atCurrent ? (
        <Button variant="outline" size="sm" disabled aria-label="Next month">
          →
        </Button>
      ) : (
        <Button
          render={<Link href={`/money?month=${next}${suffix}`} aria-label="Next month" />}
          nativeButton={false}
          variant="outline"
          size="sm"
        >
          →
        </Button>
      )}
    </div>
  )
}
