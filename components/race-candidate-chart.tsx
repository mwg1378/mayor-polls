'use client'

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { format } from 'date-fns'

export type ChartPoll = {
  endDate: string
  pollster: string
  candidates: Array<{ name: string; pct: number }>
}

export type ActualResult = { name: string; pct: number }

const PALETTE = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#84cc16', '#fb923c', '#6366f1']

export function RaceCandidateChart({
  polls,
  electionDate,
  actuals,
  topCandidateNames,
}: {
  polls: ChartPoll[]
  electionDate: string
  actuals: ActualResult[] | null
  topCandidateNames?: string[] // optional override; defaults to anyone ≥8% in any poll or actual
}) {
  if (polls.length === 0) return null

  // Auto-derive top candidates if not supplied: anyone ≥8% in any poll OR actual.
  const names = topCandidateNames ?? deriveTopCandidates(polls, actuals)
  if (names.length === 0) return null

  // Build wide-format data: one row per poll endDate.
  const data = polls
    .map((p) => {
      const row: Record<string, number | string> = {
        t: new Date(p.endDate).getTime(),
        endDate: p.endDate,
      }
      for (const c of p.candidates) row[c.name] = c.pct
      return row
    })
    .sort((a, b) => Number(a.t) - Number(b.t))

  const electionT = new Date(electionDate).getTime()

  const allValues = data.flatMap((d) =>
    names.map((n) => (typeof d[n] === 'number' ? (d[n] as number) : Number.NaN)).filter((x) => !Number.isNaN(x)),
  )
  const yMin = Math.max(0, Math.min(...allValues) - 5)
  const yMax = Math.min(100, Math.max(...allValues) + 5)

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis
            type="number"
            dataKey="t"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(t) => format(new Date(t), 'MMM yy')}
            stroke="currentColor"
            tick={{ fontSize: 11 }}
          />
          <YAxis
            domain={[yMin, yMax]}
            tickFormatter={(v) => `${v}%`}
            stroke="currentColor"
            tick={{ fontSize: 11 }}
            width={42}
          />
          <ReferenceLine
            x={electionT}
            stroke="currentColor"
            strokeOpacity={0.5}
            strokeDasharray="4 4"
            label={{ value: 'Election', position: 'top', fill: 'currentColor', fontSize: 11 }}
          />
          {(actuals ?? []).map((a, i) =>
            names.includes(a.name) ? (
              <ReferenceLine
                key={`actual-${i}`}
                y={a.pct}
                stroke={PALETTE[names.indexOf(a.name) % PALETTE.length]}
                strokeOpacity={0.5}
                strokeDasharray="2 4"
              />
            ) : null,
          )}
          <Tooltip
            contentStyle={{ background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
            labelFormatter={(t) => format(new Date(t as number), 'MMM d, yyyy')}
            formatter={(v: unknown, name) => [`${(v as number).toFixed(1)}%`, name as string]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {names.map((name, i) => (
            <Line
              key={name}
              type="monotone"
              dataKey={name}
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
              name={name}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function deriveTopCandidates(polls: ChartPoll[], actuals: ActualResult[] | null): string[] {
  const THRESHOLD = 8
  const max = new Map<string, number>()
  for (const p of polls) {
    for (const c of p.candidates) {
      const prev = max.get(c.name) ?? 0
      if (c.pct > prev) max.set(c.name, c.pct)
    }
  }
  for (const a of actuals ?? []) {
    const prev = max.get(a.name) ?? 0
    if (a.pct > prev) max.set(a.name, a.pct)
  }
  return [...max.entries()]
    .filter(([, v]) => v >= THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .map(([n]) => n)
}
