import type { RaceType, SponsorType } from '@db/enums'

export type CandidateResult = {
  name: string
  party?: string | null
  pct: number
  isIncumbent?: boolean
  advanced?: boolean
}

export type ScoredPoll = {
  pollId: string
  raceId: string
  candidates: CandidateResult[]   // poll's measurement
  actuals: CandidateResult[]      // race's actual result
  undecidedPct?: number           // for allocating undecided proportionately
  daysToElection: number
  sponsorType: SponsorType
  raceType: RaceType
  electionYear: number
}

// ────────────────────────────────────────────────────────────────────────────
// Per-poll accuracy metrics
// ────────────────────────────────────────────────────────────────────────────

const norm = (s: string) =>
  s.toLowerCase().replace(/\(.+?\)/g, '').replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).slice(-1)[0]

function matchActual(name: string, actuals: CandidateResult[]): CandidateResult | undefined {
  const n = norm(name)
  return (
    actuals.find((a) => norm(a.name) === n) ||
    actuals.find((a) => norm(a.name).startsWith(n)) ||
    actuals.find((a) => n.startsWith(norm(a.name)))
  )
}

/** Did the poll's leading candidate match the actual winner? null if data missing. */
export function calledWinner(poll: ScoredPoll): boolean | null {
  const top = sortByPct(poll.candidates)[0]
  const winner = sortByPct(poll.actuals)[0]
  if (!top || !winner) return null
  return norm(top.name) === norm(winner.name)
}

/** Did the poll's top 2 match the actual top 2 (set-equality, order-independent)? */
export function calledTopTwo(poll: ScoredPoll): boolean | null {
  const pollTop2 = sortByPct(poll.candidates).slice(0, 2)
  const realTop2 = sortByPct(poll.actuals).slice(0, 2)
  if (pollTop2.length < 2 || realTop2.length < 2) return null
  const a = new Set(pollTop2.map((c) => norm(c.name)))
  const b = new Set(realTop2.map((c) => norm(c.name)))
  if (a.size !== 2 || b.size !== 2) return null
  return [...a].every((x) => b.has(x))
}

/** Mean |poll_pct − actual_pct| across candidates that appear in both lists. */
export function meanCandidateError(poll: ScoredPoll): number | null {
  const errors: number[] = []
  for (const p of poll.candidates) {
    const a = matchActual(p.name, poll.actuals)
    if (a) errors.push(Math.abs(p.pct - a.pct))
  }
  if (errors.length === 0) return null
  return errors.reduce((s, e) => s + e, 0) / errors.length
}

/** |poll(top1−top2) − actual(top1−top2)|. */
export function topTwoMarginError(poll: ScoredPoll): number | null {
  const p = sortByPct(poll.candidates)
  const a = sortByPct(poll.actuals)
  if (p.length < 2 || a.length < 2) return null
  const pollMargin = p[0].pct - p[1].pct
  const actualMargin = a[0].pct - a[1].pct
  return Math.abs(pollMargin - actualMargin)
}

/**
 * Vote-weighted error.
 *
 * Step 1: allocate undecided proportionately — multiply each candidate's polled %
 * by 100 / (100 − undecided). A 35% candidate in a poll with 10% undecided becomes
 * 35 * 100/90 = 38.9 projected.
 *
 * Step 2: for each candidate that appears in the actual result, compute
 *   |projected − actual| * sqrt(actual)
 * sum these, divide by sum(sqrt(actual)).
 *
 * Candidates in the actual but not in the poll contribute |0 − actual| * sqrt(actual).
 * Candidates in the poll but not in the actual are ignored (they didn't materially exist).
 *
 * Lower is better.
 */
export function voteWeightedError(poll: ScoredPoll): number | null {
  if (poll.actuals.length === 0) return null
  const undecided = Math.max(0, Math.min(99.99, poll.undecidedPct ?? 0))
  const allocator = 100 / (100 - undecided)

  let sumWeighted = 0
  let sumWeights = 0
  for (const a of poll.actuals) {
    if (a.pct <= 0) continue
    const weight = Math.sqrt(a.pct)
    const polled = matchActual(a.name, poll.candidates)
    const projected = polled ? polled.pct * allocator : 0
    sumWeighted += Math.abs(projected - a.pct) * weight
    sumWeights += weight
  }
  if (sumWeights === 0) return null
  return sumWeighted / sumWeights
}

function sortByPct(cs: CandidateResult[]): CandidateResult[] {
  return [...cs].sort((a, b) => b.pct - a.pct)
}

// ────────────────────────────────────────────────────────────────────────────
// Aggregate stats over a slice of polls
// ────────────────────────────────────────────────────────────────────────────

export type AggregateStats = {
  n: number
  pctCalledWinner: number | null
  pctCalledTopTwo: number | null
  medianCandidateError: number | null
  meanCandidateError: number | null
  medianMarginError: number | null
  medianWeightedError: number | null
  meanWeightedError: number | null
}

export function computeAggregate(polls: ScoredPoll[]): AggregateStats {
  if (polls.length === 0) {
    return {
      n: 0,
      pctCalledWinner: null,
      pctCalledTopTwo: null,
      medianCandidateError: null,
      meanCandidateError: null,
      medianMarginError: null,
      medianWeightedError: null,
      meanWeightedError: null,
    }
  }
  const winners = polls.map(calledWinner).filter((x): x is boolean => x !== null)
  const topTwos = polls.map(calledTopTwo).filter((x): x is boolean => x !== null)
  const candErrors = polls.map(meanCandidateError).filter((x): x is number => x !== null)
  const marginErrors = polls.map(topTwoMarginError).filter((x): x is number => x !== null)
  const weightedErrors = polls.map(voteWeightedError).filter((x): x is number => x !== null)

  return {
    n: polls.length,
    pctCalledWinner: winners.length > 0 ? (winners.filter(Boolean).length / winners.length) * 100 : null,
    pctCalledTopTwo: topTwos.length > 0 ? (topTwos.filter(Boolean).length / topTwos.length) * 100 : null,
    medianCandidateError: median(candErrors),
    meanCandidateError: candErrors.length > 0 ? candErrors.reduce((s, e) => s + e, 0) / candErrors.length : null,
    medianMarginError: median(marginErrors),
    medianWeightedError: median(weightedErrors),
    meanWeightedError: weightedErrors.length > 0 ? weightedErrors.reduce((s, e) => s + e, 0) / weightedErrors.length : null,
  }
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

// ────────────────────────────────────────────────────────────────────────────
// Cuts
// ────────────────────────────────────────────────────────────────────────────

export const DAYS_BUCKETS: Array<{ id: string; label: string; min: number; max: number }> = [
  { id: '0-7', label: '0–7 days out', min: 0, max: 7 },
  { id: '8-14', label: '8–14 days out', min: 8, max: 14 },
  { id: '15-30', label: '15–30 days out', min: 15, max: 30 },
  { id: '31-60', label: '31–60 days out', min: 31, max: 60 },
  { id: '61-120', label: '61–120 days out', min: 61, max: 120 },
  { id: '120+', label: '120+ days out', min: 121, max: Number.POSITIVE_INFINITY },
]

export function inDaysBucket(days: number, bucketId: string): boolean {
  const b = DAYS_BUCKETS.find((x) => x.id === bucketId)
  if (!b) return true
  return days >= b.min && days <= b.max
}

export function isPartisanSponsor(s: SponsorType): boolean {
  return s === 'CAMPAIGN' || s === 'PARTY' || s === 'INDEPENDENT_GROUP'
}
