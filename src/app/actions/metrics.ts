"use server";

import { createServerClient, createAdminClient } from "@/lib/supabase/server";
import type { Metric } from "@/types/database";
import { computeTimeWindowedRate, matchOccurrences } from "@/lib/metrics-engine";
import type { MetricDataPoint } from "@/lib/metrics-engine";
import { getManualKpiValue } from "./manual-kpi";
import { getDistinctEventNames as getDistinctEventNamesFast } from "./events";

// Server Actions files can only export async functions, so the actual sync
// computeTimeWindowedRate helper lives in src/lib/metrics-engine.ts. cohorts.ts
// imports it from there directly (not from this file) for the same reason.
export type { MetricDataPoint } from "@/lib/metrics-engine";

export type MetricWithData = Metric & {
  total: number;
  trend: MetricDataPoint[];
  feature_name: string | null;
  business_goal_title: string | null;
};

// ─── List ────────────────────────────────────────────────────────────────────
// Pulls each metric together with the feature it was built to measure and
// the business goal that feature serves, so the page can render the real
// hierarchy (Business Goal -> Feature -> KPI) instead of a flat list.

export async function getMetrics(orgId: string): Promise<MetricWithData[]> {
  const admin = createAdminClient();

  const { data: metrics, error } = await admin
    .from("metrics")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) console.error("[getMetrics]", error.message);
  if (error || !metrics) return [];

  // Resolve feature names and goal titles with plain lookups instead of a
  // PostgREST embedded select (e.g. .select("*, feature_metrics(...), business_goals(...)")).
  // Embedded selects depend on PostgREST's schema cache picking up the FK
  // columns added in migrations 017/018 — right after running a migration
  // that cache can be stale until the project reloads it, and the embedded
  // select then fails silently (error set, caught above, empty result) with
  // no obvious cause. Two plain queries have no such dependency.
  const featureIds = [...new Set(metrics.map((m) => m.feature_metric_id).filter((id): id is string => !!id))];
  const goalIds = [...new Set(metrics.map((m) => m.business_goal_id).filter((id): id is string => !!id))];

  const [featureRes, goalRes] = await Promise.all([
    featureIds.length > 0
      ? admin.from("feature_metrics").select("id, feature_name").in("id", featureIds)
      : Promise.resolve({ data: [] as { id: string; feature_name: string }[] }),
    goalIds.length > 0
      ? admin.from("business_goals").select("id, title").in("id", goalIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
  ]);

  const featureNameById = new Map((featureRes.data ?? []).map((f) => [f.id, f.feature_name]));
  const goalTitleById = new Map((goalRes.data ?? []).map((g) => [g.id, g.title]));

  // Fetch 30-day trend data for each metric in parallel
  const results = await Promise.all(
    metrics.map(async (m) => {
      const withData = await attachTrendData(m, orgId);
      return {
        ...withData,
        feature_name: m.feature_metric_id ? featureNameById.get(m.feature_metric_id) ?? null : null,
        business_goal_title: m.business_goal_id ? goalTitleById.get(m.business_goal_id) ?? null : null,
      };
    })
  );

  return results;
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createMetric(
  orgId: string,
  payload: { name: string; description: string; event_name: string; aggregation: string }
): Promise<{ data: Metric | null; error: string | null }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: "Not authenticated" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("metrics")
    .insert({
      organization_id: orgId,
      name: payload.name.trim(),
      description: payload.description.trim() || null,
      event_name: payload.event_name.trim(),
      aggregation: payload.aggregation as Metric["aggregation"],
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) {
    console.error("[createMetric]", error);
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

// ─── Goal-level KPIs ───────────────────────────────────────────────────────────
// A KPI belongs to the business goal it breaks down, not to whichever
// feature happens to get built first. These are created directly on a goal,
// independent of any feature — features then pick which existing KPI they're
// meant to move (see feature_metrics.target_kpi_id) instead of each one
// inventing its own.

export async function getKpisByGoal(orgId: string): Promise<Record<string, MetricWithData[]>> {
  const all = await getMetrics(orgId);
  const byGoal: Record<string, MetricWithData[]> = {};
  for (const m of all) {
    if (m.kind !== "kpi" || !m.business_goal_id) continue;
    if (!byGoal[m.business_goal_id]) byGoal[m.business_goal_id] = [];
    byGoal[m.business_goal_id].push(m);
  }
  return byGoal;
}

export async function createGoalKpi(
  orgId: string,
  businessGoalId: string,
  payload: {
    name: string;
    description: string;
    event_name?: string | null;
    // A KPI can carry one optional "property": a reference event that
    // changes how event_name's total is computed. Two independent switches
    // control what that means (see migration 027):
    //   - rate_as_percentage: express the total as % of the reference
    //     event's count, instead of a raw number.
    //   - within_hours: only count it when event_name lands within this
    //     many hours of THAT SAME user's reference event, instead of
    //     treating the two events as independent headcounts.
    // Either, both, or neither (within_hours unset = no time constraint) can
    // be on — e.g. percentage alone is a plain ratio, hours alone is a raw
    // count of timely conversions, both together is "% who converted in
    // time" (e.g. the claims-paid-within-24h KPI).
    denominator_event_name?: string | null;
    within_hours?: number | null;
    rate_as_percentage?: boolean;
    // Migration 034 — name of a property shared by event_name and
    // denominator_event_name (e.g. "policy_id") that uniquely ties one
    // occurrence of each together. When set, matching uses that real
    // identifier instead of guessing "same user, next one in order."
    match_key_property?: string | null;
    aggregation: string;
    target: string;
    target_value?: number | null;
    // Alternative to event_name — see migration 029 / src/lib/sheet-months.ts.
    source_report_id?: string | null;
    source_label_column?: string | null;
    source_row_value?: string | null;
  }
): Promise<{ data: Metric | null; error: string | null }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: "Not authenticated" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("metrics")
    .insert({
      organization_id: orgId,
      name: payload.name.trim(),
      description: payload.description.trim() || null,
      // Optional on purpose — a KPI is a goal-level target decided up front;
      // the event that measures it can be wired up later (manually here, or
      // automatically when a feature targets this KPI). See migration 019.
      event_name: payload.event_name?.trim() || null,
      denominator_event_name: payload.denominator_event_name?.trim() || null,
      within_hours: payload.within_hours ?? null,
      rate_as_percentage: payload.rate_as_percentage ?? true,
      match_key_property: payload.match_key_property?.trim() || null,
      aggregation: payload.aggregation as Metric["aggregation"],
      business_goal_id: businessGoalId,
      target: payload.target.trim() || null,
      target_value: payload.target_value ?? null,
      kind: "kpi",
      source_report_id: payload.source_report_id ?? null,
      source_label_column: payload.source_label_column ?? null,
      source_row_value: payload.source_row_value ?? null,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) {
    console.error("[createGoalKpi]", error);
    return { data: null, error: error.message };
  }

  return { data, error: null };
}

// ─── Attach an event to an existing KPI ───────────────────────────────────────
// Lets a KPI created without an event (see createGoalKpi above) get wired up
// later — either from the Goals page directly, or when a feature is pointed
// at this KPI and supplies the event itself.

export async function attachEventToKpi(
  metricId: string,
  eventName: string,
  aggregation?: string
): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const update: { event_name: string; aggregation?: Metric["aggregation"] } = {
    event_name: eventName.trim(),
  };
  if (aggregation) update.aggregation = aggregation as Metric["aggregation"];

  const { error } = await admin.from("metrics").update(update).eq("id", metricId);
  if (error) return { error: error.message };
  return { error: null };
}

// ─── Edit / delete a goal-level KPI ───────────────────────────────────────────
// Same fields and semantics as createGoalKpi above — this just updates an
// existing row in place instead of inserting a new one. All fields are
// optional so a caller can patch just what changed; omit a field to leave it
// untouched, or pass null/undefined explicitly where the type allows it to
// clear that field (e.g. removing the reference-event property).

export async function updateGoalKpi(
  kpiId: string,
  payload: {
    name?: string;
    description?: string;
    event_name?: string | null;
    denominator_event_name?: string | null;
    within_hours?: number | null;
    rate_as_percentage?: boolean;
    match_key_property?: string | null;
    aggregation?: string;
    target?: string | null;
    target_value?: number | null;
    source_report_id?: string | null;
    source_label_column?: string | null;
    source_row_value?: string | null;
  }
): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const update: Record<string, unknown> = {};
  if (payload.name !== undefined) update.name = payload.name.trim();
  if (payload.description !== undefined) update.description = payload.description.trim() || null;
  if (payload.event_name !== undefined) update.event_name = payload.event_name?.trim() || null;
  if (payload.denominator_event_name !== undefined) update.denominator_event_name = payload.denominator_event_name?.trim() || null;
  if (payload.within_hours !== undefined) update.within_hours = payload.within_hours;
  if (payload.rate_as_percentage !== undefined) update.rate_as_percentage = payload.rate_as_percentage;
  if (payload.match_key_property !== undefined) update.match_key_property = payload.match_key_property?.trim() || null;
  if (payload.aggregation !== undefined) update.aggregation = payload.aggregation;
  if (payload.target !== undefined) update.target = payload.target?.trim() || null;
  if (payload.target_value !== undefined) update.target_value = payload.target_value;
  if (payload.source_report_id !== undefined) update.source_report_id = payload.source_report_id;
  if (payload.source_label_column !== undefined) update.source_label_column = payload.source_label_column;
  if (payload.source_row_value !== undefined) update.source_row_value = payload.source_row_value;

  const { error } = await admin.from("metrics").update(update).eq("id", kpiId);
  if (error) {
    console.error("[updateGoalKpi]", error);
    return { error: error.message };
  }
  return { error: null };
}

export async function deleteGoalKpi(kpiId: string): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const { error } = await admin.from("metrics").delete().eq("id", kpiId);
  if (error) {
    console.error("[deleteGoalKpi]", error);
    return { error: error.message };
  }
  return { error: null };
}

// ─── Goal-level progress ──────────────────────────────────────────────────────
// A goal's progress is only real when its KPIs have BOTH a wired event
// (something is actually being measured) AND a numeric target_value (a
// number to measure against, in the metric's own unit). Anything else is
// shown as "not yet measurable" rather than guessed at — consistent with the
// app's rule against implying a percentage it can't actually compute.

export type GoalProgress = {
  businessGoalId: string;
  measurableKpiCount: number;
  totalKpiCount: number;
  // Plain average of each measurable KPI's (actual / target_value) — left
  // UNCAPPED on purpose. A KPI running 20x over its target is real
  // information ("blew past it"), not the same thing as "hit it exactly" —
  // silently capping every KPI at 100% before averaging would erase that
  // difference and quietly lie about how far over/under target things are.
  // Capping only happens at render time, for the filled width of the bar —
  // a bar can't visually draw past 100% — but the number shown next to it
  // stays real and can exceed 100%.
  progressRatio: number | null;
};

// getMetrics (called inside getKpisByGoal) fans out into a parallel query per
// metric/KPI to compute its trend — not free on an org with a lot of KPIs.
// Callers that already have a fresh kpisByGoal (e.g. the Goals page, which
// fetches it directly for its own KPI list) can pass it straight in here
// instead of triggering that whole computation a second time on every page
// load. Callers that don't have it yet (e.g. the Dashboard) just omit the
// argument and it's fetched as before.
export async function getGoalProgress(
  orgId: string,
  precomputedKpisByGoal?: Record<string, MetricWithData[]>
): Promise<Record<string, GoalProgress>> {
  const kpisByGoal = precomputedKpisByGoal ?? await getKpisByGoal(orgId);
  const result: Record<string, GoalProgress> = {};

  for (const [goalId, kpis] of Object.entries(kpisByGoal)) {
    // A KPI counts as measurable either via a tracked event, or via a
    // connected-sheet row (migration 029) — either way it has a real
    // `total` by the time getMetrics/attachTrendData runs.
    const measurable = kpis.filter((k) =>
      (k.event_name || (k.source_report_id && k.source_row_value)) &&
      typeof k.target_value === "number" && k.target_value > 0
    );

    let progressRatio: number | null = null;
    if (measurable.length > 0) {
      const ratios = measurable.map((k) => k.total / (k.target_value as number));
      progressRatio = ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
    }

    result[goalId] = {
      businessGoalId: goalId,
      measurableKpiCount: measurable.length,
      totalKpiCount: kpis.length,
      progressRatio,
    };
  }

  return result;
}

// ─── Delete ──────────────────────────────────────────────────────────────────

export async function deleteMetric(metricId: string): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const { error } = await admin.from("metrics").delete().eq("id", metricId);
  if (error) return { error: error.message };
  return { error: null };
}

// ─── Trend data ──────────────────────────────────────────────────────────────

// `range` is optional — every existing caller (getMetrics, used by the
// Goals/Feature Metrics/Dashboard pages) omits it and keeps getting the
// historical trailing-30-days-from-now window. Passing one in (see
// getKpiForRange below) recomputes the exact same KPI over an arbitrary
// window instead — a specific calendar month, for month-on-month tracking,
// rather than always "the last 30 days as of whenever you happen to load
// the page."
async function attachTrendData(
  metric: Metric,
  orgId: string,
  range?: { since: Date; until: Date }
): Promise<MetricWithData> {
  const since = range?.since ?? (() => {
    const d = new Date();
    d.setDate(d.getDate() - 29); // last 30 days
    d.setHours(0, 0, 0, 0);
    return d;
  })();
  const until = range?.until;
  // Inclusive day count spanning since→until (or the historical fixed 30
  // when no range was given) — this is how many day-buckets the trend line
  // and the day-count loops below need to cover.
  const days = until
    ? Math.max(1, Math.round((until.getTime() - since.getTime()) / 86400000))
    : 30;

  // A KPI can be defined before any event is wired to it (see migration 019).
  // No event_name means there's nothing to query — UNLESS it's set up to
  // pull its number from a connected sheet row instead (migration 029),
  // which is exactly the path for operational KPIs nothing ever tracks.
  if (!metric.event_name) {
    if (metric.source_report_id && metric.source_row_value) {
      const manual = await getManualKpiValue(metric);
      // No trend line for a manual value — it's a single monthly snapshot,
      // not an events-derived time series; an empty trend renders as "no
      // chart" rather than a misleading flat line.
      return { ...metric, total: manual.value ?? 0, trend: [] };
    }
    return { ...metric, total: 0, trend: buildTrend([], metric.aggregation, since, days) };
  }

  const admin = createAdminClient();

  // For a time-windowed KPI (within_hours set, e.g. "claim_paid within
  // 1200h of claim_start_clicked"), a denominator occurrence near the end
  // of the requested period can have its matching numerator event land
  // AFTER `until` and still be a perfectly genuine, in-window match — e.g.
  // a claim lodged on the last day of May, paid 20 days later in June, well
  // inside a 1200h/50-day window. Clipping the numerator query to the same
  // `until` as the denominator made that real payment invisible to
  // matchOccurrences, which then had no choice but to score it a miss
  // purely because of where the calendar boundary fell — not because the
  // claim was actually late. Extending ONLY the numerator's upper bound by
  // the configured window fixes that: the denominator (which occurrences
  // count for this period at all) still stays scoped to `until`, but the
  // matcher can now see a late-but-in-window payment when one exists.
  const numeratorUntil = (until && metric.within_hours)
    ? new Date(until.getTime() + metric.within_hours * 3600 * 1000)
    : until;
  const numeratorEvents = await fetchEventRows(admin, orgId, metric.event_name, since, numeratorUntil);

  // KPI "property" (migration 024/026/027) — a reference event changes how
  // event_name's total is computed. Two independent switches decide how:
  // rate_as_percentage (express vs. the reference event's count) and
  // within_hours (require it within a time window of THAT SAME user's
  // reference event, instead of treating the two as independent
  // headcounts). See createGoalKpi's comment for the full combination table.
  if (metric.denominator_event_name) {
    const denominatorEvents = await fetchEventRows(admin, orgId, metric.denominator_event_name, since, until);
    const hasWindow = !!metric.within_hours && metric.within_hours > 0;
    const asPercentage = metric.rate_as_percentage !== false;

    // When match_key_property is set, an event missing that property isn't
    // a fuzzy match candidate — it's unverifiable and gets excluded rather
    // than silently falling back to same-person guessing. See the comment
    // on matchOccurrences in metrics-engine.ts.
    const requireMatchKey = !!metric.match_key_property;

    if (hasWindow && asPercentage) {
      // % of reference-event occurrences whose event_name landed in time.
      const { total, trend } = computeTimeWindowedRate(numeratorEvents, denominatorEvents, metric.within_hours as number, since, days, requireMatchKey);
      return { ...metric, total, trend };
    }

    if (hasWindow && !asPercentage) {
      // Raw count of reference-event occurrences that got a timely match —
      // e.g. "1,000 claims paid within 24h" as a volume target.
      const { total, trend } = computeTimeWindowedCount(numeratorEvents, denominatorEvents, metric.within_hours as number, since, days, requireMatchKey);
      return { ...metric, total, trend };
    }

    if (asPercentage) {
      // Plain ratio — two independent headcounts in the same window. Does
      // NOT check that any individual record in the numerator corresponds
      // to one in the denominator.
      const trend = buildRateTrend(numeratorEvents, denominatorEvents, metric.aggregation, since, days);
      const numTotal = computeTotal(numeratorEvents, metric.aggregation);
      const denTotal = computeTotal(denominatorEvents, metric.aggregation);
      const total = denTotal > 0 ? Math.round((numTotal / denTotal) * 1000) / 10 : 0;
      return { ...metric, total, trend };
    }

    // Reference event present but neither switch is meaningfully on — falls
    // through to a plain volume KPI on event_name alone, ignoring it.
  }

  const trend = buildTrend(numeratorEvents, metric.aggregation, since, days);
  const total = computeTotal(numeratorEvents, metric.aggregation);

  return { ...metric, total, trend };
}

export async function fetchEventRows(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  eventName: string,
  since: Date,
  until?: Date
): Promise<{ timestamp: string; user_id: string | null; session_id: string | null; match_key: string | null }[]> {
  let query = admin
    .from("events")
    .select("timestamp, user_id, session_id, properties")
    .eq("organization_id", orgId)
    .eq("name", eventName)
    .gte("timestamp", since.toISOString())
    // Exclude only the name-only placeholder rows Sync Event Names creates —
    // not real Mixpanel-sourced occurrences synced via Pull Mixpanel Data,
    // which share the same source tag but are real data and should count.
    .or("properties->>is_placeholder.is.null,properties->>is_placeholder.neq.true");
  // Open-ended (no upper bound) unless a specific window's end was given —
  // e.g. a calendar month shouldn't pick up next month's events too.
  if (until) query = query.lt("timestamp", until.toISOString());
  const { data } = await query;
  // `match_key` (migration 034) is saved into `properties.match_key` at sync
  // time, only for events whose KPI named a match_key_property — see
  // syncMixpanelRawEvents in mixpanel.ts. Pulled out here so callers (the
  // per-occurrence matchers in metrics-engine.ts) get a flat field instead
  // of having to reach into properties themselves.
  return (data ?? []).map((row) => ({
    timestamp: row.timestamp as string,
    user_id: row.user_id as string | null,
    session_id: row.session_id as string | null,
    match_key: ((row.properties as Record<string, unknown> | null)?.match_key as string | undefined) ?? null,
  }));
}

// ─── KPI value for an arbitrary date range (month-on-month) ──────────────────
//
// getMetrics/getKpisByGoal always compute every KPI over the same trailing
// 30 days — fine as the default, but a goal like "95% of claims paid within
// 24h" naturally wants to be checked month by month, not just "as of right
// now." This recomputes a single KPI over whatever range is asked for,
// without touching the default behavior everything else still relies on.
export async function getKpiForRange(
  metricId: string,
  sinceIso: string,
  untilIso: string
): Promise<{ total: number; trend: MetricDataPoint[]; error?: string }> {
  const admin = createAdminClient();
  const { data: metric, error } = await admin
    .from("metrics")
    .select("*")
    .eq("id", metricId)
    .single();

  if (error || !metric) return { total: 0, trend: [], error: error?.message ?? "KPI not found" };

  const since = new Date(sinceIso);
  const until = new Date(untilIso);
  const withData = await attachTrendData(metric as Metric, metric.organization_id as string, { since, until });
  return { total: withData.total, trend: withData.trend };
}

// Per-OCCURRENCE time-windowed matching (migration 026, revised) — for each
// individual denominator-event instance, check whether that same user's
// next not-yet-used numerator event landed within `withinHours` hours
// afterward. This used to match per USER (count the whole user as a success
// if ANY of their denominator instances matched) — for someone with 10
// claims and only 1 paid fast, that read as a 100% match across all 10.
// matchOccurrences (src/lib/metrics-engine.ts) fixes that by consuming each
// numerator event for at most one denominator event, in chronological order
// per user, so the rate now reflects individual claims, not individual
// people.
//
// The matching itself lives in metrics-engine.ts (shared with the count
// version below and with the Cohort Builder) since "use server" files can
// only export async functions — this comment stays here as the canonical
// explanation of what it does.

// Same per-occurrence time match as computeTimeWindowedRate, but for a raw
// COUNT target instead of a percentage — e.g. "1,000 claims paid within
// 24h" as a volume goal.
function computeTimeWindowedCount(
  numeratorEvents: { timestamp: string; user_id: string | null; match_key?: string | null }[],
  denominatorEvents: { timestamp: string; user_id: string | null; match_key?: string | null }[],
  withinHours: number,
  since: Date,
  days: number = 30,
  requireMatchKey: boolean = false
): { total: number; trend: MetricDataPoint[] } {
  const matches = matchOccurrences(numeratorEvents, denominatorEvents, withinHours, requireMatchKey);

  const dayCounts: Record<string, number> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    dayCounts[d.toISOString().slice(0, 10)] = 0;
  }

  let total = 0;
  for (const m of matches) {
    if (!m.matched) continue;
    total++;
    const key = m.timestamp.slice(0, 10);
    if (key in dayCounts) dayCounts[key]++;
  }

  const trend = Object.keys(dayCounts)
    .sort()
    .map((date) => ({ date, value: dayCounts[date] }));

  return { total, trend };
}

function buildTrend(
  events: { timestamp: string; user_id: string | null; session_id: string | null }[],
  aggregation: Metric["aggregation"],
  since: Date,
  days: number = 30
): MetricDataPoint[] {
  // Build a map of date → set/count
  const dayMap: Record<string, Set<string> | number> = {};

  // Pre-fill every day in the window with 0 / empty sets
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    dayMap[key] = aggregation === "count" ? 0 : new Set<string>();
  }

  for (const ev of events) {
    const key = ev.timestamp.slice(0, 10);
    if (!(key in dayMap)) continue;

    if (aggregation === "count") {
      (dayMap[key] as number)++;
    } else if (aggregation === "unique_users" && ev.user_id) {
      (dayMap[key] as Set<string>).add(ev.user_id);
    } else if (aggregation === "unique_sessions" && ev.session_id) {
      (dayMap[key] as Set<string>).add(ev.session_id);
    }
  }

  return Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, val]) => ({
      date,
      value: typeof val === "number" ? val : (val as Set<string>).size,
    }));
}

// Per-day version of the same ratio used for the KPI's overall total — reuses
// buildTrend to get daily counts on each side, then divides day by day so the
// trend line shows the rate moving over time instead of two raw counts.
function buildRateTrend(
  numeratorEvents: { timestamp: string; user_id: string | null; session_id: string | null }[],
  denominatorEvents: { timestamp: string; user_id: string | null; session_id: string | null }[],
  aggregation: Metric["aggregation"],
  since: Date,
  days: number = 30
): MetricDataPoint[] {
  const numTrend = buildTrend(numeratorEvents, aggregation, since, days);
  const denTrend = buildTrend(denominatorEvents, aggregation, since, days);
  return numTrend.map((point, i) => {
    const denVal = denTrend[i]?.value ?? 0;
    const rate = denVal > 0 ? Math.round((point.value / denVal) * 1000) / 10 : 0;
    return { date: point.date, value: rate };
  });
}

function computeTotal(
  events: { user_id: string | null; session_id: string | null }[],
  aggregation: Metric["aggregation"]
): number {
  if (aggregation === "count") return events.length;
  if (aggregation === "unique_users") {
    return new Set(events.map((e) => e.user_id).filter(Boolean)).size;
  }
  return new Set(events.map((e) => e.session_id).filter(Boolean)).size;
}

// ─── Distinct event names (for the create form dropdown) ─────────────────────

export async function getDistinctEventNames(orgId: string): Promise<string[]> {
  // This used to be its own separate implementation that pulled the `name`
  // column for every row in the org's events table and deduped in JS — the
  // exact same expensive full-table-read events.ts's version had, just
  // copy-pasted into a second file, and missing that file's junk-name
  // filtering on top (so dropdowns built from this version could show
  // Mixpanel's internal "$"-prefixed events or stray email-shaped names that
  // the Events page already knows to hide). Delegating to the one fixed,
  // filtered implementation fixes both at once instead of having two
  // versions drift apart.
  return getDistinctEventNamesFast(orgId);
}
