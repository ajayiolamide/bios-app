"use server";

import { createAdminClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { fetchEventRows } from "./metrics";
import { computeTimeWindowedRate } from "@/lib/metrics-engine";
import { isRealEventName } from "@/lib/event-name-filter";
import { syncMixpanelRawEvents } from "./mixpanel";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CohortRow = {
  cohortWeek: string;   // "YYYY-MM-DD" (Monday of the week)
  totalUsers: number;
  retained: number[];   // retained[n] = users active in week n (week 0 = cohort week)
};

export type CohortData = {
  rows: CohortRow[];
  maxWeeks: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function weekStart(d: Date): string {
  const day = new Date(d);
  const dow = day.getUTCDay(); // 0 = Sun
  const diff = dow === 0 ? -6 : 1 - dow; // shift to Monday
  day.setUTCDate(day.getUTCDate() + diff);
  day.setUTCHours(0, 0, 0, 0);
  return day.toISOString().slice(0, 10);
}

function weekDiff(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / (7 * 86400e3));
}

// ─── Weekly cohort retention ──────────────────────────────────────────────────

export async function getCohortRetention(
  orgId: string,
  { weeks = 8, eventName }: { weeks?: number; eventName?: string } = {}
): Promise<CohortData> {
  const admin = createAdminClient();

  const since = new Date(Date.now() - weeks * 7 * 86400e3).toISOString();

  let query = admin
    .from("events")
    .select("user_id, timestamp, name")
    .eq("organization_id", orgId)
    .not("user_id", "is", null)
    .not("user_id", "eq", "")
    .gte("timestamp", since)
    .order("timestamp", { ascending: true })
    .limit(50000); // safety cap

  if (eventName) query = query.eq("name", eventName);

  const { data, error } = await query;
  if (error || !data?.length) return { rows: [], maxWeeks: 0 };

  // user_id → sorted timestamps
  const userTs: Record<string, Date[]> = {};
  for (const ev of data) {
    const uid = ev.user_id as string;
    if (!userTs[uid]) userTs[uid] = [];
    userTs[uid].push(new Date(ev.timestamp));
  }

  // Build cohort → { total users, week → user set }
  const cohortMap: Record<string, {
    total: Set<string>;
    byWeek: Record<number, Set<string>>;
  }> = {};

  for (const [uid, timestamps] of Object.entries(userTs)) {
    const sorted = [...timestamps].sort((a, b) => a.getTime() - b.getTime());
    const cohort = weekStart(sorted[0]);

    if (!cohortMap[cohort]) cohortMap[cohort] = { total: new Set(), byWeek: {} };
    cohortMap[cohort].total.add(uid);

    const activeWeeks = new Set(timestamps.map(t => weekStart(t)));
    for (const aw of activeWeeks) {
      const wn = weekDiff(cohort, aw);
      if (wn >= 0 && wn < weeks) {
        if (!cohortMap[cohort].byWeek[wn]) cohortMap[cohort].byWeek[wn] = new Set();
        cohortMap[cohort].byWeek[wn].add(uid);
      }
    }
  }

  const sortedCohorts = Object.keys(cohortMap).sort();
  // How many weeks have actually elapsed since the earliest cohort, capped
  // to the requested window — NOT "the latest week that happened to have
  // any returning users". That second definition silently hid any week
  // with genuinely 0% retention (no column at all, rather than a 0% one),
  // which is exactly the case that matters most and the one the AI insight
  // below was correctly reporting on from the raw data while the table
  // showed nothing to back it up.
  const todayWeek = weekStart(new Date());
  let maxWeeks = 0;

  const rows: CohortRow[] = sortedCohorts.map(cohortWeek => {
    const { total, byWeek } = cohortMap[cohortWeek];
    const totalUsers = total.size;
    const elapsedWeeks = Math.min(weekDiff(cohortWeek, todayWeek) + 1, weeks);
    maxWeeks = Math.max(maxWeeks, elapsedWeeks);

    const retained: number[] = Array.from({ length: weeks }, (_, w) => byWeek[w]?.size ?? 0);
    return { cohortWeek, totalUsers, retained };
  });

  return { rows, maxWeeks: Math.max(maxWeeks, 1) };
}

// ─── Weekly active users ──────────────────────────────────────────────────────

export type WAURow = { week: string; users: number; events: number };

export async function getWeeklyActiveUsers(
  orgId: string,
  weeks = 12
): Promise<WAURow[]> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - weeks * 7 * 86400e3).toISOString();

  const { data } = await admin
    .from("events")
    .select("user_id, timestamp")
    .eq("organization_id", orgId)
    .gte("timestamp", since)
    .limit(50000);

  if (!data?.length) return [];

  const weekMap: Record<string, { users: Set<string>; events: number }> = {};
  for (const ev of data) {
    const w = weekStart(new Date(ev.timestamp));
    if (!weekMap[w]) weekMap[w] = { users: new Set(), events: 0 };
    weekMap[w].events++;
    if (ev.user_id) weekMap[w].users.add(ev.user_id as string);
  }

  return Object.entries(weekMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, { users, events }]) => ({ week, users: users.size, events }));
}

// ─── Top events (last 30d) ────────────────────────────────────────────────────

export type TopEventRow = { name: string; count: number; users: number };

export async function getTopEvents(
  orgId: string,
  limit = 15
): Promise<TopEventRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("events")
    .select("name, user_id")
    .eq("organization_id", orgId)
    .gte("timestamp", new Date(Date.now() - 30 * 86400e3).toISOString())
    .limit(50000);

  if (!data?.length) return [];

  const evMap: Record<string, { count: number; users: Set<string> }> = {};
  for (const ev of data) {
    if (!isRealEventName(ev.name as string)) continue;
    if (!evMap[ev.name]) evMap[ev.name] = { count: 0, users: new Set() };
    evMap[ev.name].count++;
    if (ev.user_id) evMap[ev.name].users.add(ev.user_id as string);
  }

  return Object.entries(evMap)
    .map(([name, { count, users }]) => ({ name, count, users: users.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ─── Cohort data info ─────────────────────────────────────────────────────────

export type CohortDataInfo = {
  totalEvents: number;
  totalUsers: number;
  dateFrom: string;
  dateTo: string;
  bySource: { source: string; count: number }[];
};

export async function getCohortDataInfo(
  orgId: string,
  weeks: number
): Promise<CohortDataInfo> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - weeks * 7 * 86400e3).toISOString();

  const { data: rawData } = await admin
    .from("events")
    .select("name, user_id, timestamp, properties")
    .eq("organization_id", orgId)
    .gte("timestamp", since)
    .limit(50000);

  // is_placeholder rows are name-only stubs from syncMixpanelEventNames
  // (no real user, no real occurrence — just so a name shows up in
  // autocomplete lists) stamped with timestamp = sync time. Left in, every
  // sync makes this "Data window" count and date range look like real,
  // fresh activity happened just now, when nothing actually did. Every
  // other real activity count in the app already excludes these. Mixpanel's
  // own internal/autocapture/session-replay events ("$"-prefixed) and the
  // stray email-named events aren't real product activity either.
  const data = (rawData ?? []).filter(ev => {
    const props = ev.properties as Record<string, unknown> | null;
    return !props?.is_placeholder && isRealEventName(ev.name as string);
  });

  if (!data.length) {
    return { totalEvents: 0, totalUsers: 0, dateFrom: since, dateTo: new Date().toISOString(), bySource: [] };
  }

  const users = new Set<string>();
  const sourceMap: Record<string, number> = {};
  let dateFrom = data[0].timestamp as string;
  let dateTo = data[0].timestamp as string;

  for (const ev of data) {
    if (ev.user_id) users.add(ev.user_id as string);
    const props = ev.properties as Record<string, unknown> | null;
    const src = (props?.source as string) || "unknown";
    sourceMap[src] = (sourceMap[src] ?? 0) + 1;
    const ts = ev.timestamp as string;
    if (ts < dateFrom) dateFrom = ts;
    if (ts > dateTo) dateTo = ts;
  }

  return {
    totalEvents: data.length,
    totalUsers: users.size,
    dateFrom,
    dateTo,
    bySource: Object.entries(sourceMap)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
  };
}

// ─── Parse cohort from prompt (AI) ───────────────────────────────────────────

export type CohortFilter = {
  eventName: string | null;
  minOccurrences: number;
  description: string;
  // Optional second step — "did eventName, THEN secondEventName within
  // withinDays days, for the SAME user". Without this, a cohort is just
  // "fired eventName at least minOccurrences times", which silently can't
  // represent a compound condition like "clicked X and then rated Y within
  // 7 days" — that used to get collapsed down to a single event with the
  // rest of the sentence kept only as cosmetic description text. With this
  // set, getCohortConversion computes the real per-user conversion %
  // instead.
  secondEventName?: string | null;
  withinDays?: number | null;
};

export async function parseCohortFromPrompt(
  prompt: string,
  availableEvents: string[]
): Promise<{ filter?: CohortFilter; error?: string }> {
  try {
    const client = new Anthropic();
    const evList = availableEvents.slice(0, 100).join(", ");

    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `You are a product analytics assistant. The user wants to define a cohort.

Available events: ${evList || "none"}

User description: "${prompt}"

Some descriptions are a SINGLE condition ("users who fired signup at least twice"). Others are TWO STEPS with an implied order and often a time window ("users who clicked visit hospital and then rated hospital within 7 days", "people who signed up and upgraded within a month"). Tell these apart — don't force a two-step description into a single event.

Return JSON only, no prose:
{
  "eventName": "<exact event name from list that happens FIRST, or null if all events>",
  "minOccurrences": <integer, minimum number of times user must fire eventName, default 1>,
  "secondEventName": "<exact event name from list that happens SECOND/after, or null if this is a single-condition cohort>",
  "withinDays": <integer days secondEventName must happen within, or null if not a two-step cohort or no time bound was mentioned>,
  "description": "<one sentence describing this cohort, mentioning both steps if there are two>"
}

If no matching event, set eventName to null. Be conservative with minOccurrences.`,
      }],
    });

    const text = (msg.content[0] as { type: string; text: string }).text.trim();
    const json = JSON.parse(text.replace(/^```json\n?/, "").replace(/\n?```$/, ""));
    return { filter: json as CohortFilter };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ─── Two-step cohort conversion (real per-user matching) ──────────────────────
//
// Answers "of the users who fired eventName, what % also fired
// secondEventName within withinDays days, for that same user?" This reuses
// the exact same per-user time-window matching engine as the KPI property
// panel (computeTimeWindowedRate) instead of duplicating that logic — same
// engine, same guarantees, just a different pair of events.

export type CohortConversionResult = {
  eventName: string;
  secondEventName: string;
  withinDays: number;
  firstEventUsers: number;
  convertedPct: number;
  error?: string;
};

export async function getCohortConversion(
  orgId: string,
  filter: CohortFilter,
  lookbackDays: number = 90
): Promise<CohortConversionResult> {
  const empty = {
    eventName: filter.eventName ?? "",
    secondEventName: filter.secondEventName ?? "",
    withinDays: filter.withinDays ?? 7,
    firstEventUsers: 0,
    convertedPct: 0,
  };

  if (!filter.eventName || !filter.secondEventName) {
    return { ...empty, error: "This cohort isn't a two-step condition — pick a first and second event to measure conversion." };
  }

  // Sync the two events from Mixpanel before computing so the data is fresh.
  // Fire both syncs in parallel and don't fail if Mixpanel isn't connected.
  await Promise.allSettled([
    syncMixpanelRawEvents(orgId, [filter.eventName, filter.secondEventName], lookbackDays),
  ]);

  const admin = createAdminClient();
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const withinDays = filter.withinDays ?? 7;

  const [firstEvents, secondEvents] = await Promise.all([
    fetchEventRows(admin, orgId, filter.eventName, since),
    fetchEventRows(admin, orgId, filter.secondEventName, since),
  ]);

  const firstEventUsers = new Set(
    firstEvents.map((e) => e.user_id).filter((id): id is string => !!id)
  ).size;

  if (firstEventUsers === 0) {
    return {
      ...empty,
      withinDays,
      error: `No users fired "${filter.eventName}" in the last ${lookbackDays} days.`,
    };
  }

  // numerator = secondEvents (the "then did this" step), denominator =
  // firstEvents (the "users who did this" step) — same direction as the KPI
  // engine: did any numerator timestamp land within the window AFTER a
  // denominator timestamp, for the same user.
  const { total } = computeTimeWindowedRate(secondEvents, firstEvents, withinDays * 24, since);

  return {
    eventName: filter.eventName,
    secondEventName: filter.secondEventName,
    withinDays,
    firstEventUsers,
    convertedPct: total,
  };
}

// ─── AI insight on cohort retention data ──────────────────────────────────────

export async function getCohortInsight(
  data: CohortData,
  context: { weeks: number; eventName?: string; totalUsers: number }
): Promise<string> {
  if (!data.rows.length) return "";

  try {
    const client = new Anthropic();

    // Compute average retention per week — only counting cohorts that have
    // actually reached week w (see getCohortRetention's comment on the same
    // issue), so a cohort too young to have a week-w data point yet doesn't
    // get averaged in as if it scored 0%.
    const cols = Math.min(data.maxWeeks, 8);
    const todayWeek = weekStart(new Date());
    const avgByWeek = Array.from({ length: cols }, (_, w) => {
      if (w === 0) return 100;
      const valid = data.rows.filter(r => r.totalUsers > 0 && w < weekDiff(r.cohortWeek, todayWeek) + 1);
      if (!valid.length) return 0;
      return Math.round(valid.reduce((s, r) => s + Math.round((r.retained[w] / r.totalUsers) * 100), 0) / valid.length);
    });

    // null (not 0) when that week hasn't elapsed for this cohort yet — a
    // cohort that started 4 days ago genuinely doesn't have a week-1 number,
    // that's not the same as having one and it being 0%. Told explicitly in
    // the prompt below so the model doesn't conflate the two either.
    const cohortSummary = data.rows.slice(-6).map(r => {
      const elapsed = weekDiff(r.cohortWeek, todayWeek) + 1;
      return {
        week: r.cohortWeek,
        users: r.totalUsers,
        wk1: r.totalUsers && elapsed > 1 ? Math.round((r.retained[1] ?? 0) / r.totalUsers * 100) : null,
        wk2: r.totalUsers && elapsed > 2 ? Math.round((r.retained[2] ?? 0) / r.totalUsers * 100) : null,
      };
    });

    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `Analyze this cohort retention data and give 3 sharp, actionable insights. Be specific with numbers.

Context:
- Time window: last ${context.weeks} weeks
- Event filter: ${context.eventName || "all events"}
- Total users: ${context.totalUsers.toLocaleString()}
- Average retention by week: ${avgByWeek.map((p, w) => `Wk${w}: ${p}%`).join(", ")}
- Recent cohorts (week, users, wk1 ret%, wk2 ret%): ${JSON.stringify(cohortSummary)}
  (wk1/wk2 is null when that week hasn't happened yet for that cohort — treat that as "too early to tell", never as 0%)

Write 3 bullet points. Each bullet: 1-2 sentences, specific numbers, actionable. No fluff. Start each with "•".`,
      }],
    });

    return (msg.content[0] as { type: string; text: string }).text.trim();
  } catch {
    return "";
  }
}
