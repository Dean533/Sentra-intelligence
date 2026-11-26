'use client'

import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export type ChartPoint = { t: number; close: number }

// One marker per (day, direction); its popover leads with that day's largest trade.
export type ChartMarker = {
  key: string
  t: number
  isBuy: boolean
  tradeIds: string[] // largest first
  value: number
  label: string
}

export const BUY_COLOR = '#58A6FF'
export const SALE_COLOR = '#F0883E'
const UP = '#3FB950'
const DOWN = '#F0716A'
const BG = '#0B0E11'

function priceAt(points: ChartPoint[], t: number): number | null {
  if (!points.length || t < points[0].t || t > points[points.length - 1].t) return null
  // Linear interpolation between bracketing bars (the line is linear too, so dots sit on it).
  let lo = 0
  let hi = points.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = points[lo]
  const b = points[hi]
  if (b.t === a.t) return a.close
  return a.close + ((b.close - a.close) * (t - a.t)) / (b.t - a.t)
}

// Intraday ranges have overnight gaps, so ticks go on actual bars, not even time steps.
function ticks(points: ChartPoint[], n: number): number[] {
  if (points.length < 2) return points.map((p) => p.t)
  const first = 0.05 * (points.length - 1)
  const last = 0.95 * (points.length - 1)
  return Array.from({ length: n }, (_, i) => points[Math.round(first + ((last - first) * i) / (n - 1))].t)
}

function fmtTick(t: number, spanDays: number): string {
  const d = new Date(t)
  if (spanDays <= 1.5) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
  if (spanDays <= 10) return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', timeZone: 'America/New_York' })
  if (spanDays > 3000) return d.toLocaleDateString('en-US', { year: 'numeric', timeZone: 'UTC' })
  if (spanDays > 400) return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function PriceTooltip({ active, payload, intraday }: { active?: boolean; payload?: { payload: ChartPoint }[]; intraday: boolean }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  const when = intraday
    ? new Date(p.t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
    : new Date(p.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  return (
    <div className="pointer-events-none rounded-sm border border-border-strong bg-surface px-3 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
      <div className="font-mono text-[11px] text-muted">{when}</div>
      <div className="font-mono text-sm text-heading">${p.close.toFixed(2)}</div>
    </div>
  )
}

export default function PriceChart({
  points,
  markers,
  up,
  compact,
  logScale,
  highlightKey,
  selectedKey,
  onSelect,
}: {
  points: ChartPoint[]
  markers: ChartMarker[]
  up: boolean
  compact: boolean
  logScale: boolean
  highlightKey: string | null
  selectedKey: string | null
  onSelect: (m: ChartMarker, pos: { x: number; y: number }) => void
}) {
  const color = up ? UP : DOWN
  const spanDays = points.length > 1 ? (points[points.length - 1].t - points[0].t) / 86_400_000 : 0
  const placed = markers
    .map((m) => ({ m, y: priceAt(points, m.t) }))
    .filter((x): x is { m: ChartMarker; y: number } => x.y != null)
  // Sales first so buys draw on top.
  placed.sort((a, b) => Number(a.m.isBuy) - Number(b.m.isBuy))
  const highlight = placed.find((x) => x.m.key === highlightKey)

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={points} margin={{ top: 12, right: 4, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="tickerFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#161B21" vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          ticks={ticks(points, compact ? 4 : 6)}
          tickFormatter={(t: number) => fmtTick(t, spanDays)}
          tick={{ fill: '#8B949E', fontSize: 11, fontFamily: 'var(--font-plex-mono), monospace' }}
          axisLine={{ stroke: '#1F262D' }}
          tickLine={false}
          interval={0}
        />
        <YAxis
          orientation="right"
          scale={logScale ? 'log' : 'linear'}
          domain={['auto', 'auto']}
          allowDataOverflow={false}
          width={58}
          tick={{ fill: '#8B949E', fontSize: 11, fontFamily: 'var(--font-plex-mono), monospace' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => `$${v >= 100 ? v.toFixed(0) : v.toFixed(2)}`}
        />
        <Tooltip content={<PriceTooltip intraday={spanDays <= 10} />} cursor={{ stroke: '#2A323B', strokeWidth: 1 }} />
        {highlight && <ReferenceLine x={highlight.m.t} stroke={BUY_COLOR} strokeOpacity={0.55} strokeDasharray="3 4" />}
        <Area
          type="linear"
          dataKey="close"
          stroke={color}
          strokeWidth={1.75}
          fill="url(#tickerFill)"
          dot={false}
          isAnimationActive={false}
          activeDot={{ r: 4, stroke: color, strokeWidth: 2, fill: BG }}
        />
        {placed.map(({ m, y }) => (
          <ReferenceDot
            key={m.key}
            x={m.t}
            y={y}
            ifOverflow="discard"
            shape={(props: { cx?: number; cy?: number }) => {
              const { cx = 0, cy = 0 } = props
              const big = m.key === highlightKey || m.key === selectedKey
              const r = big ? 7 : m.isBuy ? 5.5 : 4.5
              const fill = m.isBuy ? BUY_COLOR : SALE_COLOR
              return (
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`${m.label}. Open trade details`}
                  style={{ cursor: 'pointer', outline: 'none' }}
                  onClick={(e) => { e.stopPropagation(); onSelect(m, { x: cx, y: cy }) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(m, { x: cx, y: cy }) }
                  }}
                >
                  {/* Invisible hit area: at least 28px across so dots are tappable on phones. */}
                  <circle cx={cx} cy={cy} r={Math.max(r + 9, 14)} fill="transparent" />
                  {m.key === selectedKey && <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke={fill} strokeOpacity={0.5} strokeWidth={1.5} />}
                  <circle cx={cx} cy={cy} r={r} fill={fill} stroke={BG} strokeWidth={2} />
                </g>
              )
            }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}
