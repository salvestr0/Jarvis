import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatMoney, formatPriceMicros } from '@/lib/money'
import { formatQuantity } from '@/lib/quantity'
import type { PortfolioTotals, Position } from '@/lib/queries/investments'

import { DeleteForm } from '@/components/delete-form'

import { removeHolding } from './actions'
import { HoldingDialog } from './holding-dialog'

/** Manual holdings go by their plan name; tickers speak for themselves. */
function displayName(p: Position): string {
  return p.kind === 'manual' ? (p.name ?? p.symbol) : p.symbol
}

/**
 * Gain or loss, shown with an arrow AND a sign — never colour alone.
 *
 * Green and red are only ~4.6 ΔE apart under protanopia (red-green colour
 * blindness), which makes them effectively the same colour for roughly 1 in 12
 * men. The arrow and the +/- carry the meaning; the colour is a bonus for
 * everyone else.
 */
function Delta({
  cents,
  pct,
  className,
}: {
  cents: number | null
  pct: number | null
  className?: string
}) {
  if (cents === null) {
    return <span className="text-muted-foreground">—</span>
  }

  const up = cents >= 0
  const color = up ? 'var(--viz-up)' : 'var(--viz-down)'

  return (
    <span className={className} style={{ color }}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>{' '}
      <span className="tabular-nums">
        {up ? '+' : '−'}
        {formatMoney(Math.abs(cents))}
      </span>
      {pct !== null ? (
        <span className="ml-1.5 text-xs tabular-nums">
          {up ? '+' : '−'}
          {Math.abs(pct).toFixed(1)}%
        </span>
      ) : null}
      <span className="sr-only">{up ? ' gain' : ' loss'}</span>
    </span>
  )
}

export function PortfolioSummary({
  totals,
  cashCents,
}: {
  totals: PortfolioTotals
  cashCents: number
}) {
  const netWorth = totals.marketValueCents + cashCents

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-medium text-muted-foreground">
            Investments value
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            {formatMoney(totals.marketValueCents)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cost {formatMoney(totals.costBasisCents)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-medium text-muted-foreground">
            Profit / loss
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            <Delta cents={totals.gainCents} pct={totals.gainPct} />
          </p>
          {totals.unpricedCount > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {totals.unpricedCount} holding
              {totals.unpricedCount === 1 ? '' : 's'} not priced yet
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Net worth</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            {formatMoney(netWorth)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Investments + {formatMoney(cashCents)} cash
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Allocation as horizontal bars, sorted by value.
 *
 * One measure across many assets, so this is a single series — the labels
 * carry identity and every bar shares one hue. A pie chart would ask you to
 * compare angles; bars on a shared baseline compare lengths, which people
 * read far more accurately.
 */
export function Allocation({ positions }: { positions: Position[] }) {
  const priced = positions
    .filter((p) => p.marketValueCents !== null && p.marketValueCents > 0)
    .sort((a, b) => (b.marketValueCents ?? 0) - (a.marketValueCents ?? 0))

  if (priced.length === 0) return null

  const total = priced.reduce((sum, p) => sum + (p.marketValueCents ?? 0), 0)
  const max = Math.max(...priced.map((p) => p.marketValueCents ?? 0))

  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="text-sm font-medium">Allocation</h2>
        <ul className="mt-3 space-y-2.5">
          {priced.map((p) => {
            const value = p.marketValueCents ?? 0
            const share = total > 0 ? (value / total) * 100 : 0
            return (
              <li key={p.id}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{displayName(p)}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatMoney(value)}
                    <span className="ml-1.5 text-xs">{share.toFixed(1)}%</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${max > 0 ? (value / max) * 100 : 0}%`,
                      backgroundColor: 'var(--viz-bar)',
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

export function PositionsTable({ positions }: { positions: Position[] }) {
  if (positions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <p className="text-sm font-medium">No holdings yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add your first crypto or stock position, then hit “Refresh prices”.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
            <TableHead className="hidden sm:table-cell">Quantity</TableHead>
            <TableHead className="hidden md:table-cell">Price</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Profit / loss</TableHead>
            <TableHead className="w-[7.5rem] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {positions.map((p) => (
            <TableRow key={p.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{displayName(p)}</span>
                  <Badge variant="secondary" className="hidden sm:inline-flex">
                    {p.kind === 'manual' ? 'plan' : p.kind}
                  </Badge>
                </div>
                {p.kind !== 'manual' ? (
                  <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">
                    {formatQuantity(p.quantity)} units
                  </p>
                ) : null}
              </TableCell>

              <TableCell className="hidden tabular-nums text-muted-foreground sm:table-cell">
                {p.kind === 'manual' ? '—' : formatQuantity(p.quantity)}
              </TableCell>

              <TableCell className="hidden tabular-nums text-muted-foreground md:table-cell">
                {p.kind === 'manual' ? (
                  <span title="Value comes from your statement — edit the holding to update it">
                    self-tracked
                  </span>
                ) : p.priceMicros === null ? (
                  <span title="Hit Refresh prices">not priced</span>
                ) : (
                  <>
                    {formatPriceMicros(p.priceMicros, p.price_currency)}
                    <span className="ml-1 text-xs">({p.priceAsOf})</span>
                  </>
                )}
              </TableCell>

              <TableCell className="text-right font-medium tabular-nums whitespace-nowrap">
                {p.marketValueCents === null
                  ? '—'
                  : formatMoney(p.marketValueCents)}
              </TableCell>

              <TableCell className="text-right whitespace-nowrap">
                <Delta cents={p.gainCents} pct={p.gainPct} />
              </TableCell>

              <TableCell className="text-right whitespace-nowrap">
                <HoldingDialog
                  existing={p}
                  trigger={
                    <Button variant="ghost" size="sm">
                      Edit
                    </Button>
                  }
                />
                <DeleteForm
                  action={removeHolding}
                  id={p.id}
                  confirmText="Delete this holding? This cannot be undone."
                  successMessage="Holding deleted"
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
