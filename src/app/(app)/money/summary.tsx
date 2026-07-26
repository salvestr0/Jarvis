import { Card, CardContent } from '@/components/ui/card'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { CategoryTotal, MonthSummary } from '@/lib/types'

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: string
  tone?: 'positive' | 'negative'
  hint?: string
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p
          className={cn(
            'mt-1 text-2xl font-semibold tabular-nums tracking-tight',
            tone === 'positive' && 'text-emerald-600 dark:text-emerald-400',
            tone === 'negative' && 'text-rose-600 dark:text-rose-400'
          )}
        >
          {value}
        </p>
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function MonthSummaryCards({ summary }: { summary: MonthSummary }) {
  const { incomeCents, expenseCents, netCents, count } = summary

  // Savings rate only means something if money actually came in.
  const savedPct =
    incomeCents > 0 ? Math.round((netCents / incomeCents) * 100) : null

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Stat
        label="Money in"
        value={formatMoney(incomeCents)}
        tone={incomeCents > 0 ? 'positive' : undefined}
      />
      <Stat
        label="Money out"
        value={formatMoney(expenseCents)}
        tone={expenseCents > 0 ? 'negative' : undefined}
      />
      <Stat
        label="Left over"
        value={formatMoney(netCents)}
        tone={netCents >= 0 ? 'positive' : 'negative'}
        hint={
          savedPct === null
            ? `${count} transaction${count === 1 ? '' : 's'}`
            : `You kept ${savedPct}% of what you earned`
        }
      />
    </div>
  )
}

/**
 * Category breakdown as labelled bars.
 *
 * A bar chart rather than a pie: comparing lengths along a shared baseline is
 * far easier to read accurately than comparing angles, especially once you
 * have more than about four categories.
 */
export function CategoryBreakdown({
  totals,
  title,
  tone,
}: {
  totals: CategoryTotal[]
  title: string
  tone: 'income' | 'expense'
}) {
  if (totals.length === 0) return null

  const max = Math.max(...totals.map((t) => t.totalCents))
  const sum = totals.reduce((acc, t) => acc + t.totalCents, 0)

  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="text-sm font-medium">{title}</h2>
        <ul className="mt-3 space-y-2.5">
          {totals.map((t) => {
            const share = sum > 0 ? Math.round((t.totalCents / sum) * 100) : 0
            return (
              <li key={t.categoryId ?? 'uncategorised'}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate">{t.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatMoney(t.totalCents)}
                    <span className="ml-1.5 text-xs">{share}%</span>
                  </span>
                </div>
                <div
                  className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                  role="presentation"
                >
                  <div
                    className={cn(
                      'h-full rounded-full',
                      tone === 'income' ? 'bg-emerald-500' : 'bg-rose-500'
                    )}
                    style={{
                      width: `${max > 0 ? (t.totalCents / max) * 100 : 0}%`,
                    }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
