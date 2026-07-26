import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateLabel, todayISO } from '@/lib/date'
import { formatMoney, formatSigned, monthlyEquivalentCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { Category, RecurringRow } from '@/lib/types'

import { DeleteForm } from '@/components/delete-form'

import { RecurringDialog } from './recurring-dialog'
import { RecurringLogForm } from './recurring-log-form'
import { removeRecurring } from './recurring-actions'

const CADENCE_LABELS = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
} as const

export function RecurringSection({
  rows,
  categories,
  filtered = false,
}: {
  rows: RecurringRow[]
  categories: Category[]
  /** True when the page has active filters — changes the empty-state message. */
  filtered?: boolean
}) {
  const today = todayISO()

  // What your commitments cost per month, with yearly and weekly amounts
  // converted — the number that tells you your true fixed burn rate.
  const fixedCostsCents = rows
    .filter((r) => r.direction === 'expense')
    .reduce((acc, r) => acc + monthlyEquivalentCents(r.amount_cents, r.cadence), 0)

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Recurring</h2>
          <p className="text-xs text-muted-foreground">
            Subscriptions, insurance and other fixed costs.
            {fixedCostsCents > 0
              ? ` Adds up to ${formatMoney(fixedCostsCents)}/month.`
              : ''}
          </p>
        </div>
        <RecurringDialog
          categories={categories}
          trigger={
            <Button variant="outline" size="sm">
              Add recurring
            </Button>
          }
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm font-medium">
            {filtered ? 'No recurring payments match' : 'No recurring payments yet'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {filtered
              ? 'Try clearing a filter or two.'
              : 'Add your subscriptions and insurance to see your fixed monthly costs — and log each bill in one click when it’s due.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Category</TableHead>
                <TableHead>Repeats</TableHead>
                <TableHead>Next due</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden text-right md:table-cell">
                  ≈ / month
                </TableHead>
                <TableHead className="w-[15rem] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const isDue = row.next_due !== null && row.next_due <= today
                return (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-[12rem] truncate font-medium">
                      {row.name}
                    </TableCell>

                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {row.category_name ?? 'Uncategorised'}
                    </TableCell>

                    <TableCell className="text-muted-foreground">
                      {CADENCE_LABELS[row.cadence]}
                    </TableCell>

                    <TableCell className="whitespace-nowrap">
                      <span className="text-muted-foreground">
                        {row.next_due ? formatDateLabel(row.next_due) : '—'}
                      </span>
                      {isDue ? (
                        <Badge variant="destructive" className="ml-2">
                          due
                        </Badge>
                      ) : null}
                    </TableCell>

                    <TableCell
                      className={cn(
                        'whitespace-nowrap text-right font-medium tabular-nums',
                        row.direction === 'income'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      )}
                    >
                      {formatSigned(row.amount_cents, row.direction, row.currency)}
                    </TableCell>

                    <TableCell className="hidden whitespace-nowrap text-right tabular-nums text-muted-foreground md:table-cell">
                      {formatMoney(
                        monthlyEquivalentCents(row.amount_cents, row.cadence),
                        row.currency
                      )}
                    </TableCell>

                    <TableCell className="whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-1">
                        <RecurringLogForm id={row.id} />
                        <RecurringDialog
                          categories={categories}
                          existing={row}
                          trigger={
                            <Button variant="ghost" size="sm">
                              Edit
                            </Button>
                          }
                        />
                        <DeleteForm
                          action={removeRecurring}
                          id={row.id}
                          confirmText={`Delete "${row.name}"? Past transactions it logged are kept.`}
                          successMessage="Recurring payment deleted"
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
