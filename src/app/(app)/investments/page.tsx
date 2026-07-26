import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import {
  buildPositions,
  getCashBalanceCents,
  getHoldings,
  getLatestPrices,
  getLatestUsdSgd,
  portfolioTotals,
} from '@/lib/queries/investments'

import { RefreshPricesButton } from './buttons'
import { HoldingDialog } from './holding-dialog'
import { Allocation, PortfolioSummary, PositionsTable } from './positions'

export default async function InvestmentsPage() {
  const [holdings, prices, fx, cashCents] = await Promise.all([
    getHoldings(),
    getLatestPrices(),
    getLatestUsdSgd(),
    getCashBalanceCents(),
  ])

  const positions = buildPositions(holdings, prices, fx?.rate ?? null)
  const totals = portfolioTotals(positions)

  const needsFx = positions.some(
    (p) => p.price_currency !== 'SGD' && p.marketValueCents === null
  )

  return (
    <>
      <PageHeader
        title="Investments"
        description="What you hold, what it's worth, what you're up or down."
        action={
          <div className="flex gap-2">
            <RefreshPricesButton />
            <HoldingDialog trigger={<Button>Add holding</Button>} />
          </div>
        }
      />

      <div className="space-y-6">
        <PortfolioSummary totals={totals} cashCents={cashCents} />

        {fx ? (
          <p className="text-xs text-muted-foreground">
            USD converted at {fx.rate.toFixed(4)} SGD (rate from {fx.asOf}).
            Exchange rates are published on weekdays only, so this may be the
            previous working day.
          </p>
        ) : needsFx ? (
          <p className="text-xs text-muted-foreground">
            No exchange rate yet — hit “Refresh prices” to fetch USD → SGD.
          </p>
        ) : null}

        <Allocation positions={positions} />

        <PositionsTable positions={positions} />
      </div>
    </>
  )
}
