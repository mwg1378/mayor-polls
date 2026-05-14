/**
 * An "election" = (city, year) — the bundle of all primary/general/runoff races
 * for a single mayoral cycle in a single city. Not a separate DB row; derived
 * from grouping Race records.
 */

export function electionSlug(citySlug: string, year: number): string {
  return `${citySlug}-${year}`
}

/**
 * Parse "new-york-ny-2021" → { citySlug: "new-york-ny", year: 2021 }.
 * Year is the last 4 digits after the final dash.
 */
export function parseElectionSlug(slug: string): { citySlug: string; year: number } | null {
  const m = slug.match(/^(.+)-(\d{4})$/)
  if (!m) return null
  const year = parseInt(m[2], 10)
  if (!Number.isFinite(year)) return null
  return { citySlug: m[1], year }
}

const RACE_TYPE_ORDER: Record<string, number> = {
  PARTISAN_PRIMARY: 1,
  NONPARTISAN_PRIMARY: 2,
  SPECIAL_PRIMARY: 3,
  GENERAL: 4,
  NONPARTISAN_GENERAL: 5,
  SPECIAL_GENERAL: 6,
  RUNOFF: 7,
  SPECIAL_RUNOFF: 8,
}

export function compareRacesInElection(
  a: { electionDate: Date | string; raceType: string },
  b: { electionDate: Date | string; raceType: string },
): number {
  const ad = new Date(a.electionDate).getTime()
  const bd = new Date(b.electionDate).getTime()
  if (ad !== bd) return ad - bd
  return (RACE_TYPE_ORDER[a.raceType] ?? 99) - (RACE_TYPE_ORDER[b.raceType] ?? 99)
}
