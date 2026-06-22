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
export function matchOccurrences(
  numeratorEvents: TimedEvent[],
  denominatorEvents: TimedEvent[],
  withinHours: number
): { timestamp: string; matched: boolean }[] {
  const windowMs = withinHours * 3600 * 1000;
  const groupKey = (ev: TimedEvent): string | null => ev.match_key || ev.user_id || null;

  const numByGroup = new Map<string, number[]>();
  for (const ev of numeratorEvents) {
    const key = groupKey(ev);
    if (!key) continue;
    const t = new Date(ev.timestamp).getTime();
    const list = numByGroup.get(key);
    if (list) list.push(t); else numByGroup.set(key, [t]);
  }
  for (const list of numByGroup.values()) list.sort((a, b) => a - b);

  const denomByGroup = new Map<string, { timestamp: string; t: number }[]>();
  for (const ev of denominatorEvents) {
    const key = groupKey(ev);
    if (!key) continue;
    const t = new Date(ev.timestamp).getTime();
    const list = denomByGroup.get(key);
    if (list) list.push({ timestamp: ev.timestamp, t }); else denomByGroup.set(key, [{ timestamp: ev.timestamp, t }]);
  }

  const results: { timestamp: string; matched: boolean }[] = [];
  for (const [groupId, denoms] of denomByGroup.entries()) {
    denoms.sort((a, b) => a.t - b.t);
    const numTimes = numByGroup.get(groupId) ?? [];
    let cursor = 0; // how far into this group's sorted numerator events we've already consumed
    for (const d of denoms) {
      // Skip past any numerator events that happened before this particular
      // claim — they belong to an earlier claim (or to nothing).
      while (cursor < numTimes.length && numTimes[cursor] < d.t) cursor++;
      const matched = cursor < numTimes.length && numTimes[cursor] - d.t <= windowMs;
      if (matched) cursor++; // consume it so it can't also match a later claim
      results.push({ timestamp: d.timestamp, matched });
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
  days: number = 30
): { total: number; trend: MetricDataPoint[] } {
  const matches = matchOccurrences(numeratorEvents, denominatorEvents, withinHours);
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
