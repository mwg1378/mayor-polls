import type { AggregateStats } from '@/lib/accuracy'

export function AccuracyCard({ title, sub, stats }: { title: string; sub?: string; stats: AggregateStats }) {
  return (
    <div className="rounded border border-border/60 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{title}</div>
          {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
        </div>
        <div className="text-xs text-muted-foreground">n={stats.n}</div>
      </div>
      {stats.n === 0 ? (
        <div className="mt-4 text-sm text-muted-foreground">No polls in scope.</div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <Stat
            label="Vote-weighted error"
            value={raw(stats.medianWeightedError)}
            sub={stats.meanWeightedError != null ? `mean ${stats.meanWeightedError.toFixed(2)}` : undefined}
          />
          <Stat label="Called winner" value={pct(stats.pctCalledWinner)} />
          <Stat label="Called top 2" value={pct(stats.pctCalledTopTwo)} />
          <Stat label="Median margin error" value={pts(stats.medianMarginError)} />
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono">{value}</div>
      {sub ? <div className="text-[10px] text-muted-foreground font-mono">{sub}</div> : null}
    </div>
  )
}

const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(0)}%`)
const pts = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)} pts`)
const raw = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2))
