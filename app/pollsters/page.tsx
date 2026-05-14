import Link from 'next/link'
import { prisma } from '@/prisma/client'
import { computeAggregate, type ScoredPoll, type CandidateResult } from '@/lib/accuracy'
import { PARTISAN_LEAN_LABELS } from '@/lib/labels'

export const revalidate = 300

export default async function PollstersIndex() {
  const pollsters = await prisma.pollster.findMany({
    orderBy: { name: 'asc' },
    include: {
      polls: {
        where: { status: 'PUBLISHED' },
        select: {
          id: true,
          raceId: true,
          candidates: true,
          undecidedPct: true,
          daysToElection: true,
          sponsorType: true,
          race: { select: { actualResults: true, electionYear: true, raceType: true } },
        },
      },
    },
  })

  const rows = pollsters
    .map((p) => {
      const scoreable: ScoredPoll[] = p.polls
        .filter((x) => x.race.actualResults != null)
        .map((x) => ({
          pollId: x.id,
          raceId: x.raceId,
          candidates: x.candidates as CandidateResult[],
          actuals: x.race.actualResults as CandidateResult[],
          undecidedPct: x.undecidedPct,
          daysToElection: x.daysToElection,
          sponsorType: x.sponsorType,
          raceType: x.race.raceType,
          electionYear: x.race.electionYear,
        }))
      return {
        slug: p.slug,
        name: p.name,
        lean: p.defaultPartisanLean,
        pollCount: p.polls.length,
        stats: computeAggregate(scoreable),
      }
    })
    .sort((a, b) => b.pollCount - a.pollCount)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Pollsters</h1>
        <p className="text-sm text-muted-foreground">
          Pollsters who have released or sponsored at least one mayoral poll. Accuracy stats only count polls in
          races whose results are known. <strong>Vote-weighted error</strong> allocates undecideds proportionately
          and weights each candidate by √(actual share); lower is better. See <Link href="/about" className="hover:underline">methodology</Link>.
        </p>
      </header>
      <div className="overflow-x-auto rounded border border-border/60">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left font-medium">Pollster</th>
              <th className="px-3 py-2 text-left font-medium">Lean</th>
              <th className="px-3 py-2 text-left font-medium">Polls</th>
              <th className="px-3 py-2 text-left font-medium">Vote-wt err</th>
              <th className="px-3 py-2 text-left font-medium">Called winner</th>
              <th className="px-3 py-2 text-left font-medium">Called top 2</th>
              <th className="px-3 py-2 text-left font-medium">Median margin err</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slug} className="border-b border-border/40 hover:bg-muted/40">
                <td className="px-3 py-2 align-top">
                  <Link href={`/pollsters/${r.slug}`} className="font-medium hover:underline">{r.name}</Link>
                </td>
                <td className="px-3 py-2 align-top text-xs text-muted-foreground">{PARTISAN_LEAN_LABELS[r.lean]}</td>
                <td className="px-3 py-2 align-top font-mono tabular-nums">{r.pollCount}</td>
                <td className="px-3 py-2 align-top font-mono tabular-nums">
                  {r.stats.medianWeightedError == null ? '—' : r.stats.medianWeightedError.toFixed(2)}
                  <span className="ml-1 text-xs text-muted-foreground">(n={r.stats.n})</span>
                </td>
                <td className="px-3 py-2 align-top font-mono tabular-nums">
                  {r.stats.pctCalledWinner == null ? '—' : `${r.stats.pctCalledWinner.toFixed(0)}%`}
                </td>
                <td className="px-3 py-2 align-top font-mono tabular-nums">
                  {r.stats.pctCalledTopTwo == null ? '—' : `${r.stats.pctCalledTopTwo.toFixed(0)}%`}
                </td>
                <td className="px-3 py-2 align-top font-mono tabular-nums">
                  {r.stats.medianMarginError == null ? '—' : `${r.stats.medianMarginError.toFixed(1)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
