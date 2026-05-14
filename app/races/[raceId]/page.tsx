import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/prisma/client'
import { PollsTable } from '@/components/polls-table'
import { RaceCandidateChart, type ChartPoll } from '@/components/race-candidate-chart'
import { CandidateComparison } from '@/components/candidate-comparison'
import { fmtDate, fmtPct } from '@/lib/format'
import { partyColor, RACE_TYPE_LABELS } from '@/lib/labels'
import { toPollRow } from '@/app/page'
import {
  calledTopTwo,
  calledWinner,
  meanCandidateError,
  topTwoMarginError,
  voteWeightedError,
  type CandidateResult,
} from '@/lib/accuracy'

export const revalidate = 300

export default async function RacePage({
  params,
}: {
  params: Promise<{ raceId: string }>
}) {
  const { raceId } = await params
  const race = await prisma.race.findUnique({
    where: { id: raceId },
    include: {
      city: true,
      polls: {
        where: { status: 'PUBLISHED' },
        orderBy: [{ endDate: 'desc' }, { id: 'desc' }],
        include: {
          pollster: { select: { slug: true, name: true } },
          race: {
            select: {
              id: true, citySlug: true, raceType: true, electionYear: true, party: true,
              actualResults: true,
              city: { select: { name: true, stateCode: true } },
            },
          },
        },
      },
    },
  })
  if (!race) return notFound()

  const actuals = (race.actualResults as CandidateResult[] | null) ?? null
  const finalRound = (race.finalRoundResults as CandidateResult[] | null) ?? null
  const polls = race.polls.map(toPollRow)

  // Decide which candidates to draw on the chart: union of actual top 6 and any poll-leading candidates.
  const allNames = new Set<string>()
  if (actuals) for (const a of actuals.slice(0, 6)) allNames.add(a.name)
  for (const p of polls) {
    for (const c of p.candidates.slice(0, 4)) allNames.add(c.name)
  }
  const topCandidateNames = Array.from(allNames).slice(0, 8)

  const chartPolls: ChartPoll[] = polls.map((p) => ({
    endDate: typeof p.endDate === 'string' ? p.endDate : p.endDate.toISOString(),
    pollster: p.pollster.name,
    candidates: p.candidates,
  }))

  // Per-poll accuracy spot-checks (when actuals known)
  const spotChecks = actuals
    ? polls.slice(0, 6).map((p) => {
        const sp = {
          pollId: p.id,
          raceId,
          candidates: p.candidates as CandidateResult[],
          actuals,
          undecidedPct: p.undecidedPct,
          daysToElection: p.daysToElection,
          sponsorType: p.sponsorType,
          raceType: race.raceType,
          electionYear: race.electionYear,
        }
        return {
          poll: p,
          calledWinner: calledWinner(sp),
          calledTopTwo: calledTopTwo(sp),
          meanError: meanCandidateError(sp),
          marginError: topTwoMarginError(sp),
          weightedError: voteWeightedError(sp),
        }
      })
    : []

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 space-y-8">
      <header className="space-y-2">
        <div className="text-sm text-muted-foreground">
          <Link href={`/cities/${race.citySlug}`} className="hover:text-foreground hover:underline">
            {race.city.name}, {race.city.stateCode}
          </Link>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {race.electionYear} {RACE_TYPE_LABELS[race.raceType]}
          {race.party ? <span className="ml-2 text-base font-medium text-muted-foreground">({race.party} party)</span> : null}
          {race.isRcv ? (
            <span
              className="ml-2 inline-flex items-center rounded border border-purple-500/40 bg-purple-500/15 px-1.5 py-0.5 align-middle text-xs font-medium text-purple-300"
              title="Ranked-choice voting — first-choice preference is the comparison universe for polls"
            >
              RCV
            </span>
          ) : null}
        </h1>
        <div className="text-sm text-muted-foreground">Election: {fmtDate(race.electionDate)}</div>
      </header>

      {actuals && actuals.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">
            {race.isRcv ? 'First-choice result' : 'Result'}
            {race.isRcv ? (
              <span className="ml-2 text-xs font-normal text-muted-foreground">(matches what pollsters measured)</span>
            ) : null}
          </h2>
          <ul className="divide-y divide-border/40 rounded border border-border/60">
            {actuals.slice(0, 12).map((a, i) => (
              <li key={i} className="flex items-baseline justify-between px-4 py-2">
                <span className="flex items-baseline gap-2">
                  <span className={`text-xs ${partyColor(a.party)}`}>{a.party ?? ''}</span>
                  <span className={i === 0 ? 'font-semibold' : ''}>
                    {a.name}
                    {a.isIncumbent ? <span className="ml-2 text-xs text-muted-foreground">(incumbent)</span> : null}
                    {!race.isRcv && i === 0 ? <span className="ml-2 text-xs text-emerald-400">winner</span> : null}
                    {a.advanced && i > 0 ? <span className="ml-2 text-xs text-emerald-400">advanced</span> : null}
                  </span>
                </span>
                <span className="font-mono tabular-nums">{fmtPct(a.pct)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {finalRound && finalRound.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">
            Final round
            <span className="ml-2 text-xs font-normal text-muted-foreground">(after eliminations — not used for poll accuracy)</span>
          </h2>
          <ul className="divide-y divide-border/40 rounded border border-border/60">
            {finalRound.map((a, i) => (
              <li key={i} className="flex items-baseline justify-between px-4 py-2">
                <span className="flex items-baseline gap-2">
                  <span className={`text-xs ${partyColor(a.party)}`}>{a.party ?? ''}</span>
                  <span className={i === 0 ? 'font-semibold' : ''}>
                    {a.name}
                    {i === 0 ? <span className="ml-2 text-xs text-emerald-400">winner</span> : null}
                  </span>
                </span>
                <span className="font-mono tabular-nums">{fmtPct(a.pct)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Polls vs. actual result</h2>
        <CandidateComparison polls={polls} actuals={actuals} />
      </section>

      {chartPolls.length >= 2 ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Polls over time</h2>
          <div className="rounded border border-border/60 p-3">
            <RaceCandidateChart
              polls={chartPolls}
              electionDate={race.electionDate.toISOString()}
              actuals={actuals}
              topCandidateNames={topCandidateNames}
            />
          </div>
        </section>
      ) : null}

      {spotChecks.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Per-poll accuracy</h2>
          <div className="overflow-x-auto rounded border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-medium">Pollster</th>
                  <th className="px-3 py-2 text-left font-medium">End date</th>
                  <th className="px-3 py-2 text-left font-medium">Winner?</th>
                  <th className="px-3 py-2 text-left font-medium">Top 2?</th>
                  <th className="px-3 py-2 text-left font-medium">Vote-wt err</th>
                  <th className="px-3 py-2 text-left font-medium">Per-cand err</th>
                  <th className="px-3 py-2 text-left font-medium">Margin err</th>
                </tr>
              </thead>
              <tbody>
                {spotChecks.map((s) => (
                  <tr key={s.poll.id} className="border-b border-border/40">
                    <td className="px-3 py-2">{s.poll.pollster.name}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {typeof s.poll.endDate === 'string' ? s.poll.endDate.slice(0, 10) : s.poll.endDate.toISOString().slice(0, 10)}
                    </td>
                    <td className="px-3 py-2 font-mono">{boolBadge(s.calledWinner)}</td>
                    <td className="px-3 py-2 font-mono">{boolBadge(s.calledTopTwo)}</td>
                    <td className="px-3 py-2 font-mono">{s.weightedError == null ? '—' : `${s.weightedError.toFixed(2)}`}</td>
                    <td className="px-3 py-2 font-mono">{s.meanError == null ? '—' : `${s.meanError.toFixed(1)}`}</td>
                    <td className="px-3 py-2 font-mono">{s.marginError == null ? '—' : `${s.marginError.toFixed(1)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">All polls</h2>
        <PollsTable polls={polls} showRace={false} />
      </section>

      {race.notes ? (
        <section>
          <h2 className="text-lg font-semibold">Notes</h2>
          <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{race.notes}</p>
        </section>
      ) : null}
    </div>
  )
}

function boolBadge(v: boolean | null): React.ReactNode {
  if (v === null) return '—'
  return v ? <span className="text-emerald-400">✓</span> : <span className="text-red-400">✗</span>
}
