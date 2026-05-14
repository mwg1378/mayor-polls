export const metadata = {
  title: 'About / Methodology — mayor-polls',
}

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 space-y-6 text-sm leading-relaxed">
      <h1 className="text-2xl font-bold tracking-tight">About / Methodology</h1>

      <section>
        <h2 className="mt-6 text-lg font-semibold">What this site is</h2>
        <p className="mt-2">
          A pollster-accuracy tracker for US big-city mayoral elections. We aggregate publicly-released polls of
          mayoral primaries, general elections, and runoffs in cities of <strong>200,000+ population</strong>, score
          each poll against the actual result, and surface accuracy stats by pollster, race type, sponsor type, and
          days-to-election.
        </p>
        <p className="mt-2">
          The motivation: 538/Silver Bulletin/Race-to-the-WH have rich data on national, gubernatorial, and Senate
          polling, but mayoral races are conspicuously absent — even for Chicago, NYC, LA, Seattle, and similar.
        </p>
      </section>

      <section>
        <h2 className="mt-6 text-lg font-semibold">What counts as a poll</h2>
        <p className="mt-2">
          Any poll asking about head-to-head support among named candidates for a specific mayoral race in our
          covered cities. Both <em>nonpartisan/public</em> polls (universities, news media, independent firms)
          and <em>partisan internals</em> (campaigns, party committees, aligned groups) are included — the
          latter clearly labeled with sponsor type.
        </p>
        <p className="mt-2">
          Generic-ballot or favorability polls without head-to-head matchups are out of scope. Same for
          gubernatorial / federal / state-leg polls.
        </p>
      </section>

      <section>
        <h2 className="mt-6 text-lg font-semibold">Multi-candidate polls & accuracy</h2>
        <p className="mt-2">
          Mayoral primaries often have 5–10 viable candidates; meaningful margins aren't always top-1 minus top-2.
          We store each poll's <strong>full candidate list</strong> and the race's <strong>full final result</strong>,
          and surface several accuracy metrics per poll:
        </p>
        <p className="mt-3 font-medium">Primary metric — vote-weighted error</p>
        <p className="mt-2">
          Lower is better. Computed in two steps:
        </p>
        <ol className="ml-6 mt-2 list-decimal space-y-1">
          <li><strong>Allocate undecideds proportionately.</strong> Each candidate's projected share = their polled
            % × <code>100 / (100 − undecided%)</code>. So in a poll with 10% undecided, a 35% candidate is treated
            as projecting 38.9.</li>
          <li><strong>Weight each candidate by √(actual share).</strong> For every candidate i in the final result, take
            <code>|projected_i − actual_i| × √actual_i</code>. Sum those, then divide by <code>Σ √actual_i</code>.
            This counts higher performers more heavily — being 3 points off on the eventual winner matters more
            than being 3 points off on a 4% also-ran — without ignoring smaller candidates entirely.</li>
        </ol>
        <p className="mt-3 font-medium">Secondary metrics</p>
        <ul className="ml-6 mt-2 list-disc space-y-1">
          <li><strong>Called winner</strong> — binary: did the poll's leading candidate match the actual winner?</li>
          <li><strong>Called top 2</strong> — binary: did the poll's top 2 (set, order-independent) match the actual top 2?</li>
          <li><strong>Top-two margin error</strong> — <code>|poll(top1−top2) − actual(top1−top2)|</code>, the traditional 538-style metric.</li>
          <li><strong>Mean per-candidate error</strong> — unweighted average <code>|poll_pct − actual_pct|</code>.</li>
        </ul>
      </section>

      <section>
        <h2 className="mt-6 text-lg font-semibold">How polls are sourced</h2>
        <p className="mt-2">
          Initial seed: a curated extraction pass against Wikipedia per-race pages (which have surprisingly
          full polling tables for big-city mayoral races) plus targeted news / pollster URLs. All extraction
          uses Claude with a strict JSON schema; results are reviewed before publishing.
        </p>
        <p className="mt-2">
          Ongoing: a weekly cron job scans configured sources, extracts candidate poll records, and queues them
          as <code>PENDING</code> for human review before going live.
        </p>
      </section>

      <section>
        <h2 className="mt-6 text-lg font-semibold">Population threshold</h2>
        <p className="mt-2">
          We track cities with population <strong>≥ 200,000</strong> (about 120 US cities), based on 2020 Census
          and post-2020 estimates.
        </p>
      </section>

      <section>
        <h2 className="mt-6 text-lg font-semibold">Caveats</h2>
        <ul className="ml-6 mt-2 list-disc space-y-1">
          <li>Not every covered city's mayoral races have publicly-available polls — most don't.</li>
          <li>Partisan internals are biased by definition; we publish them for transparency, not endorsement.</li>
          <li>Multi-round elections (top-two primary → general, or general → runoff) are tracked as separate races.</li>
          <li>Found a missing poll or an error? File an issue on{' '}
            <a className="hover:underline" href="https://github.com/mwg1378/mayor-polls/issues" target="_blank" rel="noopener">GitHub</a>.</li>
        </ul>
      </section>
    </div>
  )
}
