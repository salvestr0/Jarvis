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
import { formatDayLabel } from '@/lib/date'
import { formatSigned } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { Account, Category, TransactionRow } from '@/lib/types'

import { DeleteForm } from '@/components/delete-form'

import { removeTransaction } from './actions'
import { TransactionDialog } from './transaction-dialog'

export function TransactionTable({
  rows,
  categories,
  accounts,
  month,
  filtered = false,
}: {
  rows: TransactionRow[]
  categories: Category[]
  accounts: Account[]
  month: string
  /** True when the page has active filters — changes the empty-state message. */
  filtered?: boolean
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <p className="text-sm font-medium">
          {filtered ? 'Nothing matches your filters' : 'Nothing logged this month'}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {filtered
            ? 'Try clearing a filter or two.'
            : 'Add your first transaction and it will show up here.'}
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[5.5rem]">Date</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="hidden sm:table-cell">Note</TableHead>
            <TableHead className="hidden sm:table-cell">Account</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="w-[7.5rem] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatDayLabel(row.occurred_on)}
              </TableCell>

              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="truncate">
                    {row.category_name ?? 'Uncategorised'}
                  </span>
                  {row.direction === 'income' ? (
                    <Badge variant="secondary" className="hidden md:inline-flex">
                      in
                    </Badge>
                  ) : null}
                </div>
                {/* Note is hidden as its own column on phones, so surface it here */}
                {row.note ? (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground sm:hidden">
                    {row.note}
                  </p>
                ) : null}
              </TableCell>

              <TableCell className="hidden max-w-[16rem] truncate text-muted-foreground sm:table-cell">
                {row.note ?? '—'}
              </TableCell>

              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {row.account_name ?? '—'}
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

              <TableCell className="text-right whitespace-nowrap">
                <TransactionDialog
                  categories={categories}
                  accounts={accounts}
                  month={month}
                  existing={row}
                  trigger={
                    <Button variant="ghost" size="sm">
                      Edit
                    </Button>
                  }
                />
                <DeleteForm
                  action={removeTransaction}
                  id={row.id}
                  extraFields={{ month }}
                  confirmText="Delete this transaction? This cannot be undone."
                  successMessage="Transaction deleted"
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
