#!/usr/bin/env tsx
/**
 * Backfill actualResults for races that don't have them.
 *
 * Strategy: for each race with null actualResults, grab the source URL from its
 * first poll (typically a Wikipedia page), fetch it, and ask Claude to extract
 * ONLY this specific race's final result. Update the DB.
 *
 * Usage:
 *   npm run research:fill-results
 *   npm run research:fill-results -- --concurrency=3
 *   npm run research:fill-results -- --year=2025
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../prisma/client'

const SYSTEM = `You extract the final certified result of one US mayoral race from a Wikipedia page.

The user will tell you exactly which race to extract. The page may include MANY races (first round, runoff, primary, general); be sure to return ONLY the one requested.

Return JSON only:
{
  "actualResults": [
    { "name": "Brandon Johnson", "party": "D", "pct": 51.4, "advanced": true, "isIncumbent": false },
    { "name": "Paul Vallas", "party": "D", "pct": 48.6, "advanced": false }
  ]
}

Rules:
- Sort actualResults from highest to lowest pct.
- Include ALL candidates listed in the final certified result for this race (not just top 2).
- "advanced": true for candidates who moved on to the next round (e.g. in a top-two primary). For terminal races (general, runoff), set false or omit.
- If the result for the specific race isn't on the page, return { "actualResults": null }.
- Do not fabricate. Match the request EXACTLY (city, date, race type, party).`

const args = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/)
  if (m) acc[m[1]] = m[2] ?? 'true'
  return acc
}, {})

async function main() {
  const concurrency = parseInt(args.concurrency ?? '3', 10) || 3
  const yearFilter = args.year ? parseInt(args.year, 10) : undefined

  // winnerName is null iff actualResults is null in our pipeline (set together),
  // and querying nullable scalar avoids Prisma's JSON-null-vs-DB-null confusion.
  const where: Record<string, unknown> = { winnerName: null }
  if (yearFilter) where.electionYear = yearFilter

  const races = await prisma.race.findMany({
    where,
    orderBy: [{ electionYear: 'desc' }, { id: 'asc' }],
    include: {
      city: true,
      polls: {
        where: { status: 'PUBLISHED' },
        select: { sourceUrl: true },
        take: 1,
      },
    },
  })

  console.log(`${races.length} races missing actualResults, concurrency=${concurrency}`)

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 120_000,
    maxRetries: 1,
  })

  let done = 0
  let updated = 0
  let noUrl = 0
  let noResult = 0
  let errors = 0
  const queue = [...races]

  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  console.log(`\nDone. ${updated} updated, ${noResult} no-result-on-page, ${noUrl} missing source URL, ${errors} errors (of ${races.length}).`)
  process.exit(0)

  async function worker() {
    while (queue.length) {
      const race = queue.shift()
      if (!race) return
      const idx = ++done
      const sourceUrl = race.polls[0]?.sourceUrl
      if (!sourceUrl) {
        noUrl++
        process.stdout.write(`\n[${idx}/${races.length}] ${race.id} → no source URL`)
        continue
      }
      try {
        const actuals = await fetchAndExtract(anthropic, race, sourceUrl)
        if (!actuals || actuals.length === 0) {
          noResult++
          process.stdout.write(`\n[${idx}/${races.length}] ${race.id} → no result on page`)
          continue
        }
        const sorted = [...actuals].sort((a, b) => b.pct - a.pct)
        await prisma.race.update({
          where: { id: race.id },
          data: {
            actualResults: sorted as never,
            winnerName: sorted[0]?.name ?? null,
            winnerPct: sorted[0]?.pct ?? null,
            runnerUpName: sorted[1]?.name ?? null,
            runnerUpPct: sorted[1]?.pct ?? null,
            topMargin: sorted[0] && sorted[1] ? sorted[0].pct - sorted[1].pct : null,
          },
        })
        updated++
        process.stdout.write(`\n[${idx}/${races.length}] ${race.id} → ${sorted.map((c) => `${c.name} ${c.pct.toFixed(1)}`).slice(0, 3).join(' / ')}`)
      } catch (err) {
        errors++
        process.stdout.write(`\n[${idx}/${races.length}] ${race.id} → ERROR: ${(err as Error).message}`)
      }
    }
  }
}

type Actual = { name: string; party?: string | null; pct: number; isIncumbent?: boolean; advanced?: boolean }

async function fetchAndExtract(
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
): Promise<Actual[] | null> {
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

  // Pull Results section(s).
  const sections: string[] = []
  for (const m of html.matchAll(/<h2[^>]*id="([^"]+)"[\s\S]*?(?=<h2|<div class="navbox)/gi)) {
    const id = m[1].toLowerCase()
    if (
      id.includes('result') ||
      id.includes('round') ||
      id.includes('runoff') ||
      id.includes('primary') ||
      id.includes('general')
    ) {
      sections.push(m[0])
    }
  }
  const target = sections.length > 0 ? sections.join('\n\n') : html

  const stripped = target
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#?[a-z0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150_000)

  const raceDescriptor = describeRace(race)
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM,
    messages: [{ role: 'user', content: `Extract the final certified result for THIS specific race only:\n\n${raceDescriptor}\n\nSource: ${sourceUrl}\n\n--- PAGE TEXT (results section) ---\n${stripped}` }],
  })

  const text = msg.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('\n')
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  try {
    const parsed = JSON.parse(jsonMatch[0])
    return Array.isArray(parsed.actualResults) ? (parsed.actualResults as Actual[]) : null
  } catch {
    return null
  }
}

function describeRace(race: {
  electionDate: Date
  electionYear: number
  raceType: string
  party: string | null
  city: { name: string; stateCode: string }
}): string {
  const date = race.electionDate.toISOString().slice(0, 10)
  const partyStr = race.party ? ` (${race.party} party)` : ''
  const typeLabel =
    race.raceType === 'PARTISAN_PRIMARY' || race.raceType === 'NONPARTISAN_PRIMARY' || race.raceType === 'SPECIAL_PRIMARY'
      ? 'primary / first round'
      : race.raceType === 'RUNOFF' || race.raceType === 'SPECIAL_RUNOFF'
        ? 'runoff / second round'
        : 'general election'
  return `City: ${race.city.name}, ${race.city.stateCode}
Race date: ${date}
Race type: ${race.raceType} (${typeLabel})${partyStr}
Election year: ${race.electionYear}`
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
