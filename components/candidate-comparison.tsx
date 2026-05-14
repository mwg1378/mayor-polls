import { partyColor } from '@/lib/labels'
import { fmtDateShort } from '@/lib/format'
import type { PollRowData, Candidate } from '@/components/poll-row'
import type { CandidateResult } from '@/lib/accuracy'

/**
 * Side-by-side comparison: candidate × poll, with actual result column.
 *
 * Includes every candidate who:
 *  - polled ≥ THRESHOLD in ANY poll, OR
 *  - finished ≥ THRESHOLD in the actual result.
 *
 * For each candidate, shows a row across each poll plus the final result.
 */
const THRESHOLD = 8

export function CandidateComparison({
  polls,
  actuals,
}: {
  polls: PollRowData[]
  actuals: CandidateResult[] | null
}) {
  if (polls.length === 0 && (!actuals || actuals.length === 0)) return null

  // Collect candidate set (normalized name → display name + party).
  const candidates = collectCandidates(polls, actuals)
  if (candidates.length === 0) return null

  // Sort polls oldest first so they read left-to-right chronologically.
  const orderedPolls = [...polls].sort((a, b) => {
    const ad = new Date(a.endDate).getTime()
    const bd = new Date(b.endDate).getTime()
    return ad - bd
  })

  return (
    <div className="overflow-x-auto rounded border border-border/60">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr className="border-b border-border">
            <th className="px-3 py-2 text-left font-medium">Candidate</th>
            {orderedPolls.map((p) => (
              <th key={p.id} className="px-2 py-2 text-right font-medium">
                <div className="text-[10px] font-normal">{p.pollster.name}</div>
                <div className="text-[10px] text-muted-foreground">{fmtDateShort(p.endDate)}</div>
              </th>
            ))}
            {actuals ? (
              <th className="px-3 py-2 text-right font-medium bg-emerald-500/10 text-emerald-300">
                <div>Actual</div>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.norm} className="border-b border-border/40 hover:bg-muted/30">
              <td className="px-3 py-2 align-middle">
                <span className={`mr-1 text-xs ${partyColor(c.party)}`}>{c.party ?? ''}</span>
                <span className={c.norm === topActualNorm(actuals) ? 'font-semibold' : ''}>{c.name}</span>
                {c.norm === topActualNorm(actuals) ? (
                  <span className="ml-2 text-xs text-emerald-400">winner</span>
                ) : null}
              </td>
              {orderedPolls.map((p) => {
                const cell = findCandidate(p.candidates, c.norm)
                return (
                  <td key={p.id} className="px-2 py-2 text-right font-mono tabular-nums text-xs">
                    {cell ? cell.pct.toFixed(1) : <span className="text-muted-foreground/50">—</span>}
                  </td>
                )
              })}
              {actuals ? (
                <td className="px-3 py-2 text-right font-mono tabular-nums bg-emerald-500/10 text-emerald-200">
                  {(() => {
                    const a = findActual(actuals, c.norm)
                    return a ? a.pct.toFixed(1) : '—'
                  })()}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.+?\)/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .split(/\s+/)
    .slice(-1)[0] ?? ''
}

function collectCandidates(
  polls: PollRowData[],
  actuals: CandidateResult[] | null,
): Array<{ norm: string; name: string; party: string | null }> {
  const seen = new Map<string, { name: string; party: string | null; maxPct: number }>()
  for (const p of polls) {
    for (const c of p.candidates) {
      const n = normName(c.name)
      if (!n) continue
      const cur = seen.get(n)
      if (!cur) seen.set(n, { name: c.name, party: c.party ?? null, maxPct: c.pct })
      else if (c.pct > cur.maxPct) {
        cur.maxPct = c.pct
        cur.name = c.name
        cur.party = c.party ?? cur.party
      }
    }
  }
  if (actuals) {
    for (const a of actuals) {
      const n = normName(a.name)
      if (!n) continue
      const cur = seen.get(n)
      if (!cur) seen.set(n, { name: a.name, party: a.party ?? null, maxPct: a.pct })
      else {
        if (a.pct > cur.maxPct) {
          cur.maxPct = a.pct
          cur.name = a.name
        }
        if (!cur.party && a.party) cur.party = a.party
      }
    }
  }

  return [...seen.entries()]
    .filter(([, v]) => v.maxPct >= THRESHOLD)
    .map(([norm, v]) => ({ norm, name: v.name, party: v.party }))
    .sort((a, b) => (seen.get(b.norm)?.maxPct ?? 0) - (seen.get(a.norm)?.maxPct ?? 0))
}

function findCandidate(cands: Candidate[], norm: string): Candidate | undefined {
  return cands.find((c) => normName(c.name) === norm)
}

function findActual(actuals: CandidateResult[], norm: string): CandidateResult | undefined {
  return actuals.find((a) => normName(a.name) === norm)
}

function topActualNorm(actuals: CandidateResult[] | null): string | null {
  if (!actuals || actuals.length === 0) return null
  const top = [...actuals].sort((a, b) => b.pct - a.pct)[0]
  return top ? normName(top.name) : null
}
