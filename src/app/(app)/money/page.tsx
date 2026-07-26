import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { currentMonth, isValidMonth } from '@/lib/date'
import {
  filterRecurring,
  filterTransactions,
  hasActiveFilter,
  type MoneyFilter,
} from '@/lib/filters'
import {
  getAccounts,
  getCategories,
  getTransactionsForMonth,
  summariseMonth,
  totalsByCategory,
} from '@/lib/queries/money'
import { getRecurring } from '@/lib/queries/recurring'

import { MoneyFilters } from './money-filters'
import { MonthNav } from './month-nav'
import { CategoryBreakdown, MonthSummaryCards } from './summary'
import { RecurringSection } from './recurring-section'
import { TransactionDialog } from './transaction-dialog'
import { TransactionTable } from './transaction-table'

export default async function MoneyPage({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string
    type?: string
    category?: string
    account?: string
    q?: string
  }>
}) {
  const params = await searchParams

  // Never trust a value from the URL — anyone can type ?month=lol into it.
  const month =
    params.month && isValidMonth(params.month) ? params.month : currentMonth()

  // Same rule for filters: junk values just mean "no filter". An unknown
  // category or account id filters to zero rows, which is harmless.
  const filter: MoneyFilter = {
    type:
      params.type === 'income' || params.type === 'expense' ? params.type : null,
    categoryId: params.category?.trim() ? params.category.trim() : null,
    accountId: params.account?.trim() ? params.account.trim() : null,
    q: params.q?.trim() ? params.q.trim() : null,
  }

  // Fired together rather than one after another: three round trips to
  // Singapore run in parallel instead of stacking up.
  const [rows, categories, accounts, recurring] = await Promise.all([
    getTransactionsForMonth(month),
    getCategories(),
    getAccounts(),
    getRecurring(),
  ])

  // Filter first, then derive: the cards, breakdown, table and recurring list
  // all read from the same filtered rows, so they can never disagree.
  const visibleRows = filterTransactions(rows, filter)
  const visibleRecurring = filterRecurring(recurring, filter)
  const filtered = hasActiveFilter(filter)

  const summary = summariseMonth(visibleRows)
  const expenseTotals = totalsByCategory(visibleRows, 'expense')
  const incomeTotals = totalsByCategory(visibleRows, 'income')

  // Month arrows keep the active filters; only the month changes.
  const filterQuery = new URLSearchParams()
  if (filter.type) filterQuery.set('type', filter.type)
  if (filter.categoryId) filterQuery.set('category', filter.categoryId)
  if (filter.accountId) filterQuery.set('account', filter.accountId)
  if (filter.q) filterQuery.set('q', filter.q)

  return (
    <>
      <PageHeader
        title="Money"
        description="What came in, what went out."
        action={
          <TransactionDialog
            categories={categories}
            accounts={accounts}
            month={month}
            trigger={<Button>Add transaction</Button>}
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <MonthNav month={month} extraQuery={filterQuery.toString()} />
        <MoneyFilters
          month={month}
          filter={filter}
          categories={categories}
          accounts={accounts}
        />
      </div>

      <div className="space-y-6">
        <MonthSummaryCards summary={summary} />

        {expenseTotals.length > 0 || incomeTotals.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            <CategoryBreakdown
              totals={expenseTotals}
              title="Where it went"
              tone="expense"
            />
            <CategoryBreakdown
              totals={incomeTotals}
              title="Where it came from"
              tone="income"
            />
          </div>
        ) : null}

        <TransactionTable
          rows={visibleRows}
          categories={categories}
          accounts={accounts}
          month={month}
          filtered={filtered}
        />

        <RecurringSection
          rows={visibleRecurring}
          categories={categories}
          filtered={filtered}
        />
      </div>
    </>
  )
}
