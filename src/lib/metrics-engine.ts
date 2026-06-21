// Pure, synchronous computation helpers shared by metrics.ts and cohorts.ts.
//
// This file deliberately has NO "use server" directive. Next.js requires
// every top-level export of a "use server" file to be an async function
// (it treats each one as a Server Action), so a plain sync helper like
// computeTimeWindowedRate can't live in metrics.ts even though that's
// logically where it belongs — it has to live in an ordinary module that
// both action files import from.

export type MetricDataPoint = { date: string; value: number };

// Per-user time-window matching: for each user who fired a denominator
// event, did they also fire a numerator event within `withinHours` hours
// AFTER it? Used by both the KPI property panel (metrics.ts) and the
// two-step Cohort Builder (cohorts.ts) — same matching engine, different
// pair of events.
export function computeTimeWindowedRate(
  numeratorEvents: { timestamp: string; user_id: string | null }[],
  denominatorEvents: { timestamp: string; user_id: string | null }[],
  withinHours: number,
  since: Date
): { total: number; trend: MetricDataPoint[] } {
  const windowMs = withinHours * 3600 * 1000;

  const numByUser = new Map<string, number[]>();
  for (const ev of numeratorEvents) {
    if (!ev.user_id) continue;
    const t = new Date(ev.timestamp).getTime();
    const list = numByUser.get(ev.user_id);
    if (list) list.push(t); else numByUser.set(ev.user_id, [t]);
  }

  const denomByUser = new Map<string, number[]>();
  for (const ev of denominatorEvents) {
    if (!ev.user_id) continue;
    const t = new Date(ev.timestamp).getTime();
    const list = denomByUser.get(ev.user_id);
    if (list) list.push(t); else denomByUser.set(ev.user_id, [t]);
  }

  // Day buckets keyed off when the user's denominator event happened (not
  // when the matching numerator event landed) — answers "of the people who
  // started on this day, what % converted in time."
  const dayTotals: Record<string, number> = {};
  const daySuccesses: Record<string, number> = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    dayTotals[d.toISOString().slice(0, 10)] = 0;
    daySuccesses[d.toISOString().slice(0, 10)] = 0;
  }

  let totalUsers = 0;
  let successUsers = 0;

  for (const [userId, denomTimes] of denomByUser.entries()) {
    totalUsers++;
    const userNumTimes = numByUser.get(userId) ?? [];
    const success = denomTimes.some((dt) => userNumTimes.some((nt) => nt >= dt && nt - dt <= windowMs));
    if (success) successUsers++;

    const bucketKey = new Date(Math.min(...denomTimes)).toISOString().slice(0, 10);
    if (bucketKey in dayTotals) {
      dayTotals[bucketKey]++;
      if (success) daySuccesses[bucketKey]++;
    }
  }

  const total = totalUsers > 0 ? Math.round((successUsers / totalUsers) * 1000) / 10 : 0;
  const trend = Object.keys(dayTotals)
    .sort()
    .map((date) => ({
      date,
      value: dayTotals[date] > 0 ? Math.round((daySuccesses[date] / dayTotals[date]) * 1000) / 10 : 0,
    }));

  return { total, trend };
}
