'use client'

import { useId, useRef, useState } from 'react'

import { formatMoney } from '@/lib/money'
import { formatDayLabel } from '@/lib/date'
import type { NetWorthPoint } from '@/lib/queries/dashboard'

/**
 * Net worth over time.
 *
 * Form: a single-series area chart — the job is "trend over time", and there
 * is exactly one series, so one hue is correct and no legend is needed (the
 * heading names it). Hand-drawn SVG rather than a charting library: one chart
 * doesn't justify ~100KB of JavaScript on every page load.
 *
 * The hover layer is deliberate, not decoration — a line chart without one
 * makes you guess values off the axis.
 */

const VIEW_W = 800
const VIEW_H = 200
const PAD_TOP = 16
const PAD_BOTTOM = 24
const PAD_X = 8

export function NetWorthChart({ points }: { points: NetWorthPoint[] }) {
  const gradientId = useId()
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  if (points.length < 2) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm font-medium">Not enough history yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          A point is recorded each time you refresh prices. Come back after a
          couple of days and this becomes a trend line.
        </p>
      </div>
    )
  }

  const values = points.map((p) => p.totalCents)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)

  // Pad the range by 8% so the line never sits flat against an edge. When
  // every value is identical, invent a range so the line lands mid-height
  // instead of dividing by zero.
  const span = rawMax - rawMin
  const pad = span === 0 ? Math.max(Math.abs(rawMax) * 0.1, 100) : span * 0.08
  const min = rawMin - pad
  const max = rawMax + pad

  const plotH = VIEW_H - PAD_TOP - PAD_BOTTOM
  const plotW = VIEW_W - PAD_X * 2

  const x = (i: number) =>
    PAD_X + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW)

  const y = (cents: number) =>
    PAD_TOP + plotH - ((cents - min) / (max - min)) * plotH

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(p.totalCents).toFixed(2)}`)
    .join(' ')

  const areaPath =
    `${linePath} L ${x(points.length - 1).toFixed(2)} ${PAD_TOP + plotH} ` +
    `L ${x(0).toFixed(2)} ${PAD_TOP + plotH} Z`

  const first = points[0]
  const last = points[points.length - 1]
  const changeCents = last.totalCents - first.totalCents
  const active = hover === null ? null : points[hover]

  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg) return

    const rect = svg.getBoundingClientRect()
    // Map screen pixels back into viewBox units, then to the nearest index.
    const viewX = ((event.clientX - rect.left) / rect.width) * VIEW_W
    const ratio = (viewX - PAD_X) / plotW
    const index = Math.round(ratio * (points.length - 1))

    setHover(Math.min(points.length - 1, Math.max(0, index)))
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Net worth over time</h2>
        <p className="text-xs text-muted-foreground">
          {points.length} recorded {points.length === 1 ? 'day' : 'days'} ·{' '}
          <span
            style={{
              color: changeCents >= 0 ? 'var(--viz-up)' : 'var(--viz-down)',
            }}
          >
            <span aria-hidden="true">{changeCents >= 0 ? '▲' : '▼'}</span>{' '}
            {changeCents >= 0 ? '+' : '−'}
            {formatMoney(Math.abs(changeCents))}
          </span>{' '}
          since {formatDayLabel(first.asOf)}
        </p>
      </div>

      <div className="relative mt-3">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-[200px] w-full touch-none"
          role="img"
          aria-label={`Net worth from ${first.asOf} to ${last.asOf}, currently ${formatMoney(last.totalCents)}`}
          onPointerMove={handleMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--viz-bar)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--viz-bar)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Baseline, deliberately recessive */}
          <line
            x1={PAD_X}
            y1={PAD_TOP + plotH}
            x2={VIEW_W - PAD_X}
            y2={PAD_TOP + plotH}
            stroke="currentColor"
            className="text-border"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />

          <path d={areaPath} fill={`url(#${gradientId})`} />

          <path
            d={linePath}
            fill="none"
            stroke="var(--viz-bar)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Crosshair + marker for the hovered point */}
          {active && hover !== null ? (
            <>
              <line
                x1={x(hover)}
                y1={PAD_TOP}
                x2={x(hover)}
                y2={PAD_TOP + plotH}
                stroke="currentColor"
                className="text-muted-foreground"
                strokeWidth="1"
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={x(hover)}
                cy={y(active.totalCents)}
                r="5"
                fill="var(--viz-bar)"
                stroke="var(--background)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : (
            <circle
              cx={x(points.length - 1)}
              cy={y(last.totalCents)}
              r="4"
              fill="var(--viz-bar)"
            />
          )}
        </svg>

        {/* Tooltip. Positioned as a percentage so it tracks the SVG's scaling. */}
        {active && hover !== null ? (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
            style={{
              left: `${Math.min(88, Math.max(12, (x(hover) / VIEW_W) * 100))}%`,
            }}
          >
            <p className="font-medium tabular-nums">
              {formatMoney(active.totalCents)}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {formatDayLabel(active.asOf)} {active.asOf.slice(0, 4)}
            </p>
            <p className="mt-0.5 text-muted-foreground tabular-nums">
              {formatMoney(active.investmentsCents)} invested ·{' '}
              {formatMoney(active.cashCents)} cash
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{formatDayLabel(first.asOf)}</span>
        <span>{formatDayLabel(last.asOf)}</span>
      </div>
    </div>
  )
}
