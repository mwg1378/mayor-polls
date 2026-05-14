import Link from 'next/link'
import { prisma } from '@/prisma/client'
import { PollsTable } from '@/components/polls-table'
import { fmtNum } from '@/lib/format'
import type { Candidate, PollRowData } from '@/components/poll-row'
import type { CandidateResult } from '@/lib/accuracy'

export const revalidate = 300

export default async function Home() {
  const [pollCount, raceCount, cityCount, recentPollsRaw] = await Promise.all([
    prisma.poll.count({ where: { status: 'PUBLISHED' } }),
    prisma.race.count({ where: { polls: { some: { status: 'PUBLISHED' } } } }),
    prisma.city.count({ where: { races: { some: { polls: { some: { status: 'PUBLISHED' } } } } } }),
    prisma.poll.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { endDate: 'desc' },
      take: 25,
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
    }),
  ])

  const recentPolls: PollRowData[] = recentPollsRaw.map(toPollRow)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 space-y-10">
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">US big-city mayoral polling, scored.</h1>
        <p className="max-w-2xl text-muted-foreground">
          A pollster-accuracy tracker for mayoral races in US cities of 200K+ population — primaries, generals,
          and runoffs since 2013. Each poll is scored against the actual result, with multiple metrics
          (winner called, top-two correct, per-candidate error, margin error).
        </p>
        <div className="flex gap-6 text-sm">
          <Stat label="Polls" value={fmtNum(pollCount)} />
          <Stat label="Races covered" value={fmtNum(raceCount)} />
          <Stat label="Cities polled" value={fmtNum(cityCount)} />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Recent polls</h2>
          <Link href="/polls" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
            See all polls →
          </Link>
        </div>
        <PollsTable polls={recentPolls} />
        <div className="text-xs text-muted-foreground">
          Browse by election: <Link href="/elections" className="hover:text-foreground hover:underline">/elections</Link>
        </div>
      </section>

      <section className="rounded border border-border/60 bg-muted/30 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">How accurate is mayoral polling?</h2>
          <Link href="/accuracy" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
            Full breakdown →
          </Link>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          We score each poll four ways: did it call the winner? did it call the top two? mean per-candidate error,
          and top-two margin error. Cuts by days-to-election, race type (primary/general/runoff), sponsor type,
          and cycle.
        </p>
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  )
}

export function toPollRow(p: {
  id: string
  startDate: Date | string
  endDate: Date | string
  daysToElection: number
  sponsor: string
  sponsorType: PollRowData['sponsorType']
  candidates: unknown
  topName: string
  topPct: number
  runnerUpName: string | null
  runnerUpPct: number | null
  topMargin: number
  undecidedPct: number
  sampleSize: number | null
  population: PollRowData['population']
  sourceUrl: string
  pollster: { slug: string; name: string }
  race: {
    id: string
    citySlug: string
    raceType: PollRowData['race']['raceType']
    electionYear: number
    party: string | null
    actualResults?: unknown
    city: { name: string; stateCode: string }
  }
}): PollRowData {
  return {
    ...p,
    candidates: (p.candidates as Candidate[]) ?? [],
    race: {
      ...p.race,
      actualResults: (p.race.actualResults as CandidateResult[] | null) ?? null,
    },
  }
}
