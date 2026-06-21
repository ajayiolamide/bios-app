"use server";

import { createServerClient, createAdminClient } from "@/lib/supabase/server";
import type { Funnel } from "@/types/database";
import { getMixpanelSettings, fetchMixpanelEventCounts, syncMixpanelRawEvents } from "@/app/actions/mixpanel";
import Anthropic from "@anthropic-ai/sdk";

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

  // Picking a step's event name only ever searched Mixpanel for the NAME
  // (via syncMixpanelEventNames' "Top Events" list, capped at the top 255 by
  // volume over the last 31 days) — it never pulled the actual per-user
  // occurrence rows. A real, low-volume, or simply newer event can be
  // completely real in Mixpanel and still have zero rows in our own `events`
  // table, which is what this function actually reads from. That showed up
  // as "0 users / no data" for a step that's genuinely firing — exactly the
  // same gap Cohorts had before it started syncing on demand. Doing the same
  // here means a funnel works correctly the moment it's computed, not only
  // for events that happened to already be raw-synced by something else.
  const { connected } = await getMixpanelSettings(orgId);
  if (connected) {
    await syncMixpanelRawEvents(orgId, eventNames, 90).catch(() => {});
  }

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

// ─── Describe a funnel in plain English (AI) ─────────────────────────────────
//
// Building a funnel meant knowing the exact event names up front and adding
// each step one at a time — fine once you already know your event schema,
// but the whole reason someone reaches for "describe it" instead is that
// they don't want to go look that up first. This matches a plain-English
// description of a journey ("signup, then first claim, then payment") onto
// the org's real event names, in order, the same way Cohorts' prompt mode
// already does for a single event.

export type FunnelDraft = {
  name: string;
  description: string;
  steps: FunnelStep[];
};

export async function parseFunnelFromPrompt(
  prompt: string,
  availableEvents: string[]
): Promise<{ draft?: FunnelDraft; error?: string }> {
  if (!availableEvents.length) {
    return { error: "No events found yet — import or connect a data source first." };
  }
  try {
    const client = new Anthropic();
    const evList = availableEvents.slice(0, 200).join(", ");

    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `You are a product analytics assistant. The user wants to define a conversion funnel — an ORDERED sequence of events a user moves through.

Available events: ${evList}

User description: "${prompt}"

Map their description onto 2-6 of the available events, in the order they'd actually happen. Only use exact event names from the list above — never invent one. If a step in their description doesn't clearly match any available event, leave it out rather than guessing wrong, but keep at least 2 steps if at all possible.

Return JSON only, no prose:
{
  "name": "<short funnel name, e.g. 'Signup to first claim'>",
  "description": "<one sentence describing what this funnel measures>",
  "steps": ["<exact event name 1>", "<exact event name 2>", ...]
}`,
      }],
    });

    const text = (msg.content[0] as { type: string; text: string }).text.trim();
    const json = JSON.parse(text.replace(/^```json\n?/, "").replace(/\n?```$/, "")) as {
      name?: string; description?: string; steps?: string[];
    };

    const steps = (json.steps ?? []).filter((s): s is string => typeof s === "string" && availableEvents.includes(s));
    if (steps.length < 2) {
      return { error: "Couldn't confidently match at least 2 steps from your description to real events — try rephrasing, or switch to Build manually." };
    }

    return {
      draft: {
        name: json.name?.trim() || "Untitled funnel",
        description: json.description?.trim() || "",
        steps: steps.map(event_name => ({ event_name })),
      },
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ─── AI insight on a computed funnel ──────────────────────────────────────────
//
// A bare conversion chart still leaves "so what should I do about it" to the
// reader. This calls out the single biggest leak, whether the data behind
// it is thin enough to be unreliable, and one concrete next step — same
// pattern as Cohorts' AI Insight panel.

export async function getFunnelInsight(
  funnelName: string,
  results: FunnelStepResult[]
): Promise<string> {
  if (!results.length || results.every(r => r.users === 0)) return "";

  try {
    const client = new Anthropic();

    const stepSummary = results.map(r =>
      `${r.step}. ${r.event_name} — ${r.users} users (${r.conversion_from_prev}% of previous step, ${r.conversion_from_first}% of step 1, source: ${r.data_source})`
    ).join("\n");

    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 350,
      messages: [{
        role: "user",
        content: `Analyze this conversion funnel and give 2-3 sharp, actionable insights. Be specific with numbers.

Funnel: "${funnelName}"
Steps (last 30 days):
${stepSummary}

A step with source "none" has zero real tracked occurrences — call that out as a data gap, not a 0% drop-off, since there's no actual evidence either way. A step with source "mixpanel" is an aggregate count, not a sequential per-user journey, so its conversion number is rougher than the others — mention this if it materially affects your read of the funnel. If total users at step 1 is under ~20, say the sample is too small to draw firm conclusions yet, rather than reading too much into the percentages.

Format: 2-3 bullets, each starting with "•", each one or two sentences, no headers or preamble.`,
      }],
    });

    return (msg.content[0] as { type: string; text: string }).text.trim();
  } catch {
    return "";
  }
}
