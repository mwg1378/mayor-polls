import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/prisma/client'
import { PollsTable } from '@/components/polls-table'
import { RaceCandidateChart } from '@/components/race-candidate-chart'
import { CandidateComparison } from '@/components/candidate-comparison'
import { fmtDate, fmtNum } from '@/lib/format'
import { RACE_TYPE_LABELS, partyColor } from '@/lib/labels'
import { compareRacesInElection, parseElectionSlug } from '@/lib/election'
import { toPollRow } from '@/app/page'
import type { CandidateResult } from '@/lib/accuracy'

export const revalidate = 300

export default async function ElectionPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const parsed = parseElectionSlug(slug)
  if (!parsed) return notFound()

  const city = await prisma.city.findUnique({ where: { slug: parsed.citySlug } })
  if (!city) return notFound()

  const races = await prisma.race.findMany({
    where: { citySlug: parsed.citySlug, electionYear: parsed.year },
    orderBy: { electionDate: 'asc' },
    include: {
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

  if (races.length === 0) return notFound()

  const sortedRaces = [...races].sort(compareRacesInElection)

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 space-y-10">
      <header className="space-y-2">
        <div className="text-sm uppercase tracking-wide text-muted-foreground">
          <Link href={`/cities/${city.slug}`} className="hover:text-foreground hover:underline">
            {city.name}, {city.stateCode}
          </Link>
          {' · pop. '}
          {fmtNum(city.population)}
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{parsed.year} mayoral election</h1>
        <div className="text-sm text-muted-foreground">
          {sortedRaces.length} race{sortedRaces.length === 1 ? '' : 's'} · {sortedRaces.reduce((s, r) => s + r.polls.length, 0)} polls
        </div>
      </header>

      {sortedRaces.map((race) => {
        const actuals = (race.actualResults as CandidateResult[] | null) ?? null
        const polls = race.polls.map(toPollRow)
        return (
          <section key={race.id} id={race.id} className="space-y-4 border-t border-border/60 pt-8 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-xl font-semibold">
                  {RACE_TYPE_LABELS[race.raceType]}
                  {race.party ? <span className="ml-2 text-base font-normal text-muted-foreground">({race.party} party)</span> : null}
                </h2>
                <div className="text-sm text-muted-foreground">
                  {fmtDate(race.electionDate)} · {race.polls.length} poll{race.polls.length === 1 ? '' : 's'}
                </div>
              </div>
              <Link href={`/races/${race.id}`} className="text-sm text-muted-foreground hover:text-foreground hover:underline">
                Race detail page →
              </Link>
            </div>

            <CandidateComparison polls={polls} actuals={actuals} />

            {polls.length >= 2 ? (
              <div className="rounded border border-border/60 p-3">
                <RaceCandidateChart
                  polls={polls.map((p) => ({
                    endDate: typeof p.endDate === 'string' ? p.endDate : p.endDate.toISOString(),
                    pollster: p.pollster.name,
                    candidates: p.candidates,
                  }))}
                  electionDate={race.electionDate.toISOString()}
                  actuals={actuals}
                />
              </div>
            ) : null}

            {actuals && actuals.length > 0 ? (
              <details className="rounded border border-border/60">
                <summary className="cursor-pointer px-4 py-2 text-sm font-medium hover:bg-muted/40">
                  Final result: {actuals[0].name} {actuals[0].pct.toFixed(1)}%
                  {actuals[1] ? ` · ${actuals[1].name} ${actuals[1].pct.toFixed(1)}%` : ''}
                </summary>
                <ul className="divide-y divide-border/40 border-t border-border/60">
                  {actuals.slice(0, 10).map((a, i) => (
                    <li key={i} className="flex items-baseline justify-between px-4 py-2 text-sm">
                      <span className="flex items-baseline gap-2">
                        <span className={`text-xs ${partyColor(a.party)}`}>{a.party ?? ''}</span>
                        <span className={i === 0 ? 'font-medium' : ''}>{a.name}</span>
                        {a.isIncumbent ? <span className="text-xs text-muted-foreground">(inc.)</span> : null}
                        {i === 0 ? <span className="text-xs text-emerald-400">winner</span> : null}
                        {a.advanced && i > 0 ? <span className="text-xs text-emerald-400">advanced</span> : null}
                      </span>
                      <span className="font-mono tabular-nums">{a.pct.toFixed(1)}%</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {polls.length > 0 ? (
              <details className="rounded border border-border/60">
                <summary className="cursor-pointer px-4 py-2 text-sm font-medium hover:bg-muted/40">
                  All {polls.length} poll{polls.length === 1 ? '' : 's'}
                </summary>
                <div className="border-t border-border/60">
                  <PollsTable polls={polls} showRace={false} />
                </div>
              </details>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
