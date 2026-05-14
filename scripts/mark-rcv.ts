#!/usr/bin/env tsx
/**
 * Mark known RCV (ranked-choice voting) races and ensure their actualResults
 * are the FIRST-CHOICE tally (what polls measure), with the after-elimination
 * final round stored separately in finalRoundResults.
 *
 * For races where current actualResults has been truncated to just the top 2
 * (i.e. someone stored the final round there by mistake), re-extract the
 * first-choice tally from Wikipedia and shuffle the existing tally into
 * finalRoundResults.
 *
 * Usage:
 *   npm run research:mark-rcv
 *   npm run research:mark-rcv -- --dry
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../prisma/client'

/**
 * Known RCV races in covered cities. Keys are race-ID patterns (substrings)
 * so we don't have to hand-spell every electionDate.
 *
 * - NYC: Democratic & Republican primaries use RCV since 2021. General is NOT RCV.
 * - San Francisco: nonpartisan generals & specials use RCV since 2007.
 * - Oakland: RCV since 2010.
 * - Minneapolis: RCV since 2009.
 * - Saint Paul: RCV since 2011.
 * - Berkeley, Cambridge, Portland ME not in our covered cities list.
 */
const RCV_RACE_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  // NYC partisan primaries from 2021 onward
  { pattern: /^new-york-ny-202[1-9]-.*-partisan-primary-d$/, description: 'NYC D primary 2021+' },
  { pattern: /^new-york-ny-202[1-9]-.*-partisan-primary-r$/, description: 'NYC R primary 2021+' },
  { pattern: /^new-york-ny-203[0-9]-.*-partisan-primary-[dr]$/, description: 'NYC partisan primary 2030+' },

  // San Francisco mayoral (all general elections RCV since 2007)
  { pattern: /^san-francisco-ca-20\d{2}-.*-(nonpartisan-general|special-general|runoff)$/, description: 'SF mayoral RCV general' },

  // Oakland mayoral
  { pattern: /^oakland-ca-20\d{2}-.*-(nonpartisan-general|special-general)$/, description: 'Oakland mayoral RCV general' },

  // Minneapolis mayoral
  { pattern: /^minneapolis-mn-20\d{2}-.*-(nonpartisan-general|special-general)$/, description: 'Minneapolis mayoral RCV general' },

  // Saint Paul mayoral
  { pattern: /^(saint|st)-paul-mn-20\d{2}-.*-(nonpartisan-general|special-general)$/, description: 'St Paul mayoral RCV general' },
]

function isRcv(raceId: string): boolean {
  return RCV_RACE_PATTERNS.some((p) => p.pattern.test(raceId))
}

const SYSTEM = `You extract two distinct tallies from a Wikipedia article about an RCV (ranked-choice voting / instant-runoff) mayoral race.

Return JSON only:
{
  "firstChoice": [
    { "name": "Eric Adams", "party": "D", "pct": 30.7, "isIncumbent": false },
    { "name": "Maya Wiley", "party": "D", "pct": 21.4 },
    ...
  ],
  "finalRound": [
    { "name": "Eric Adams", "party": "D", "pct": 50.4 },
    { "name": "Kathryn Garcia", "party": "D", "pct": 49.6 }
  ]
}

Hard rules:
- "firstChoice" = the FIRST-CHOICE / first-round tally — every candidate gets a vote share, sums to ~100%. This is what pollsters measure.
- "finalRound" = the FINAL round after eliminations (typically top 2 with reallocated shares, summing to 100% between them).
- Sort each array highest to lowest pct.
- If the page doesn't have one of the rounds, set that field to null.
- The user tells you which race to extract. Extract ONLY that race; ignore other races on the page.
- Do not fabricate.`

type Round = { name: string; party?: string | null; pct: number; isIncumbent?: boolean; advanced?: boolean }

async function main() {
  const dry = process.argv.includes('--dry')

  const races = await prisma.race.findMany({
    orderBy: [{ electionYear: 'desc' }, { id: 'asc' }],
    include: {
      city: true,
      polls: { where: { status: 'PUBLISHED' }, select: { sourceUrl: true }, take: 1 },
    },
  })

  const targets = races.filter((r) => isRcv(r.id))
  console.log(`${targets.length} RCV-suspect races to process${dry ? ' (dry run)' : ''}`)

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 120_000,
    maxRetries: 1,
  })

  let marked = 0
  let extracted = 0
  let alreadyOk = 0
  let noUrl = 0
  let errors = 0

  for (const race of targets) {
    process.stdout.write(`\n${race.id}`)

    const existingActuals = (race.actualResults as Round[] | null) ?? null
    const existingFinal = (race.finalRoundResults as Round[] | null) ?? null

    const looksTruncated = existingActuals != null && existingActuals.length <= 2

    // If we already have a healthy first-choice tally (>=3 candidates) AND isRcv is set, skip extraction.
    if (race.isRcv && !looksTruncated && existingActuals && existingActuals.length >= 3) {
      alreadyOk++
      process.stdout.write(' → already OK')
      continue
    }

    const sourceUrl = race.polls[0]?.sourceUrl
    if (!sourceUrl) {
      noUrl++
      process.stdout.write(' → no source URL; will just mark isRcv=true')
      if (!dry && !race.isRcv) {
        await prisma.race.update({ where: { id: race.id }, data: { isRcv: true } })
        marked++
      }
      continue
    }

    try {
      const rounds = await fetchRounds(anthropic, race, sourceUrl)
      if (!rounds || (!rounds.firstChoice && !rounds.finalRound)) {
        process.stdout.write(' → page had no usable rounds')
        if (!dry && !race.isRcv) {
          await prisma.race.update({ where: { id: race.id }, data: { isRcv: true } })
          marked++
        }
        continue
      }

      const firstChoice = rounds.firstChoice ?? null
      const finalRound = rounds.finalRound ?? existingFinal ?? (looksTruncated ? existingActuals : null)

      const update: Record<string, unknown> = { isRcv: true }
      if (firstChoice && firstChoice.length > 0) {
        const sorted = [...firstChoice].sort((a, b) => b.pct - a.pct)
        update.actualResults = sorted
        // winnerName/Pct stays as the FINAL-round winner if we have one; else top of first choice.
        const finalWinner = finalRound && finalRound.length > 0 ? [...finalRound].sort((a, b) => b.pct - a.pct)[0] : null
        update.winnerName = finalWinner?.name ?? sorted[0]?.name ?? null
        update.winnerPct = finalWinner?.pct ?? sorted[0]?.pct ?? null
        const finalRunner = finalRound && finalRound.length > 1 ? [...finalRound].sort((a, b) => b.pct - a.pct)[1] : null
        update.runnerUpName = finalRunner?.name ?? sorted[1]?.name ?? null
        update.runnerUpPct = finalRunner?.pct ?? sorted[1]?.pct ?? null
        if (finalWinner && finalRunner) update.topMargin = finalWinner.pct - finalRunner.pct
      }
      if (finalRound && finalRound.length > 0) {
        update.finalRoundResults = [...finalRound].sort((a, b) => b.pct - a.pct)
      }

      process.stdout.write(
        ` → first-choice n=${firstChoice?.length ?? 0}, final-round n=${finalRound?.length ?? 0}`,
      )

      if (!dry) {
        await prisma.race.update({ where: { id: race.id }, data: update })
        extracted++
      }
    } catch (err) {
      errors++
      process.stdout.write(` → ERROR: ${(err as Error).message}`)
    }
  }

  console.log(
    `\n\nDone. ${extracted} extracted+marked, ${marked} marked-only, ${alreadyOk} already OK, ${noUrl} no URL, ${errors} errors.`,
  )
  process.exit(0)
}

async function fetchRounds(
  anthropic: Anthropic,
  race: {
    id: string
    electionDate: Date
    electionYear: number
    raceType: string
    party: string | null
    city: { name: string; stateCode: string }
  },
  sourceUrl: string,
): Promise<{ firstChoice: Round[] | null; finalRound: Round[] | null } | null> {
  const res = await fetch(sourceUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()

  const sections: string[] = []
  for (const m of html.matchAll(/<h2[^>]*id="([^"]+)"[\s\S]*?(?=<h2|<div class="navbox)/gi)) {
    const id = m[1].toLowerCase()
    if (
      id.includes('result') ||
      id.includes('round') ||
      id.includes('rcv') ||
      id.includes('ranked') ||
      id.includes('instant') ||
      id.includes('runoff')
    ) {
      sections.push(m[0])
    }
  }
  const candidate = sections.length > 0 ? sections.join('\n\n') : html
  const stripped = candidate
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#?[a-z0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 170_000)

  const descriptor = `City: ${race.city.name}, ${race.city.stateCode}
Date: ${race.electionDate.toISOString().slice(0, 10)}
Type: ${race.raceType}${race.party ? ` (${race.party} party)` : ''}
Year: ${race.electionYear}`

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 6144,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Extract BOTH the first-choice tally and the final-round tally for this RCV race ONLY:\n\n${descriptor}\n\nSource: ${sourceUrl}\n\n--- PAGE TEXT ---\n${stripped}`,
      },
    ],
  })

  const text = msg.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('\n')
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      firstChoice: Array.isArray(parsed.firstChoice) ? (parsed.firstChoice as Round[]) : null,
      finalRound: Array.isArray(parsed.finalRound) ? (parsed.finalRound as Round[]) : null,
    }
  } catch {
    return null
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
