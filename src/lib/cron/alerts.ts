import 'server-only'

import { alertCrossed, alertMessage } from '@/lib/alerts'
import { saveAssistantNote } from '@/lib/jarvis/history'
import { fetchCryptoPrices, fetchStockPrices } from '@/lib/prices'
import {
  claimTriggeredAlert,
  getPendingPriceAlerts,
  revertAlertClaim,
} from '@/lib/queries/price-alerts'
import { sendMessage } from '@/lib/telegram/api'
import type { Db } from '@/lib/queries/db'

/**
 * The price-alert check (tasks/price-alerts-design.md), run by every
 * reminders tick. No pending alerts = no price API calls — the common case
 * costs nothing. A fetch failure leaves the alert pending for the next
 * tick; a send failure reverts the claim, same shape as reminders.
 */

export async function runPriceAlertCheck(
  db: Db,
  chatId: number
): Promise<{ pending: number; fired: number }> {
  const alerts = await getPendingPriceAlerts(db)
  if (alerts.length === 0) return { pending: 0, fired: 0 }

  const cryptoSymbols = [
    ...new Set(alerts.filter((a) => a.kind === 'crypto').map((a) => a.symbol)),
  ]
  const stockSymbols = [
    ...new Set(alerts.filter((a) => a.kind === 'stock').map((a) => a.symbol)),
  ]

  const [crypto, stocks] = await Promise.all([
    fetchCryptoPrices(cryptoSymbols),
    fetchStockPrices(stockSymbols),
  ])
  for (const f of [...crypto.failures, ...stocks.failures]) {
    console.error(`[alerts] price fetch failed for ${f.symbol}: ${f.reason}`)
  }

  const priceBy = new Map(
    [...crypto.prices, ...stocks.prices].map((p) => [
      `${p.kind}:${p.symbol.toUpperCase()}`,
      p.priceMicros,
    ])
  )

  let fired = 0
  for (const alert of alerts) {
    const price = priceBy.get(`${alert.kind}:${alert.symbol.toUpperCase()}`)
    if (price === undefined) continue
    if (!alertCrossed(alert.direction, alert.target_micros, price)) continue

    // Claim BEFORE sending so concurrent tickers can't both message him.
    if (!(await claimTriggeredAlert(db, alert.id, price))) continue

    const text = alertMessage(alert.symbol, alert.direction, alert.target_micros, price)
    try {
      await sendMessage(chatId, text)
      fired += 1
      // Into chat history like reminders, so "what was that alert?" works.
      try {
        await saveAssistantNote(db, text)
      } catch (error) {
        console.error(
          '[alerts] history save failed:',
          error instanceof Error ? error.message : error
        )
      }
    } catch (error) {
      console.error(
        `[alerts] send failed for ${alert.id}:`,
        error instanceof Error ? error.message : error
      )
      try {
        await revertAlertClaim(db, alert.id)
      } catch (revertError) {
        console.error(
          `[alerts] revert failed for ${alert.id}:`,
          revertError instanceof Error ? revertError.message : revertError
        )
      }
    }
  }

  return { pending: alerts.length, fired }
}
