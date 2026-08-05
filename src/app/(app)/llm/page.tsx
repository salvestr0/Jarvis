import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageHeader } from '@/components/page-header'
import { todayISO } from '@/lib/date'
import { dailyTotals, p95LatencyMs, sgtDateOf, totalCostCents } from '@/lib/llm'
import { getLlmCallsSince, getRecentLlmCalls } from '@/lib/queries/llm'

/**
 * LLM observability (step 1 of the production-AI roadmap): what every
 * Claude call cost, how long it took, and which tools it used. Costs are
 * estimates in USD — that's the currency the API bills in — computed from
 * tokens at render time, never stored.
 */

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Fractional cents -> 'US$1.23'. Tiny-but-nonzero shows as '<US$0.01'. */
function formatUsdCents(cents: number): string {
  const dollars = cents / 100
  if (dollars > 0 && dollars < 0.005) return '<US$0.01'
  return `US$${dollars.toFixed(2)}`
}

function formatLatency(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

const SOURCE_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  digest: 'Digest',
  weekly_review: 'Weekly review',
  content_nudge: 'Nudge',
}

function formatSgtTime(iso: string): string {
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso))
}

export default async function LlmPage() {
  const now = Date.now()
  const since30d = new Date(now - 30 * 24 * 3600_000).toISOString()
  const since7d = new Date(now - 7 * 24 * 3600_000).toISOString()

  const [last30d, recent] = await Promise.all([
    getLlmCallsSince(since30d),
    getRecentLlmCalls(20),
  ])

  const today = todayISO()
  const todayRows = last30d.filter((r) => sgtDateOf(r.created_at) === today)
  const last7d = last30d.filter((r) => r.created_at >= since7d)
  const p95 = p95LatencyMs(last7d)
  const daily = dailyTotals(last30d).slice(0, 14)

  return (
    <>
      <PageHeader
        title="LLM"
        description="Every Claude call Jarvis makes — tokens, estimated cost (USD), latency."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Spend today" value={formatUsdCents(totalCostCents(todayRows))} />
        <Stat label="Spend 7 days" value={formatUsdCents(totalCostCents(last7d))} />
        <Stat label="Spend 30 days" value={formatUsdCents(totalCostCents(last30d))} />
        <Stat label="Calls today" value={String(todayRows.length)} />
        <Stat
          label="p95 latency"
          value={p95 === null ? '—' : formatLatency(p95)}
          hint="last 7 days"
        />
      </div>

      {last30d.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium">No calls logged yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Message Jarvis on Telegram and the first rows will land here.
          </p>
        </div>
      ) : (
        <>
          <h2 className="mt-8 mb-3 text-sm font-medium text-muted-foreground">
            By day (last 14 days with activity)
          </h2>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Tokens in</TableHead>
                    <TableHead className="text-right">Tokens out</TableHead>
                    <TableHead className="text-right">Est. cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {daily.map((d) => (
                    <TableRow key={d.date}>
                      <TableCell>{d.date}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.calls}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {d.inputTokens.toLocaleString('en-SG')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {d.outputTokens.toLocaleString('en-SG')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatUsdCents(d.costCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <h2 className="mt-8 mb-3 text-sm font-medium text-muted-foreground">
            Recent calls
          </h2>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time (SGT)</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">In</TableHead>
                    <TableHead className="text-right">Out</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                    <TableHead>Tools</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((call) => (
                    <TableRow key={call.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatSgtTime(call.created_at)}
                      </TableCell>
                      <TableCell>
                        {SOURCE_LABELS[call.source] ?? call.source}
                        {call.iteration !== null && call.iteration > 0
                          ? ` · step ${call.iteration + 1}`
                          : ''}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {call.input_tokens.toLocaleString('en-SG')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {call.output_tokens.toLocaleString('en-SG')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatLatency(call.latency_ms)}
                      </TableCell>
                      <TableCell className="max-w-48 truncate text-muted-foreground">
                        {call.tools_called.length > 0 ? call.tools_called.join(', ') : '—'}
                      </TableCell>
                      <TableCell>
                        {call.error ? (
                          <Badge variant="destructive" title={call.error}>
                            error
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">
                            {call.stop_reason ?? 'ok'}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </>
  )
}
