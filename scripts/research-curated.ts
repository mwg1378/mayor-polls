#!/usr/bin/env tsx
/**
 * Curated-URL research pass for big-city mayoral races.
 *
 * Iterates over scripts/curated-urls.ts (Wikipedia per-race pages), fetches each,
 * isolates the polling section + result section, asks Claude to extract structured
 * poll records (with full candidate arrays) plus the race's actual final result,
 * and appends results to seed/polls-curated-YYYY-MM-DD.jsonl.
 *
 * Usage:
 *   npm run research:curated
 *   npm run research:curated -- --concurrency=4
 *   npm run research:curated -- --start=10 --limit=20
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()

import fs from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { CURATED_URLS } from './curated-urls'

const SYSTEM = `You extract structured poll records from web pages about US big-city mayoral elections.

Return JSON only, no prose. Use this schema:
{
  "polls": [
    {
      "cityName": "Chicago",
      "stateCode": "IL",
      "electionYear": 2023,
      "electionDate": "2023-04-04",
      "raceType": "PARTISAN_PRIMARY" | "NONPARTISAN_PRIMARY" | "GENERAL" | "NONPARTISAN_GENERAL" | "RUNOFF" | "SPECIAL_GENERAL" | "SPECIAL_PRIMARY" | "SPECIAL_RUNOFF",
      "party": "D" | "R" | null,
      "pollsterName": "Public Policy Polling",
      "sponsor": "Public Policy Polling",
      "sponsorType": "CAMPAIGN" | "PARTY" | "INDEPENDENT_GROUP" | "NEWS_MEDIA" | "NONPARTISAN_PUBLIC" | "UNKNOWN",
      "startDate": "2023-03-25",
      "endDate": "2023-03-29",
      "sampleSize": 1042,
      "population": "LV" | "RV" | "A" | "UNKNOWN",
      "mode": "live phone" | "IVR" | "online panel" | "mixed" | null,
      "candidates": [
        { "name": "Brandon Johnson", "party": "D", "pct": 49.0 },
        { "name": "Paul Vallas", "party": "D", "pct": 47.0 }
      ],
      "undecidedPct": 4.0,
      "methodologyNotes": "MoE ±3.5",
      "sourceUrl": "https://...",
      "sourceType": "WIKIPEDIA"
    }
  ],
  "actualResults": [
    { "name": "Brandon Johnson", "party": "D", "pct": 51.4, "advanced": true, "isIncumbent": false },
    { "name": "Paul Vallas", "party": "D", "pct": 48.6, "advanced": false }
  ],
  "actualMeta": {
    "cityName": "Chicago",
    "stateCode": "IL",
    "electionDate": "2023-04-04",
    "raceType": "RUNOFF",
    "party": null
  }
}

Hard rules:
- Only mayoral races (city mayor). Skip everything else.
- Polls must give numeric % for at least 2 named candidates. Skip favorability-only or yes/no polls.
- For Wikipedia pages with both a primary AND a runoff (e.g. Chicago, Houston, NOLA), return polls for BOTH races. Tag each with the correct raceType. Pre-runoff polls go with raceType=RUNOFF; pre-first-round polls go with NONPARTISAN_PRIMARY (or PARTISAN_PRIMARY if party-specific).
- For NYC Democratic primary pages, raceType=PARTISAN_PRIMARY with party="D".
- For top-two systems (Chicago, Seattle, Phoenix, Houston, etc.), the first round is NONPARTISAN_PRIMARY; the second round is RUNOFF. PARTISAN_PRIMARY is for D-only or R-only primaries (NYC, Philadelphia D primary, etc.).
- "candidates" array should include ALL candidates the poll measured, in any order; we'll sort.
- "actualResults" should include the final certified vote shares — one entry per candidate. Sort highest to lowest. Only include final result for the race that the polls listed are for. If page covers both first round and runoff, return TWO records (one for each race) by emitting separate polls and actualMeta entries — but if you can only return one actualMeta object, emit the runoff (final round) result and put runoff polls only.
  Actually: if page covers both rounds, return all polls (each tagged with raceType) but emit actualResults+actualMeta only for the FINAL round. We'll handle round-1 actuals from a separate pass.
- "actualMeta.party" matches the polls' "party".
- If you can't identify a clean field, use null.
- DO NOT FABRICATE. If the page has no polling table, return polls: [], actualResults: null.

Pollster name normalization:
- "NYT/Siena" → "New York Times / Siena College"
- "Quinnipiac" → "Quinnipiac University"
- Use the pollster's printed name, not abbreviations.`

const args = process.argv.slice(2).reduce<Record<string, string>>((acc, a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/)
  if (m) acc[m[1]] = m[2] ?? 'true'
  return acc
}, {})

async function main() {
  const concurrency = parseInt(args.concurrency ?? '4', 10) || 4
  const start = parseInt(args.start ?? '0', 10) || 0
  const limit = args.limit ? parseInt(args.limit, 10) : undefined
  const targets = CURATED_URLS.slice(start, limit ? start + limit : undefined)

  const outDir = path.join(process.cwd(), 'seed')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `polls-curated-${new Date().toISOString().slice(0, 10)}.jsonl`)
  const out = fs.createWriteStream(outPath, { flags: 'a' })

  console.log(`Curated research: ${targets.length} URLs, concurrency=${concurrency} → ${outPath}`)

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 180_000, maxRetries: 1 })

  let done = 0
  let totalPolls = 0
  let errors = 0
  const queue = [...targets]

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  out.end()

  console.log(`\n\nDone. ${totalPolls} candidate polls from ${done - errors}/${targets.length} URLs (${errors} errors). → ${outPath}`)
  console.log(`Next: npm run research:import -- ${outPath} --published`)

  async function worker() {
    while (queue.length) {
      const t = queue.shift()
      if (!t) return
      const idx = ++done
      try {
        const polls = await processUrl(anthropic, t.url)
        for (const p of polls) out.write(JSON.stringify({ ...p, sourceUrl: p.sourceUrl || t.url, _src: t.url }) + '\n')
        totalPolls += polls.length
        process.stdout.write(`\n[${idx}/${targets.length}] ${t.url} → ${polls.length} polls (total ${totalPolls})${t.note ? ' · ' + t.note : ''}`)
      } catch (err) {
        errors++
        process.stdout.write(`\n[${idx}/${targets.length}] ${t.url} → ERROR: ${(err as Error).message}`)
      }
    }
  }
}

async function processUrl(anthropic: Anthropic, url: string): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()

  // Extract Polling section + Results section if present.
  const sections: string[] = []
  for (const idMatch of html.matchAll(/<h2[^>]*id="([^"]+)"[\s\S]*?(?=<h2|<div class="navbox)/gi)) {
    const id = idMatch[1].toLowerCase()
    if (
      id.includes('poll') ||
      id.includes('result') ||
      id.includes('campaign') ||
      id.includes('primary') ||
      id.includes('runoff') ||
      id.includes('general')
    ) {
      sections.push(idMatch[0])
    }
  }
  const candidate = sections.length > 0 ? sections.join('\n\n') : html

  const stripped = candidate
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#?[a-z0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180_000)

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 32_000,
    system: SYSTEM,
    messages: [{ role: 'user', content: `Source URL: ${url}\n\n--- PAGE TEXT (polling + results sections) ---\n${stripped}` }],
  })

  const text = msg.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('\n')

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    if (process.env.RESEARCH_DEBUG === '1') {
      process.stdout.write(`\n[debug ${url}] no JSON; first 600 chars of model response:\n${text.slice(0, 600)}\n`)
    }
    return []
  }
  let parsed: { polls?: unknown[]; actualResults?: unknown[]; actualMeta?: Record<string, unknown> }
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch (err) {
    if (process.env.RESEARCH_DEBUG === '1') {
      process.stdout.write(`\n[debug ${url}] JSON parse failed: ${(err as Error).message}\nFirst 400 chars of match: ${jsonMatch[0].slice(0, 400)}\n`)
    }
    return []
  }

  const polls = Array.isArray(parsed.polls) ? parsed.polls : []
  const actuals = Array.isArray(parsed.actualResults) ? parsed.actualResults : null
  const meta = parsed.actualMeta ?? null

  // Attach actualResults to polls whose race matches actualMeta (so the importer creates the race + result together).
  if (actuals && meta) {
    for (const p of polls) {
      const pp = p as Record<string, unknown>
      if (
        pp.cityName === meta.cityName &&
        pp.stateCode === meta.stateCode &&
        pp.raceType === meta.raceType &&
        (pp.party ?? null) === (meta.party ?? null)
      ) {
        pp.actualResults = actuals
      }
    }
  }

  return polls as Array<Record<string, unknown>>
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
