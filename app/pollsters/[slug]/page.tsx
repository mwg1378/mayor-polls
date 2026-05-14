import { notFound } from 'next/navigation'
import { prisma } from '@/prisma/client'
import { PollsTable } from '@/components/polls-table'
import { AccuracyCard } from '@/components/accuracy-card'
import { computeAggregate, type ScoredPoll, type CandidateResult } from '@/lib/accuracy'
import { PARTISAN_LEAN_LABELS } from '@/lib/labels'
import { toPollRow } from '@/app/page'

export const revalidate = 300

export default async function PollsterPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const pollster = await prisma.pollster.findUnique({
    where: { slug },
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
  if (!pollster) return notFound()

  const scoreable: ScoredPoll[] = pollster.polls
    .filter((p) => p.race.actualResults != null)
    .map((p) => ({
      pollId: p.id,
      raceId: p.raceId,
      candidates: p.candidates as CandidateResult[],
      actuals: p.race.actualResults as CandidateResult[],
      undecidedPct: p.undecidedPct,
      daysToElection: p.daysToElection,
      sponsorType: p.sponsorType,
      raceType: p.race.raceType,
      electionYear: p.race.electionYear,
    }))

  const overall = computeAggregate(scoreable)
  const within30 = computeAggregate(scoreable.filter((s) => s.daysToElection <= 30))

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 space-y-8">
      <header className="space-y-1">
        <div className="text-sm uppercase tracking-wide text-muted-foreground">Pollster</div>
        <h1 className="text-2xl font-bold tracking-tight">{pollster.name}</h1>
        <div className="text-sm text-muted-foreground">
          {PARTISAN_LEAN_LABELS[pollster.defaultPartisanLean]} · {pollster.polls.length} mayoral poll{pollster.polls.length === 1 ? '' : 's'}
          {pollster.websiteUrl ? (
            <>
              {' · '}
              <a href={pollster.websiteUrl} target="_blank" rel="noopener" className="hover:text-foreground hover:underline">
                website ↗
              </a>
            </>
          ) : null}
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <AccuracyCard title="All scoreable polls" sub="Races with known result" stats={overall} />
        <AccuracyCard title="Within 30 days of election" sub="Races with known result" stats={within30} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Polls</h2>
        <PollsTable polls={pollster.polls.map(toPollRow)} />
      </section>
    </div>
  )
}
