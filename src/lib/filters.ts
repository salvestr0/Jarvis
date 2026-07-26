import type { Direction, RecurringRow, TransactionRow } from './types'

/**
 * Filtering for the Money page.
 *
 * Filters live in the URL (?type=expense&category=...&q=netflix) and are
 * applied server-side to the already-fetched month of rows. Everything
 * downstream — summary cards, category breakdown, table, recurring — derives
 * from the same filtered rows, so the numbers you analyse always agree with
 * the list you're looking at.
 */

export type MoneyFilter = {
  type: Direction | null
  /** A category id, or the special value 'uncategorised'. */
  categoryId: string | null
  accountId: string | null
  /** Free-text search, matched case-insensitively. */
  q: string | null
}

export const emptyFilter: MoneyFilter = {
  type: null,
  categoryId: null,
  accountId: null,
  q: null,
}

export function hasActiveFilter(f: MoneyFilter): boolean {
  return Boolean(f.type || f.categoryId || f.accountId || f.q)
}

function matchesText(q: string, ...fields: (string | null)[]): boolean {
  const needle = q.toLowerCase()
  return fields.some((field) => field !== null && field.toLowerCase().includes(needle))
}

function matchesCategory(
  filterCategoryId: string | null,
  rowCategoryId: string | null
): boolean {
  if (filterCategoryId === null) return true
  if (filterCategoryId === 'uncategorised') return rowCategoryId === null
  return rowCategoryId === filterCategoryId
}

export function filterTransactions(
  rows: TransactionRow[],
  f: MoneyFilter
): TransactionRow[] {
  return rows.filter((row) => {
    if (f.type && row.direction !== f.type) return false
    if (!matchesCategory(f.categoryId, row.category_id)) return false
    if (f.accountId && row.account_id !== f.accountId) return false
    if (f.q && !matchesText(f.q, row.note, row.category_name, row.account_name))
      return false
    return true
  })
}

/**
 * The account filter is deliberately ignored here — recurring items aren't
 * tied to an account, and hiding them all while filtering by account would
 * read as "your subscriptions vanished".
 */
export function filterRecurring(
  rows: RecurringRow[],
  f: MoneyFilter
): RecurringRow[] {
  return rows.filter((row) => {
    if (f.type && row.direction !== f.type) return false
    if (!matchesCategory(f.categoryId, row.category_id)) return false
    if (f.q && !matchesText(f.q, row.name, row.category_name)) return false
    return true
  })
}
