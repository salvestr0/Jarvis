import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { NetWorthChart } from '@/components/net-worth-chart'
import { PageHeader } from '@/components/page-header'
import { currentMonth, formatMonthLabel } from '@/lib/date'
import { formatMoney } from '@/lib/money'
import { getNetWorthHistory } from '@/lib/queries/dashboard'
import {
  buildPositions,
  getCashBalanceCents,
  getHoldings,
  getLatestPrices,
  getLatestUsdSgd,
  portfolioTotals,
} from '@/lib/queries/investments'
import {
  getAccounts,
  getCategories,
  getTransactionsForMonth,
  summariseMonth,
} from '@/lib/queries/money'
import { getJobs, monthlySalaryCents } from '@/lib/queries/career'
import { getMetrics, getProjects, withProgress } from '@/lib/queries/projects'

import { TransactionDialog } from './money/transaction-dialog'

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'up' | 'down'
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p
          className="mt-1 text-2xl font-semibold tracking-tight tabular-nums"
          style={
            tone
              ? { color: tone === 'up' ? 'var(--viz-up)' : 'var(--viz-down)' }
              : undefined
          }
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

export default async function DashboardPage() {
  const month = currentMonth()

  // Every module's data at once. Fired in parallel — sequential awaits would
  // stack ~10 round trips to Singapore on top of each other.
  const [
    history,
    holdings,
    prices,
    fx,
    cashCents,
    transactions,
    categories,
    accounts,
    jobs,
    projects,
    metrics,
  ] = await Promise.all([
    getNetWorthHistory(),
    getHoldings(),
    getLatestPrices(),
    getLatestUsdSgd(),
    getCashBalanceCents(),
    getTransactionsForMonth(month),
    getCategories(),
    getAccounts(),
    getJobs(),
    getProjects(),
    getMetrics(),
  ])

  const positions = buildPositions(holdings, prices, fx?.rate ?? null)
  const totals = portfolioTotals(positions)
  const summary = summariseMonth(transactions)

  // Computed live rather than read from the last snapshot, so this stays
  // correct even if prices haven't been refreshed today.
  const netWorth = totals.marketValueCents + cashCents

  const currentJob = jobs.find((j) => j.ended_on === null) ?? null
  const salaryPerMonth = currentJob ? monthlySalaryCents(currentJob) : null

  const withMetrics = withProgress(projects, metrics)
  const revenueProjects = withMetrics.filter((p) => p.mrr_target_cents > 0)
  const totalMrr = revenueProjects.reduce((s, p) => s + p.currentMrrCents, 0)
  const totalTarget = revenueProjects.reduce((s, p) => s + p.mrr_target_cents, 0)

  const topPositions = [...positions]
    .filter((p) => p.marketValueCents !== null)
    .sort((a, b) => (b.marketValueCents ?? 0) - (a.marketValueCents ?? 0))
    .slice(0, 4)

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={formatMonthLabel(month)}
        action={
          <TransactionDialog
            categories={categories}
            accounts={accounts}
            month={month}
            trigger={<Button>Quick add</Button>}
          />
        }
      />

      <div className="space-y-6">
        {/* Hero figure — the one number the dashboard leads with. */}
        <Card>
          <CardContent className="p-6">
            <p className="text-xs font-medium text-muted-foreground">
              Net worth
            </p>
            <p className="mt-1 text-5xl font-semibold tracking-tight">
              {formatMoney(netWorth)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {formatMoney(totals.marketValueCents)} invested ·{' '}
              {formatMoney(cashCents)} cash
              {totals.unpricedCount > 0
                ? ` · ${totals.unpricedCount} holding${totals.unpricedCount === 1 ? '' : 's'} unpriced`
                : ''}
            </p>

            <div className="mt-6">
              <NetWorthChart points={history} />
            </div>
          </CardContent>
        </Card>

        {/* KPI row — this month's cashflow. */}
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Money in this month"
            value={formatMoney(summary.incomeCents)}
            tone={summary.incomeCents > 0 ? 'up' : undefined}
          />
          <Stat
            label="Money out this month"
            value={formatMoney(summary.expenseCents)}
            tone={summary.expenseCents > 0 ? 'down' : undefined}
          />
          <Stat
            label="Left over"
            value={formatMoney(summary.netCents)}
            tone={summary.netCents >= 0 ? 'up' : 'down'}
            hint={`${summary.count} transaction${summary.count === 1 ? '' : 's'} · ${formatMonthLabel(month)}`}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {/* Holdings */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-medium">Biggest holdings</h2>
                <Link
                  href="/investments"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  View all
                </Link>
              </div>

              {topPositions.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  No priced holdings yet.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {topPositions.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-baseline justify-between gap-3 text-sm"
                    >
                      <span className="truncate font-medium">{p.symbol}</span>
                      <span className="shrink-0 tabular-nums">
                        {formatMoney(p.marketValueCents ?? 0)}
                        {p.gainCents !== null ? (
                          <span
                            className="ml-2 text-xs"
                            style={{
                              color:
                                p.gainCents >= 0
                                  ? 'var(--viz-up)'
                                  : 'var(--viz-down)',
                            }}
                          >
                            <span aria-hidden="true">
                              {p.gainCents >= 0 ? '▲' : '▼'}
                            </span>{' '}
                            {p.gainCents >= 0 ? '+' : '−'}
                            {Math.abs(p.gainPct ?? 0).toFixed(1)}%
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Work + projects */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-medium">Work</h2>
                <Link
                  href="/career"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  View
                </Link>
              </div>

              {currentJob ? (
                <div className="mt-3 text-sm">
                  <p className="font-medium">{currentJob.title}</p>
                  <p className="text-muted-foreground">{currentJob.employer}</p>
                  <p className="mt-1 tabular-nums text-muted-foreground">
                    {salaryPerMonth === null
                      ? 'Salary not recorded'
                      : `${formatMoney(salaryPerMonth)} / month`}
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  No current role recorded.
                </p>
              )}

              <div className="mt-4 border-t pt-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-medium">MRR</h3>
                  <Link
                    href="/projects"
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    View
                  </Link>
                </div>

                {revenueProjects.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No projects with a revenue target.
                  </p>
                ) : (
                  <>
                    <p className="mt-2 text-sm tabular-nums">
                      <span className="font-medium">
                        {formatMoney(totalMrr)}
                      </span>
                      <span className="text-muted-foreground">
                        {' '}
                        of {formatMoney(totalTarget)}
                      </span>
                    </p>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${totalTarget > 0 ? Math.min(100, (totalMrr / totalTarget) * 100) : 0}%`,
                          backgroundColor: 'var(--viz-bar)',
                        }}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {revenueProjects.map((p) => (
                        <Badge key={p.id} variant="secondary">
                          {p.name}
                        </Badge>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
