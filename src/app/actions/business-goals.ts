"use server";

import { createAdminClient, createServerClient } from "@/lib/supabase/server";
import type { BusinessGoal, FeatureSuggestion } from "@/types/database";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Must stay in sync with GOAL_TYPES/TIMEFRAMES in goals/page.tsx — duplicated
// here (rather than imported) because that file is a client component and
// this is a small, stable enum, not worth threading through a shared module.
const GOAL_TYPE_VALUES = ["revenue", "growth", "retention", "product", "operational", "market"];
const TIMEFRAME_VALUES = [
  "Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026",
  "H1 2026", "H2 2026", "Annual 2026",
  "Q1 2027", "Annual 2027",
];

function stripJsonFences(raw: string): string {
  return raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
}

// ─── AI: turn a plain-English description into a structured goal ──────────────
//
// The guided goal wizard's whole point (per the "this needs to be simplified
// to the barest minimum" feedback) is that nobody should have to already
// know what a "type" or "timeframe" is before they can create a goal — they
// describe what they're trying to achieve in their own words, and this picks
// the structured fields for them to confirm/edit, instead of handing them a
// blank multi-field form first.
export async function proposeGoalFromDescription(
  description: string
): Promise<{ title?: string; type?: string; target?: string; timeframe?: string; description?: string; error?: string }> {
  if (!description.trim()) return { error: "Describe what you're trying to achieve first." };

  const prompt = `A non-technical product/business person is creating a goal on an internal BI tool called Metrik. They described what they want in their own words — turn it into a clean, structured goal they can confirm or tweak.

Their description: "${description.trim()}"

Pick the single best-fitting type from exactly this list: ${GOAL_TYPE_VALUES.join(", ")}.
Pick the single best-fitting timeframe from exactly this list: ${TIMEFRAME_VALUES.join(", ")}. If nothing in their description implies a timeframe, default to the soonest quarter in that list.

Return ONLY this JSON, no markdown fences, no commentary:
{
  "title": "short, specific goal title, under 12 words",
  "type": "one of the type values above, exactly as written",
  "target": "short target text, e.g. '95% of claims paid within 24h' or '£2M ARR' — pull a concrete number from their description if they gave one, otherwise propose a reasonable placeholder they can edit",
  "timeframe": "one of the timeframe values above, exactly as written",
  "description": "one sentence on why this matters, in their own words where possible"
}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = (msg.content[0] as { type: string; text: string }).text.trim();
    const parsed = JSON.parse(stripJsonFences(raw)) as {
      title: string; type: string; target: string; timeframe: string; description: string;
    };
    return parsed;
  } catch (err) {
    console.error("[proposeGoalFromDescription]", err);
    return { error: "Couldn't generate a suggestion — try rephrasing, or fill the fields in yourself below." };
  }
}

// ─── AI: turn a plain-English "what to measure" into a structured KPI ─────────
//
// Same idea, one step later: rather than a blank KPI form (event picker,
// aggregation, target, plus an "Advanced" section with reference events and
// time windows nobody should have to understand up front), the person says
// what they'd look at to know the goal is moving, and this proposes the KPI
// — including checking whether they're already tracking a matching event,
// so they're not asked to invent one that already exists.
export async function proposeKpiFromDescription(
  goalTitle: string,
  description: string,
  existingEventNames: string[]
): Promise<{
  name?: string; target?: string; target_value?: number | null;
  matched_event_name?: string | null; aggregation?: string; error?: string;
}> {
  if (!description.trim()) return { error: "Describe what you'd measure first." };

  const eventsBlock = existingEventNames.length > 0
    ? `Events already tracked in this product:\n${existingEventNames.slice(0, 200).map((e) => `- ${e}`).join("\n")}\nIf one of these clearly IS the signal they described, return its exact name (character-for-character) as matched_event_name. Otherwise return null — do not invent an event name that isn't in this list.`
    : `No events are tracked yet in this product — always return matched_event_name as null.`;

  const prompt = `A non-technical person is defining a KPI (key result) for this goal: "${goalTitle}".
They described what they'd measure: "${description.trim()}"

${eventsBlock}

Return ONLY this JSON, no markdown fences, no commentary:
{
  "name": "short KPI name, under 10 words, e.g. 'Claims paid within 24h'",
  "target": "short target text they can read at a glance, e.g. '95%' or '1,000 signups'",
  "target_value": a plain number extracted from the target, or null if there isn't a clean one,
  "matched_event_name": an exact existing event name from the list above, or null,
  "aggregation": "one of: count, unique_users, unique_sessions — pick whichever best fits what they described"
}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = (msg.content[0] as { type: string; text: string }).text.trim();
    const parsed = JSON.parse(stripJsonFences(raw)) as {
      name: string; target: string; target_value: number | null; matched_event_name: string | null; aggregation: string;
    };
    return parsed;
  } catch (err) {
    console.error("[proposeKpiFromDescription]", err);
    return { error: "Couldn't generate a suggestion — try rephrasing, or fill it in yourself below." };
  }
}

// ─── Get all goals for an org (including dropped) ─────────────────────────────

export async function getBusinessGoals(orgId: string): Promise<BusinessGoal[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("business_goals")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  return (data ?? []) as BusinessGoal[];
}

// ─── Create a new business goal ───────────────────────────────────────────────

export async function createBusinessGoal(
  orgId: string,
  payload: {
    title: string;
    description?: string;
    type: string;
    target?: string;
    timeframe?: string;
    // Which company-wide objective (the real "Business Goal") this Product
    // Goal ladders up to — optional, can be assigned later.
    company_objective_id?: string | null;
  }
): Promise<{ id?: string; error?: string }> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("business_goals")
    .insert({
      organization_id: orgId,
      created_by: user.id,
      title: payload.title,
      description: payload.description || null,
      type: payload.type as BusinessGoal["type"],
      target: payload.target || null,
      timeframe: payload.timeframe || null,
      company_objective_id: payload.company_objective_id || null,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { id: data.id };
}

// ─── Update goal status ────────────────────────────────────────────────────────

export async function updateGoalStatus(
  id: string,
  status: BusinessGoal["status"]
): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("business_goals")
    .update({ status })
    .eq("id", id);
  if (error) return { error: error.message };
  return {};
}

// ─── Update goal date window ──────────────────────────────────────────────────

export async function updateGoalDates(
  id: string,
  start_date: string | null,
  end_date: string | null
): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("business_goals")
    .update({ start_date, end_date, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  return {};
}

// ─── Soft-drop a goal ─────────────────────────────────────────────────────────

export async function deleteBusinessGoal(id: string): Promise<{ error?: string }> {
  const admin = createAdminClient();
  // This previously returned void and never checked for a failed write — the
  // page removed the goal from view immediately regardless of whether the
  // UPDATE actually landed. If it silently failed (e.g. the database under
  // strain), the goal looked deleted but its status never changed in the
  // DB, so the next refetch brought it back as "active" — looking like it
  // had spontaneously reappeared.
  const { error } = await admin.from("business_goals").update({ status: "dropped" }).eq("id", id);
  if (error) return { error: error.message };
  return {};
}

// ─── Permanently delete a goal (hard delete — removes from DB + reports) ──────

export async function permanentlyDeleteBusinessGoal(id: string): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin.from("business_goals").delete().eq("id", id);
  if (error) return { error: error.message };
  return {};
}

// ─── Goal health data ─────────────────────────────────────────────────────────

export type FeatureHealthItem = {
  id: string;
  feature_name: string;
  suggestions: FeatureSuggestion[];
  launch_status: string;
  planned_launch_date: string | null;
  actual_launch_date: string | null;
  target_kpi_id: string | null;
};

export type GoalHealthData = {
  featuresByGoal: Record<string, FeatureHealthItem[]>; // goal_id → features
  eventCounts: Record<string, number>;                  // event_name → count
};

export async function getGoalHealthData(orgId: string): Promise<GoalHealthData> {
  const admin = createAdminClient();

  // 1. All active feature plans linked to a goal
  const { data: features } = await admin
    .from("feature_metrics")
    .select("id, feature_name, business_goal_id, suggestions, launch_status, planned_launch_date, actual_launch_date, target_kpi_id")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .not("business_goal_id", "is", null);

  if (!features?.length) return { featuresByGoal: {}, eventCounts: {} };

  const today = new Date().toISOString().slice(0, 10);

  // 2. Group by goal — include all features for display but only count events for launched ones
  const featuresByGoal: Record<string, FeatureHealthItem[]> = {};
  const launchedEventNames = new Set<string>(); // only from launched features

  for (const f of features) {
    const goalId = f.business_goal_id as string;
    if (!featuresByGoal[goalId]) featuresByGoal[goalId] = [];
    const suggestions = (f.suggestions ?? []) as FeatureSuggestion[];

    // Compute effective launch status: auto-launch if planned date has arrived
    const rawStatus = f.launch_status as string;
    const effectiveLaunched =
      rawStatus === "launched" ||
      (rawStatus === "not_launched" && f.planned_launch_date && f.planned_launch_date <= today);

    featuresByGoal[goalId].push({
      id: f.id,
      feature_name: f.feature_name,
      suggestions,
      launch_status: effectiveLaunched ? "launched" : rawStatus,
      planned_launch_date: f.planned_launch_date,
      actual_launch_date: f.actual_launch_date,
      target_kpi_id: (f as { target_kpi_id?: string | null }).target_kpi_id ?? null,
    });

    // Only accumulate event names for effectively-launched features
    if (effectiveLaunched) {
      suggestions.forEach((s) => s.event_name && launchedEventNames.add(s.event_name));
    }
  }

  // 3. Count events for each launched feature's event names only
  //
  // These only ever feed a "firing / not firing" badge — whether the count
  // is 1 or 100,000 displays identically. "exact" forces Postgres to fully
  // scan/count matching rows for every one of these queries, in parallel,
  // one per distinct launched event name — on an org with a lot of events
  // and several launched features, that's several full scans firing at
  // once on every single Goals page load. "estimated" is enough for a
  // >0 check and removes that cost.
  const eventCounts: Record<string, number> = {};
  if (launchedEventNames.size > 0) {
    await Promise.all(
      [...launchedEventNames].map(async (name) => {
        const { count } = await admin
          .from("events")
          .select("*", { count: "estimated", head: true })
          .eq("organization_id", orgId)
          .eq("name", name)
          // Exclude only Sync Event Names' name-only placeholder rows — real
          // Mixpanel occurrences from Pull Mixpanel Data share the source tag
          // but aren't placeholders, so they should count toward firing status.
          .or("properties->>is_placeholder.is.null,properties->>is_placeholder.neq.true");
        eventCounts[name] = count ?? 0;
      })
    );
  }

  return { featuresByGoal, eventCounts };
}
