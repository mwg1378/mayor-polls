import { prisma } from '@/prisma/client'
import { AccuracyCard } from '@/components/accuracy-card'
import {
  computeAggregate,
  DAYS_BUCKETS,
  inDaysBucket,
  isPartisanSponsor,
  type CandidateResult,
  type ScoredPoll,
} from '@/lib/accuracy'

export const revalidate = 300

export default async function AccuracyPage() {
  const rows = await prisma.poll.findMany({
    where: {
      status: 'PUBLISHED',
      race: { actualResults: { not: undefined } },
    },
    select: {
      id: true,
      raceId: true,
      candidates: true,
      undecidedPct: true,
      daysToElection: true,
      sponsorType: true,
      race: { select: { actualResults: true, electionYear: true, raceType: true } },
    },
  })

  const polls: ScoredPoll[] = rows
    .filter((r) => r.race.actualResults != null)
    .map((r) => ({
      pollId: r.id,
      raceId: r.raceId,
      candidates: r.candidates as CandidateResult[],
      actuals: r.race.actualResults as CandidateResult[],
      undecidedPct: r.undecidedPct,
      daysToElection: r.daysToElection,
      sponsorType: r.sponsorType,
      raceType: r.race.raceType,
      electionYear: r.race.electionYear,
    }))

  const overall = computeAggregate(polls)
  const cycles = Array.from(new Set(polls.map((p) => p.electionYear))).sort((a, b) => b - a)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 space-y-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Pollster accuracy</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every poll in our database whose race has a known final result is scored four ways: did it call the
          winner; did it call the right top-two; mean per-candidate absolute error; top-two margin error.
          Different cuts shown below — a poll counts in every applicable bucket.
        </p>
        <div className="text-xs text-muted-foreground">In scope: {polls.length} polls</div>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">By days to election</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <AccuracyCard title="All polls (any timing)" stats={overall} />
          {DAYS_BUCKETS.map((b) => (
            <AccuracyCard
              key={b.id}
              title={b.label}
              stats={computeAggregate(polls.filter((p) => inDaysBucket(p.daysToElection, b.id)))}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">By race type (within 30 days)</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <AccuracyCard
            title="Primaries (D / R / nonpartisan)"
            sub="≤30 days · partisan + nonpartisan primaries"
            stats={computeAggregate(
              polls.filter(
                (p) =>
                  p.daysToElection <= 30 &&
                  (p.raceType === 'PARTISAN_PRIMARY' || p.raceType === 'NONPARTISAN_PRIMARY' || p.raceType === 'SPECIAL_PRIMARY'),
              ),
            )}
          />
          <AccuracyCard
            title="General elections"
            sub="≤30 days · general / nonpartisan general / special"
            stats={computeAggregate(
              polls.filter(
                (p) =>
                  p.daysToElection <= 30 &&
                  (p.raceType === 'GENERAL' || p.raceType === 'NONPARTISAN_GENERAL' || p.raceType === 'SPECIAL_GENERAL'),
              ),
            )}
          />
          <AccuracyCard
            title="Runoffs"
            sub="≤30 days · runoff + special runoff"
            stats={computeAggregate(
              polls.filter((p) => p.daysToElection <= 30 && (p.raceType === 'RUNOFF' || p.raceType === 'SPECIAL_RUNOFF')),
            )}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">By sponsor type (within 30 days)</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <AccuracyCard
            title="Nonpartisan / news"
            sub="≤30 days"
            stats={computeAggregate(polls.filter((p) => p.daysToElection <= 30 && !isPartisanSponsor(p.sponsorType)))}
          />
          <AccuracyCard
            title="Partisan internals"
            sub="≤30 days · campaigns / parties / aligned groups"
            stats={computeAggregate(polls.filter((p) => p.daysToElection <= 30 && isPartisanSponsor(p.sponsorType)))}
          />
        </div>
      </section>

      {cycles.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">By cycle</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cycles.map((y) => (
              <AccuracyCard
                key={y}
                title={String(y)}
                sub="all timings"
                stats={computeAggregate(polls.filter((p) => p.electionYear === y))}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
