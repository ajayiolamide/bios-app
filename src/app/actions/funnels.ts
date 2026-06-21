"use server";

import { createServerClient, createAdminClient } from "@/lib/supabase/server";
import type { Funnel } from "@/types/database";
import { getMixpanelSettings, fetchMixpanelEventCounts } from "@/app/actions/mixpanel";

export type FunnelStep = { event_name: string };

export type FunnelStepResult = {
  step: number;
  event_name: string;
  users: number;
  conversion_from_prev: number; // % vs previous step
  conversion_from_first: number; // % vs step 1
  data_source: "events" | "mixpanel" | "none"; // where the count came from
};

export type FunnelWithResults = Funnel & {
  results: FunnelStepResult[];
};

// ─── List ────────────────────────────────────────────────────────────────────

export async function getFunnels(orgId: string): Promise<Funnel[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("funnels")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createFunnel(
  orgId: string,
  payload: { name: string; description: string; steps: FunnelStep[] }
): Promise<{ data: Funnel | null; error: string | null }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: "Not authenticated" };

  if (payload.steps.length < 2) {
    return { data: null, error: "A funnel needs at least 2 steps" };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("funnels")
    .insert({
      organization_id: orgId,
      name: payload.name.trim(),
      description: payload.description.trim() || null,
      steps: payload.steps,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) {
    console.error("[createFunnel]", error);
    return { data: null, error: error.message };
  }
  return { data, error: null };
}

// ─── Delete ──────────────────────────────────────────────────────────────────

export async function deleteFunnel(funnelId: string): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const { error } = await admin.from("funnels").delete().eq("id", funnelId);
  return { error: error?.message ?? null };
}

// ─── Compute conversion ──────────────────────────────────────────────────────

export async function computeFunnel(
  orgId: string,
  steps: FunnelStep[]
): Promise<FunnelStepResult[]> {
  if (steps.length === 0) return [];

  const admin = createAdminClient();

  // Fetch all relevant events for this funnel (last 30 days)
  const since = new Date();
  since.setDate(since.getDate() - 29);
  since.setHours(0, 0, 0, 0);

  const eventNames = [...new Set(steps.map((s) => s.event_name))];

  // Fetch real user-level events (excludes Mixpanel stubs which have null user_id)
  const { data: userEvents } = await admin
    .from("events")
    .select("user_id, name, timestamp")
    .eq("organization_id", orgId)
    .in("name", eventNames)
    .gte("timestamp", since.toISOString())
    .not("user_id", "is", null)
    .order("timestamp", { ascending: true });

  // Check which event names have Mixpanel stub rows (source=mixpanel, user_id=null)
  const { data: mixpanelStubs } = await admin
    .from("events")
    .select("name")
    .eq("organization_id", orgId)
    .filter("properties->>source", "eq", "mixpanel")
    .in("name", eventNames);
  const mixpanelNames = new Set((mixpanelStubs ?? []).map(r => r.name as string));

  // Sequential user-journey counts from real events
  const byUser: Record<string, { name: string; timestamp: string }[]> = {};
  for (const ev of (userEvents ?? [])) {
    if (!ev.user_id) continue;
    if (!byUser[ev.user_id]) byUser[ev.user_id] = [];
    byUser[ev.user_id].push({ name: ev.name, timestamp: ev.timestamp });
  }

  const stepCounts: number[] = steps.map(() => 0);
  for (const evList of Object.values(byUser)) {
    let stepIdx = 0;
    let lastTs: string | null = null;
    for (const ev of evList) {
      if (stepIdx >= steps.length) break;
      if (ev.name === steps[stepIdx].event_name) {
        if (lastTs === null || ev.timestamp >= lastTs) {
          stepCounts[stepIdx]++;
          lastTs = ev.timestamp;
          stepIdx++;
        }
      }
    }
  }

  // For steps that have 0 real users but are Mixpanel events, fetch Mixpanel counts
  const mixpanelOnlySteps = steps
    .map((s, i) => ({ ...s, i }))
    .filter(s => stepCounts[s.i] === 0 && mixpanelNames.has(s.event_name));

  let mixpanelCounts: Record<string, number> = {};
  if (mixpanelOnlySteps.length > 0) {
    const mpNames = [...new Set(mixpanelOnlySteps.map(s => s.event_name))];
    const { settings, connected } = await getMixpanelSettings(orgId);
    if (connected && settings) {
      const { counts } = await fetchMixpanelEventCounts(orgId, mpNames, 30);
      if (counts) mixpanelCounts = counts;
    }
  }

  // Determine data_source and final count per step
  type StepData = { count: number; source: FunnelStepResult["data_source"] };
  const finalSteps: StepData[] = steps.map((s, i) => {
    if (stepCounts[i] > 0) return { count: stepCounts[i], source: "events" };
    if (mixpanelCounts[s.event_name] !== undefined) {
      return { count: mixpanelCounts[s.event_name], source: "mixpanel" };
    }
    return { count: 0, source: "none" };
  });

  const firstCount = finalSteps[0]?.count || 0;

  return steps.map((s, i) => {
    const { count, source } = finalSteps[i];
    const prevCount = i === 0 ? count : finalSteps[i - 1].count;
    return {
      step: i + 1,
      event_name: s.event_name,
      users: count,
      conversion_from_prev:
        i === 0 ? 100 : prevCount === 0 ? 0 : Math.round((count / prevCount) * 100),
      conversion_from_first:
        firstCount === 0 ? 0 : Math.round((count / firstCount) * 100),
      data_source: source,
    };
  });
}
