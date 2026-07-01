// Pure, synchronous computation helpers shared by metrics.ts and cohorts.ts.
//
// This file deliberately has NO "use server" directive. Next.js requires
// every top-level export of a "use server" file to be an async function
// (it treats each one as a Server Action), so a plain sync helper like
// computeTimeWindowedRate can't live in metrics.ts even though that's
// logically where it belongs — it has to live in an ordinary module that
// both action files import from.

// `matched`/`total` are only populated for per-occurrence rate trends (see
// computeTimeWindowedRate below) — they let the UI show "1 of 5 claims paid
// within 24h" instead of a bare percentage, and tell apart a day with no
// claims at all (total: 0) from a day where claims came in but none of them
// were fast enough (total > 0, matched: 0) — both render as `value: 0`
// otherwise, which looks identical on the line but means very different things.
export type MetricDataPoint = { date: string; value: number; matched?: number; total?: number };
// `match_key` is the value of a KPI's configured match_key_property (e.g.
// the policy_id on a claim_paid/claim_start_clicked pair) — when present,
// it's used to group events instead of user_id (see matchOccurrences below).
export type TimedEvent = { timestamp: string; user_id: string | null; match_key?: string | null };

// Per-OCCURRENCE time-window matching: for each individual denominator-event
// instance (e.g. each claim lodged, not each person who lodged one), check
// whether the next not-yet-used numerator event in the SAME group (e.g.
// that claim's payment) lands within `withinHours` hours after it.
//
// The group is the real-world record when one is available (`match_key` —
// e.g. policy_id, shared by both events for the same claim) and otherwise
// falls back to the same-user heuristic this always used. match_key is
// strictly more precise: two events on the same policy are definitely the
// same claim, where two events from the same user are only PROBABLY the
// same claim (a person could have two claims open at once).
//
// This used to match per USER only — it grouped a user's denominator events
// together and counted the whole user as a success if ANY of their
// instances had a matching numerator event in time. For someone with one
// claim that's harmless, but for a user with 10 claims where only 1 paid out
// fast, that read as a 100% match for all 10 — wildly overstating the real
// rate. Matching one numerator event to at most one denominator event
// (consumed in chronological order, per group) fixes that: a single payment
// can no longer count as a fast match for several different claims.
// `requireMatchKey`: when a KPI has match_key_property configured, an event
// that's missing that property isn't a weaker version of a match — it's
// unverifiable, and should be left out rather than quietly falling back to
// the same-person guess. Concretely: if claim_start_clicked/claim_paid carry
// policy_id for auto claims but not for, say, travel claims (no per-claim ID
// at that level), a travel claim with no policy_id would otherwise still
// get grouped by user_id and could falsely match — exactly the kind of
// cross-claim contamination policy_id matching exists to prevent. Default
// false preserves the original behavior for every KPI that never set a
// match_key_property at all (those have no match_key on any event, so this
// distinction never applies to them).
// A flaky tracking implementation (a confirmation screen firing on every
// reload, a retry with no de-dupe, a double-bound click handler) can send
// the SAME real-world event for the SAME claim several times within
// seconds of each other. Left alone, that inflates one real claim into
// several in the data. Two fires of the same event sharing the same group
// key (policy_id, or user_id when no match key is set) within DEDUPE_MS of
// each other are collapsed to one, keeping only the earliest. Two fires
// hours or days apart are NOT touched — a policy genuinely can have more
// than one real claim over its life, and that's a legitimate, separate
// occurrence, not a duplicate.
// Legacy defaults — used when the KPI has no explicit configuration.
// `null` on a KPI row means "use these".
const DEFAULT_DEDUPE_MS     = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MIN_ELAPSED_MS_WHEN_MATCH_KEY = 60 * 60 * 1000; // 1 hour

function dedupeNearFires(
  events: TimedEvent[],
  groupKey: (ev: TimedEvent) => string | null,
  dedupeMs: number = DEFAULT_DEDUPE_MS
): TimedEvent[] {
  const byGroup = new Map<string, TimedEvent[]>();
  for (const ev of events) {
    const key = groupKey(ev);
    if (!key) continue;
    const list = byGroup.get(key);
    if (list) list.push(ev); else byGroup.set(key, [ev]);
  }

  const kept: TimedEvent[] = [];
  for (const list of byGroup.values()) {
    list.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    let lastKeptT = -Infinity;
    for (const ev of list) {
      const t = new Date(ev.timestamp).getTime();
      if (t - lastKeptT > dedupeMs) {
        kept.push(ev);
        lastKeptT = t;
      }
      // else: fired again too soon after the one just kept — same real
      // event, dropped.
    }
  }
  return kept;
}

export function matchOccurrences(
  numeratorEvents: TimedEvent[],
  denominatorEvents: TimedEvent[],
  withinHours: number,
  requireMatchKey: boolean = false,
  // User-configurable matching rules (migration 043). null = use legacy defaults.
  // minElapsedHours: minimum gap between denominator → numerator to count as
  //   a genuine match. null defaults to 1h when requireMatchKey=true (the
  //   old claims-specific hardcoded rule), 0 otherwise.
  // dedupeMinutes: collapse two fires of the same event within this window
  //   into one. null defaults to 5 minutes.
  minElapsedHours: number | null = null,
  dedupeMinutes: number | null = null
): { timestamp: string; matched: boolean }[] {
  const windowMs = withinHours * 3600 * 1000;

  // Resolve effective values — null means "use legacy default"
  const effectiveMinElapsedMs = minElapsedHours !== null
    ? minElapsedHours * 3600 * 1000
    : requireMatchKey ? DEFAULT_MIN_ELAPSED_MS_WHEN_MATCH_KEY : 0;
  const effectiveDedupeMs = dedupeMinutes !== null
    ? dedupeMinutes * 60 * 1000
    : DEFAULT_DEDUPE_MS;

  const MIN_ELAPSED_MS = effectiveMinElapsedMs;
  const groupKey = (ev: TimedEvent): string | null =>
    requireMatchKey ? (ev.match_key || null) : (ev.match_key || ev.user_id || null);

  const dedupedNumerator = dedupeNearFires(numeratorEvents, groupKey, effectiveDedupeMs);
  const dedupedDenominator = dedupeNearFires(denominatorEvents, groupKey, effectiveDedupeMs);

  const numByGroup = new Map<string, number[]>();
  for (const ev of dedupedNumerator) {
    const key = groupKey(ev);
    if (!key) continue;
    const t = new Date(ev.timestamp).getTime();
    const list = numByGroup.get(key);
    if (list) list.push(t); else numByGroup.set(key, [t]);
  }
  for (const list of numByGroup.values()) list.sort((a, b) => a - b);

  const denomByGroup = new Map<string, { timestamp: string; t: number }[]>();
  for (const ev of dedupedDenominator) {
    const key = groupKey(ev);
    if (!key) continue;
    const t = new Date(ev.timestamp).getTime();
    const list = denomByGroup.get(key);
    if (list) list.push({ timestamp: ev.timestamp, t }); else denomByGroup.set(key, [{ timestamp: ev.timestamp, t }]);
  }

  // A claim with no payment YET isn't automatically a miss — it might just
  // not have reached its deadline. Only count it as a genuine failure once
  // the full window has actually elapsed with nothing landing in time;
  // before that, it's still in progress and gets left out of the results
  // entirely (neither a success nor a failure) rather than judged early.
  const now = Date.now();

  const results: { timestamp: string; matched: boolean }[] = [];
  for (const [groupId, denoms] of denomByGroup.entries()) {
    denoms.sort((a, b) => a.t - b.t);
    const numTimes = numByGroup.get(groupId) ?? [];
    let cursor = 0; // how far into this group's sorted numerator events we've already consumed
    for (const d of denoms) {
      // Skip past any numerator events that happened before this particular
      // claim — they belong to an earlier claim (or to nothing).
      while (cursor < numTimes.length && numTimes[cursor] < d.t) cursor++;

      // If the next available numerator event is implausibly close, it's
      // this claim's own junk/test pairing — consume it (it's gone either
      // way, real or fake) but do NOT keep searching further for a
      // substitute. Searching forward here was the bug: the next REAL
      // numerator event almost always belongs to a LATER claim in this
      // same group, not this one — crediting it to this claim would be
      // borrowing someone else's payment. Once this claim's own pairing is
      // thrown out, it's correctly treated as having no payment at all.
      let discardedAsImplausible = false;
      if (cursor < numTimes.length && numTimes[cursor] - d.t < MIN_ELAPSED_MS) {
        cursor++;
        discardedAsImplausible = true;
      }

      if (!discardedAsImplausible && cursor < numTimes.length && numTimes[cursor] - d.t <= windowMs) {
        // A payment exists and landed inside the window — fast match.
        results.push({ timestamp: d.timestamp, matched: true });
        cursor++; // consume it so it can't also match a later claim
      } else if (!discardedAsImplausible && cursor < numTimes.length) {
        // A payment exists but arrived after the window — a definite,
        // already-resolved miss. No ambiguity about timing here.
        results.push({ timestamp: d.timestamp, matched: false });
      } else if (now - d.t >= windowMs) {
        // No valid payment (none at all, or its only candidate was thrown
        // out as implausible) and the full window has already run out —
        // a genuine miss, not just "not yet."
        results.push({ timestamp: d.timestamp, matched: false });
      }
      // else: no valid payment yet, and still within its window — pending.
      // Deliberately not pushed: too early to call it a success or a miss.
    }
  }
  return results;
}

// Bucket a list of per-occurrence matches into day buckets across an
// arbitrary-length window (not just a fixed 30 days) — `days` lets a caller
// ask for a single calendar month (28-31) instead of always trailing-30.
function bucketByDay(
  matches: { timestamp: string; matched: boolean }[],
  since: Date,
  days: number
): { dayTotals: Record<string, number>; daySuccesses: Record<string, number> } {
  const dayTotals: Record<string, number> = {};
  const daySuccesses: Record<string, number> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    dayTotals[key] = 0;
    daySuccesses[key] = 0;
  }
  for (const m of matches) {
    const key = m.timestamp.slice(0, 10);
    if (!(key in dayTotals)) continue;
    dayTotals[key]++;
    if (m.matched) daySuccesses[key]++;
  }
  return { dayTotals, daySuccesses };
}

// Used by both the KPI property panel (metrics.ts) and the two-step Cohort
// Builder (cohorts.ts) — same matching engine, different pair of events.
// `days` defaults to 30 (the historical behavior) but a caller asking about
// a specific calendar month passes that month's real day count instead.
export function computeTimeWindowedRate(
  numeratorEvents: TimedEvent[],
  denominatorEvents: TimedEvent[],
  withinHours: number,
  since: Date,
  days: number = 30,
  requireMatchKey: boolean = false,
  minElapsedHours: number | null = null,
  dedupeMinutes: number | null = null
): { total: number; trend: MetricDataPoint[] } {
  const matches = matchOccurrences(numeratorEvents, denominatorEvents, withinHours, requireMatchKey, minElapsedHours, dedupeMinutes);
  const { dayTotals, daySuccesses } = bucketByDay(matches, since, days);

  const totalClaims = matches.length;
  const successClaims = matches.filter((m) => m.matched).length;
  const total = totalClaims > 0 ? Math.round((successClaims / totalClaims) * 1000) / 10 : 0;

  const trend = Object.keys(dayTotals)
    .sort()
    .map((date) => ({
      date,
      value: dayTotals[date] > 0 ? Math.round((daySuccesses[date] / dayTotals[date]) * 1000) / 10 : 0,
      matched: daySuccesses[date],
      total: dayTotals[date],
    }));

  return { total, trend };
}
