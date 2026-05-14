import Link from 'next/link'
import { prisma } from '@/prisma/client'
import { electionSlug } from '@/lib/election'

export const revalidate = 300

export default async function ElectionsIndex() {
  const races = await prisma.race.findMany({
    where: { polls: { some: { status: 'PUBLISHED' } } },
    select: {
      citySlug: true,
      electionYear: true,
      raceType: true,
      winnerName: true,
      city: { select: { name: true, stateCode: true, population: true } },
      _count: { select: { polls: { where: { status: 'PUBLISHED' } } } },
    },
  })

  // Group races by (citySlug, electionYear).
  type Bucket = {
    citySlug: string
    cityName: string
    stateCode: string
    year: number
    population: number
    raceCount: number
    pollCount: number
    winners: string[]
  }
  const map = new Map<string, Bucket>()
  for (const r of races) {
    const key = `${r.citySlug}-${r.electionYear}`
    let b = map.get(key)
    if (!b) {
      b = {
        citySlug: r.citySlug,
        cityName: r.city.name,
        stateCode: r.city.stateCode,
        year: r.electionYear,
        population: r.city.population,
        raceCount: 0,
        pollCount: 0,
        winners: [],
      }
      map.set(key, b)
    }
    b.raceCount++
    b.pollCount += r._count.polls
    if (r.winnerName) b.winners.push(r.winnerName)
  }

  // Sort: most recent year first; within year, by population desc.
  const elections = [...map.values()].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year
    return b.population - a.population
  })

  // Group by year for section headers.
  const byYear = new Map<number, Bucket[]>()
  for (const e of elections) {
    const list = byYear.get(e.year) ?? []
    list.push(e)
    byYear.set(e.year, list)
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Elections</h1>
        <p className="text-sm text-muted-foreground">
          {elections.length} mayoral elections in our dataset, grouped by year. Each election bundles its primary,
          general, and runoff races (where applicable).
        </p>
      </header>
      {[...byYear.entries()].map(([year, list]) => (
        <section key={year} className="space-y-3">
          <h2 className="text-lg font-semibold">{year}</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((e) => (
              <Link
                key={`${e.citySlug}-${e.year}`}
                href={`/elections/${electionSlug(e.citySlug, e.year)}`}
                className="flex items-baseline justify-between rounded border border-border/60 px-3 py-2 transition-colors hover:bg-muted/50"
              >
                <div>
                  <div className="font-medium">{e.cityName}, {e.stateCode}</div>
                  <div className="text-xs text-muted-foreground">
                    {e.raceCount} race{e.raceCount === 1 ? '' : 's'}
                    {dedupe(e.winners).length > 0 ? ` · ${dedupe(e.winners)[0]} won` : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono tabular-nums">{e.pollCount}</div>
                  <div className="text-xs text-muted-foreground">polls</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function dedupe<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}
