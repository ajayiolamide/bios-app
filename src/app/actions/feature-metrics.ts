"use server";

import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";
import { createAdminClient, createServerClient } from "@/lib/supabase/server";
import type { FeatureInput, FeatureSuggestion, FeatureMetric, BusinessGoal } from "@/types/database";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── AI: generate smart tracking suggestions ──────────────────────────────────

export async function generateFeatureSuggestions(
  input: FeatureInput,
  businessGoal?: BusinessGoal | null,
  existingEventNames?: string[],
  existingKpi?: { name: string; target: string | null; event_name: string | null } | null
): Promise<{ suggestions?: FeatureSuggestion[]; goalAlignment?: string; error?: string }> {

  const existingEventsBlock = existingEventNames && existingEventNames.length > 0
    ? `\nThe product already fires these events — prefer reusing them as "event_name" where they fit the tracking item, rather than inventing new names:\n${existingEventNames.map(e => `- ${e}`).join("\n")}\nIf none fit, invent a clear snake_case name as usual.\n`
    : "";

  const goalBlock = businessGoal
    ? `
The team has a live business goal this feature should serve:
- Goal: "${businessGoal.title}"
- Type: ${businessGoal.type}
- Target: ${businessGoal.target ?? "not specified"}
- Timeframe: ${businessGoal.timeframe ?? "not specified"}
- Context: ${businessGoal.description ?? "none"}

Generate tracking items that are directly relevant to measuring whether this feature moves the needle on that goal.
`
    : "";

  // A KPI is owned by the goal, not invented fresh per feature. If the team
  // already picked which existing KPI this feature targets, the AI's job
  // narrows to adoption (metric) + safety (guardrail) only — it must not
  // propose a second, competing "kpi" item for the same goal.
  const kpiBlock = existingKpi
    ? `
This feature has already been pointed at an EXISTING KPI that belongs to the goal — do not invent a new "kpi"-type item:
- KPI: "${existingKpi.name}"
- Target: ${existingKpi.target ?? "not specified"}
- Tracked via event: ${existingKpi.event_name ?? "not yet defined"}

Only suggest "metric" (adoption/usage of this specific feature) and "guardrail" (something that must not get worse) items. Do not include a "kpi" type in your response.
`
    : "";

  const prompt = `You are a senior product analytics consultant specialising in feature measurement strategy.

A team is shipping a new feature and needs to know exactly what to track.

Feature context:
- Name: ${input.feature_name}
- Description: ${input.feature_description}
- Business sector: ${input.sector}
- Target users: ${input.target_users}
- What success looks like: ${input.success_definition}
- What failure looks like: ${input.failure_definition}
- How often users interact: ${input.interaction_frequency}
- Launch timeline: ${input.launch_timeline}
${existingEventsBlock}${goalBlock}${kpiBlock}

Your task: recommend between ${existingKpi ? "1 and 2" : "2 and 4"} things to track. Choose the TYPE MIX that best fits this specific feature:

TYPE GUIDE (use this to decide the right mix):
${existingKpi ? `- This feature already has a KPI (above) — suggest 1 metric (adoption) and, if relevant, 1 guardrail. Do not suggest a kpi type.` : `- Internal / operational features (infrastructure, tooling, internal workflows) → mostly KPIs, maybe 1 guardrail
- User-facing engagement / retention features → 1 metric + 1–2 KPIs + 1 guardrail
- Revenue / monetisation features → 1–2 KPIs + 1 metric + 1 guardrail
- Onboarding / activation features → 1 metric + 1 KPI + 1 guardrail
- Experimental / low-frequency features → 1 metric + 1 KPI (fewer items, higher uncertainty)`}

Type definitions:
- metric: a raw usage or behaviour measurement (e.g. adoption count, session frequency)
- kpi: a business outcome tied to a goal (e.g. 7-day retention, conversion rate)${existingKpi ? " — NOT NEEDED HERE, the goal already has one" : ""}
- guardrail: something that must NOT get worse — the floor (e.g. error rate, load time, support ticket volume)

Rules:
- ${existingKpi ? "1 to 2 items total" : "2 to 4 items total"} — choose the right count for the feature, don't pad it
- Be specific to THIS feature — no generic analytics advice
- "how_to_track": concrete implementation guidance — what event to fire, what property to include, what query to run
- "event_name": snake_case event name to fire in the product (e.g. "referral_invite_sent") — null if not applicable
- "compared_event_name": if this item is INHERENTLY a ratio of two events rather than a standalone count — e.g. an abandonment rate (started ÷ submitted), a conversion rate, or an error rate measured against attempts — put the OTHER event here (the one event_name is measured against). Most items are standalone counts: leave this null unless the metric genuinely can't be understood without both events. When set, "how_to_track" should describe it as event_name ÷ compared_event_name, not invent a third formula.
- "target": a specific realistic target (e.g. "> 30% of new users within 14 days") — null if not yet determinable
- "description": 1–2 sentences max
${businessGoal ? `\n- "goal_alignment": include a brief explanation of how this specific item connects to the business goal "${businessGoal.title}"` : ""}

Respond with ONLY valid JSON — no markdown, no explanation, just the array:

[
  {
    "type": "metric" | "kpi" | "guardrail",
    "name": "string",
    "description": "string",
    "how_to_track": "string",
    "event_name": "string | null",
    "compared_event_name": "string | null",
    "target": "string | null",
    "frequency": "daily" | "weekly" | "monthly"
  }
]`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2400,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = (msg.content[0] as { type: string; text: string }).text.trim();

    // Strip any markdown fences (```json ... ``` or ``` ... ```)
    // then extract the first JSON array we find — the model occasionally
    // adds a sentence before or after the array.
    let json = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const arrayMatch = json.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      console.error("[generateFeatureSuggestions] no JSON array found in response:", raw);
      return { error: "AI returned an unexpected format. Please try again." };
    }
    json = arrayMatch[0];

    // Normalize compared_event_name to null rather than leaving it undefined
    // when the model omits the field — the field was added after this
    // prompt's schema existed, so older runs/edge cases shouldn't crash
    // anything that expects it to be present.
    const parsed = (JSON.parse(json) as FeatureSuggestion[]).map((s) => ({
      ...s,
      compared_event_name: s.compared_event_name ?? null,
    }));

    const minItems = existingKpi ? 1 : 2;
    if (!Array.isArray(parsed) || parsed.length < minItems) {
      return { error: "AI returned an unexpected format. Please try again." };
    }

    // Generate a goal alignment summary if a goal was provided
    let goalAlignment: string | undefined;
    if (businessGoal) {
      goalAlignment = `This feature tracking plan is designed to measure progress toward "${businessGoal.title}". ` +
        `The selected metrics focus on ${businessGoal.type === "revenue" ? "revenue impact" :
          businessGoal.type === "retention" ? "retention and churn prevention" :
          businessGoal.type === "growth" ? "user acquisition and activation" :
          "operational outcomes"} that directly support achieving ${businessGoal.target ?? "this goal"}.`;
    }

    return { suggestions: parsed, goalAlignment };
  } catch (err) {
    console.error("[generateFeatureSuggestions]", err);
    return { error: "Failed to generate suggestions. Check your Anthropic API key." };
  }
}

// ─── Save a feature metric plan + auto-create in Goals & KPIs ────────────────

export async function saveFeatureMetric(
  orgId: string,
  input: FeatureInput,
  suggestions: FeatureSuggestion[],
  options?: { businessGoalId?: string; goalAlignment?: string; targetKpiId?: string | null }
): Promise<{ id?: string; error?: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const admin = createAdminClient();
  const pickedExistingKpi = !!options?.targetKpiId;

  // 1. Save the feature metric plan
  const { data, error } = await admin
    .from("feature_metrics")
    .insert({
      organization_id: orgId,
      created_by: user.id,
      ...input,
      suggestions,
      business_goal_id: options?.businessGoalId ?? null,
      target_kpi_id: options?.targetKpiId ?? null,
      goal_alignment: options?.goalAlignment ?? null,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // 2. Auto-create metric entries in Goals & KPIs for each suggestion that has an event_name.
  // Carry the hierarchy forward: this metric belongs to this feature, which
  // (if the user picked one) serves this business goal — and keep the
  // suggested target/type instead of dropping them on the floor.
  // If the team already pointed this feature at an existing goal-level KPI,
  // skip creating another "kpi"-kind row — that would orphan a duplicate
  // instead of sharing the one the goal already has. Otherwise, the first
  // "kpi"-kind suggestion becomes a brand new goal-level KPI, and the
  // feature is pointed at it.
  // Best-effort — don't fail the save if this part errors
  try {
    const trackable = suggestions
      .filter((s) => s.event_name)
      .filter((s) => !(pickedExistingKpi && s.type === "kpi"));

    if (trackable.length > 0) {
      const metricsToCreate = trackable.map((s) => {
        const agg: "count" | "unique_users" | "unique_sessions" =
          s.type === "kpi" ? "unique_users" : "count";
        return {
          organization_id: orgId,
          created_by: user.id,
          name: `[${input.feature_name}] ${s.name}`,
          description: s.description,
          event_name: s.event_name!,
          // A suggestion with a compared_event_name is inherently a ratio
          // (e.g. abandonment rate) — carry that through so it's computed
          // as one by the same engine goal-level KPIs use, instead of
          // landing as a flat count that misrepresents it. Plain ratio (no
          // time window) by default — within_hours isn't something the AI
          // proposes, only added later via the property UI on Goals.
          denominator_event_name: s.compared_event_name || null,
          rate_as_percentage: true,
          aggregation: agg,
          business_goal_id: options?.businessGoalId ?? null,
          feature_metric_id: data.id,
          target: s.target,
          kind: s.type,
        };
      });
      const { data: createdMetrics } = await admin
        .from("metrics")
        .insert(metricsToCreate)
        .select("id, kind");

      // If this feature proposed a brand new KPI (rather than targeting an
      // existing one), point the feature at it now that it has an id.
      if (!pickedExistingKpi) {
        const newKpi = (createdMetrics ?? []).find((m) => m.kind === "kpi");
        if (newKpi) {
          await admin.from("feature_metrics").update({ target_kpi_id: newKpi.id }).eq("id", data.id);
        }
      }
    }
  } catch (err) {
    console.warn("[saveFeatureMetric] auto-create metrics failed:", err);
  }

  return { id: data.id };
}

// ─── List feature metric plans for an org ────────────────────────────────────

export async function getFeatureMetrics(orgId: string): Promise<FeatureMetric[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("feature_metrics")
    .select("*")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  return (data ?? []) as FeatureMetric[];
}

// ─── Add a guardrail to an existing feature ───────────────────────────────────
// A guardrail is the "thing that shouldn't get worse" paired against a
// feature's adoption metric — e.g. adoption goes up but so does an error or
// failure event. It's added after the fact here (not just at planning time)
// because you often don't know what to watch for until the feature is live.
// Mirrors the auto-create-metric step in saveFeatureMetric so this shows up
// everywhere the KPI/feature hierarchy does, and feeds the same cohort
// comparison in computeFeatureImpact (adopter vs non-adopter guardrail rate).

export async function addGuardrailToFeature(
  featureId: string,
  orgId: string,
  guardrail: { name: string; description: string; eventName: string; comparedEventName?: string | null }
): Promise<{ error?: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const admin = createAdminClient();
  const { data: feature, error: fetchErr } = await admin
    .from("feature_metrics")
    .select("feature_name, suggestions, business_goal_id")
    .eq("id", featureId)
    .single();
  if (fetchErr || !feature) return { error: fetchErr?.message ?? "Feature not found" };

  const existing = (feature.suggestions ?? []) as FeatureSuggestion[];
  if (existing.some((s) => s.event_name === guardrail.eventName)) {
    return { error: "A tracking item already uses this event name." };
  }

  const comparedEventName = guardrail.comparedEventName?.trim() || null;

  const newSuggestion: FeatureSuggestion = {
    type: "guardrail",
    name: guardrail.name,
    description: guardrail.description,
    how_to_track: comparedEventName
      ? `Fire ${guardrail.eventName} whenever this failure/regression happens. Tracked as a rate of ${guardrail.eventName} ÷ ${comparedEventName}.`
      : `Fire ${guardrail.eventName} whenever this failure/regression happens.`,
    event_name: guardrail.eventName,
    compared_event_name: comparedEventName,
    target: null,
    frequency: "daily",
  };

  const { error: updateErr } = await admin
    .from("feature_metrics")
    .update({ suggestions: [...existing, newSuggestion], updated_at: new Date().toISOString() })
    .eq("id", featureId);
  if (updateErr) return { error: updateErr.message };

  const { error: metricErr } = await admin.from("metrics").insert({
    organization_id: orgId,
    created_by: user.id,
    name: `[${feature.feature_name}] ${guardrail.name}`,
    description: guardrail.description,
    event_name: guardrail.eventName,
    denominator_event_name: comparedEventName,
    rate_as_percentage: true,
    aggregation: "count",
    business_goal_id: feature.business_goal_id,
    feature_metric_id: featureId,
    kind: "guardrail",
  });
  if (metricErr) return { error: metricErr.message };

  return {};
}

// ─── Edit a saved suggestion's tracking frequency ─────────────────────────────
// The frequency shown on each Metric/KPI/Guardrail card (daily/weekly/monthly)
// is just the AI's first guess at how often the underlying event fires — the
// person who actually owns the feature may know better. This persists a
// correction back into the same suggestions jsonb array the rest of the
// suggestion (event name, target, etc.) already lives in.

export async function updateFeatureSuggestionFrequency(
  featureMetricId: string,
  index: number,
  frequency: FeatureSuggestion["frequency"]
): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { data: feature, error: fetchErr } = await admin
    .from("feature_metrics")
    .select("suggestions")
    .eq("id", featureMetricId)
    .single();
  if (fetchErr || !feature) return { error: fetchErr?.message ?? "Feature not found" };

  const suggestions = [...((feature.suggestions ?? []) as FeatureSuggestion[])];
  if (!suggestions[index]) return { error: "Suggestion not found" };
  suggestions[index] = { ...suggestions[index], frequency };

  const { error: updateErr } = await admin
    .from("feature_metrics")
    .update({ suggestions, updated_at: new Date().toISOString() })
    .eq("id", featureMetricId);
  if (updateErr) return { error: updateErr.message };
  return {};
}

// ─── Archive / delete ─────────────────────────────────────────────────────────

export async function archiveFeatureMetric(id: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("feature_metrics").update({ status: "archived" }).eq("id", id);
}

// ─── Launch date tracking ─────────────────────────────────────────────────────

export async function updateFeatureLaunchDate(
  id: string,
  planned_launch_date: string | null
): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("feature_metrics")
    .update({ planned_launch_date, updated_at: new Date().toISOString() })
    .eq("id", id);
  return { error: error?.message };
}

export async function confirmFeatureLaunch(
  id: string
): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await admin
    .from("feature_metrics")
    .update({ launch_status: "launched", actual_launch_date: today, updated_at: new Date().toISOString() })
    .eq("id", id);
  return { error: error?.message };
}

export type FeatureLaunchStatus =
  | "ideation" | "design" | "dev" | "uat" | "ready_for_launch"
  | "deployed" | "launched" | "post_launch" | "rolled_back" | "paused"
  | "not_launched" | "delayed" | "cancelled"; // legacy values kept for compat

export async function updateFeatureLaunchStatus(
  id: string,
  launch_status: FeatureLaunchStatus,
  actual_launch_date?: string | null
): Promise<{ error?: string }> {
  const admin = createAdminClient();

  // Fetch current status_log to append to it
  const { data: current } = await admin
    .from("feature_metrics")
    .select("status_log")
    .eq("id", id)
    .single();

  const existingLog = (current?.status_log ?? []) as { status: string; timestamp: string }[];
  const newLog = [...existingLog, { status: launch_status, timestamp: new Date().toISOString() }];

  const patch: Record<string, unknown> = {
    launch_status,
    status_log: newLog,
    updated_at: new Date().toISOString(),
  };
  if (actual_launch_date !== undefined) patch.actual_launch_date = actual_launch_date;
  const { error } = await admin.from("feature_metrics").update(patch).eq("id", id);
  return { error: error?.message };
}

// ─── Delete a single suggestion by index ─────────────────────────────────────

export async function deleteFeatureSuggestion(
  featureMetricId: string,
  index: number
): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { data: feature, error: fetchErr } = await admin
    .from("feature_metrics")
    .select("suggestions")
    .eq("id", featureMetricId)
    .single();
  if (fetchErr || !feature) return { error: fetchErr?.message ?? "Feature not found" };

  const suggestions = [...((feature.suggestions ?? []) as FeatureSuggestion[])];
  suggestions.splice(index, 1);

  const { error: updateErr } = await admin
    .from("feature_metrics")
    .update({ suggestions, updated_at: new Date().toISOString() })
    .eq("id", featureMetricId);
  return { error: updateErr?.message };
}

// ─── Add a suggestion manually ────────────────────────────────────────────────

export async function addFeatureSuggestion(
  featureMetricId: string,
  suggestion: FeatureSuggestion
): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { data: feature, error: fetchErr } = await admin
    .from("feature_metrics")
    .select("suggestions")
    .eq("id", featureMetricId)
    .single();
  if (fetchErr || !feature) return { error: fetchErr?.message ?? "Feature not found" };

  const suggestions = [...((feature.suggestions ?? []) as FeatureSuggestion[]), suggestion];

  const { error: updateErr } = await admin
    .from("feature_metrics")
    .update({ suggestions, updated_at: new Date().toISOString() })
    .eq("id", featureMetricId);
  return { error: updateErr?.message };
}

// ─── Update PM Slack handle ───────────────────────────────────────────────────

export async function updateFeaturePmSlackHandle(
  id: string,
  pm_slack_handle: string | null
): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("feature_metrics")
    .update({ pm_slack_handle, updated_at: new Date().toISOString() })
    .eq("id", id);
  return { error: error?.message };
}

// ─── Slack: notify on feature status change ───────────────────────────────────

export async function notifySlackFeatureStatusChange(
  orgId: string,
  featureName: string,
  newStatus: string,
  pmHandle: string | null
): Promise<void> {
  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("brand_settings")
    .select("slack_webhook, pm_status_alerts_enabled")
    .eq("organization_id", orgId)
    .single();
  const webhookUrl = settings?.slack_webhook;
  if (!webhookUrl) return;
  // Respect the org-level toggle — default true if column not yet migrated
  const alertsEnabled = settings?.pm_status_alerts_enabled ?? true;
  if (!alertsEnabled) return;

  const mention = pmHandle
    ? (pmHandle.startsWith("@") ? pmHandle : `@${pmHandle}`)
    : null;
  const text = mention
    ? `${mention} — *${featureName}* status changed to *${newStatus}*`
    : `*${featureName}* status changed to *${newStatus}*`;
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `🔄 *Feature status update*\n${text}` },
        },
      ],
    }),
  }).catch(() => { /* best-effort */ });
}

// ─── Slack: send weekly feature digest for all active features ────────────────

export async function sendWeeklyFeatureDigest(orgId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("brand_settings")
    .select("slack_webhook, pm_weekly_digest_enabled")
    .eq("organization_id", orgId)
    .single();
  const webhookUrl = settings?.slack_webhook;
  if (!webhookUrl) return;
  // Respect the org-level toggle — default true if column not yet migrated
  const digestEnabled = settings?.pm_weekly_digest_enabled ?? true;
  if (!digestEnabled) return;
  const { data: features } = await admin
    .from("feature_metrics")
    .select("feature_name, launch_status, pm_slack_handle, planned_launch_date, suggestions")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (!features?.length) return;

  const lines = features.map((f) => {
    const pm = f.pm_slack_handle
      ? (f.pm_slack_handle.startsWith("@") ? f.pm_slack_handle : `@${f.pm_slack_handle}`)
      : "—";
    const date = f.planned_launch_date ? ` · launch ${f.planned_launch_date}` : "";
    const sugg = (f.suggestions as FeatureSuggestion[] | null) ?? [];
    const kpiCount = sugg.filter((s) => s.type === "kpi").length;
    const guardrailCount = sugg.filter((s) => s.type === "guardrail").length;
    return `• *${f.feature_name}* [${f.launch_status ?? "not_launched"}]${date} · PM: ${pm} · ${kpiCount} KPIs, ${guardrailCount} guardrails`;
  });

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "📊 Weekly Feature Digest", emoji: true },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: lines.join("\n") },
        },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `${features.length} active features tracked on Metrik` },
          ],
        },
      ],
    }),
  });
}

// ─── Bulk import features from a spreadsheet ──────────────────────────────────

export type SheetImportResult = {
  added: string[];
  skipped: string[];
  error?: string;
};

export async function importFeaturesFromSheet(
  orgId: string,
  fileBase64: string,
  fileName: string
): Promise<SheetImportResult> {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { added: [], skipped: [], error: "Not authenticated" };

    const admin = createAdminClient();

    // 1. Parse the workbook
    const buffer = Buffer.from(fileBase64, "base64");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });

    if (!rows.length) return { added: [], skipped: [], error: "Sheet appears to be empty." };

    // 2. Get headers + sample rows for AI mapping
    const headers = Object.keys(rows[0]);
    const sample = rows.slice(0, 3).map(r => Object.values(r).join(" | ")).join("\n");

    const mappingPrompt = `You are mapping spreadsheet columns to feature fields.

Headers: ${headers.join(", ")}
Sample rows (first 3):
${sample}

Map each header to one of these field keys (or null if no good match):
- feature_name (required — the name/title of the feature)
- feature_description (what the feature does)
- sector (business sector / industry)
- target_users (who uses this feature)
- success_definition (what success looks like)
- failure_definition (what failure looks like)
- interaction_frequency (how often users interact)
- launch_timeline (when it launches / launch date)

Return ONLY a JSON object like: {"feature_name": "Feature Name", "feature_description": "Description", ...}
Only include fields where you found a reasonable match. The feature_name mapping is required.`;

    const mappingRes = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: mappingPrompt }],
    });

    const mappingText = (mappingRes.content[0] as { type: string; text: string }).text.trim();
    const jsonMatch = mappingText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { added: [], skipped: [], error: "Could not determine column mapping from sheet." };

    const colMap: Record<string, string> = JSON.parse(jsonMatch[0]);
    if (!colMap.feature_name) return { added: [], skipped: [], error: "Could not find a feature name column in your sheet." };

    // 3. Fetch existing feature names for this org (case-insensitive dedup)
    const { data: existing } = await admin
      .from("feature_metrics")
      .select("feature_name")
      .eq("organization_id", orgId)
      .eq("status", "active");

    const existingNames = new Set(
      (existing ?? []).map(f => f.feature_name.toLowerCase().trim())
    );

    // 4. Map rows to FeatureInput and partition into new vs duplicate
    const added: string[] = [];
    const skipped: string[] = [];
    const toInsert: object[] = [];

    for (const row of rows) {
      const name = (row[colMap.feature_name] ?? "").trim();
      if (!name) continue;

      if (existingNames.has(name.toLowerCase())) {
        skipped.push(name);
        continue;
      }

      const input: FeatureInput = {
        feature_name: name,
        feature_description: colMap.feature_description ? (row[colMap.feature_description] ?? "") : "",
        sector: colMap.sector ? (row[colMap.sector] ?? "") : "",
        target_users: colMap.target_users ? (row[colMap.target_users] ?? "") : "",
        success_definition: colMap.success_definition ? (row[colMap.success_definition] ?? "") : "",
        failure_definition: colMap.failure_definition ? (row[colMap.failure_definition] ?? "") : "",
        interaction_frequency: colMap.interaction_frequency ? (row[colMap.interaction_frequency] ?? "") : "",
        launch_timeline: colMap.launch_timeline ? (row[colMap.launch_timeline] ?? "") : "",
      };

      toInsert.push({
        organization_id: orgId,
        created_by: user.id,
        ...input,
        suggestions: [],
      });

      added.push(name);
      existingNames.add(name.toLowerCase()); // prevent within-sheet duplicates
    }

    if (toInsert.length > 0) {
      const { error: insertError } = await admin
        .from("feature_metrics")
        .insert(toInsert);
      if (insertError) return { added: [], skipped, error: insertError.message };
    }

    return { added, skipped };
  } catch (err) {
    console.error("importFeaturesFromSheet error:", err);
    return { added: [], skipped: [], error: "Failed to process sheet. Please check the file format." };
  }
}

// ─── Preview sheet features (parse + dedup check, no insert) ─────────────────

export type PreviewFeature = {
  name: string;
  exists: boolean; // already in this org
  group?: string;  // product/category grouping (e.g. MCA, MCG) — for display only
};

export type SheetPreviewResult = {
  features: PreviewFeature[];
  error?: string;
};

export async function previewSheetFeatures(
  orgId: string,
  fileBase64: string,
  fileName: string
): Promise<SheetPreviewResult> {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { features: [], error: "Not authenticated" };

    const admin = createAdminClient();

    // 1. Parse workbook
    const buffer = Buffer.from(fileBase64, "base64");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (!rows.length) return { features: [], error: "Sheet appears to be empty." };

    const headers = Object.keys(rows[0]);

    // 2. Score every text column.
    //    Feature name columns: many unique values, long text → high score
    //    Category columns (e.g. MCA/MCG): few unique values, short text → low score
    //    Score = uniqueCount * avgLength * uniquenessRatio
    type ColStats = { h: string; score: number; uniqueCount: number; avgLen: number };
    const colStats: ColStats[] = [];
    for (const h of headers) {
      const vals = rows
        .map(r => String(r[h] ?? "").trim())
        .filter(v => v.length >= 2 && v.length <= 200 && isNaN(Number(v)));
      if (vals.length === 0) continue;
      const uniqueVals = new Set(vals.map(v => v.toLowerCase()));
      const avgLen = vals.reduce((s, v) => s + v.length, 0) / vals.length;
      const uniquenessRatio = uniqueVals.size / vals.length;
      colStats.push({ h, score: uniqueVals.size * avgLen * uniquenessRatio, uniqueCount: uniqueVals.size, avgLen });
    }
    if (colStats.length === 0) {
      return { features: [], error: `No text column found for feature names. Headers: ${headers.join(", ")}` };
    }
    colStats.sort((a, b) => b.score - a.score);
    const nameCol = colStats[0].h;

    // 3. Find a grouping column — text column with fewest unique values (≤10)
    //    that isn't the name column (used for display grouping in import modal only)
    const groupColCandidate = colStats
      .slice(1)
      .find(c => c.uniqueCount <= 10 && c.avgLen <= 20);
    const groupCol = groupColCandidate?.h;

    // 4. Extract names (and group label) from rows
    const seenNames = new Set<string>();
    const previewFeatures: Array<{ name: string; group?: string }> = [];
    for (const row of rows) {
      const name = String(row[nameCol] ?? "").trim();
      if (!name || name.length < 2 || !isNaN(Number(name))) continue;
      if (seenNames.has(name.toLowerCase())) continue;
      seenNames.add(name.toLowerCase());
      const group = groupCol ? String(row[groupCol] ?? "").trim() || undefined : undefined;
      previewFeatures.push({ name, group });
    }
    if (previewFeatures.length === 0) return { features: [], error: "No feature names found in sheet." };
    const names = previewFeatures.map(f => f.name);

    // 4. Check which already exist
    const { data: existing } = await admin
      .from("feature_metrics")
      .select("feature_name")
      .eq("organization_id", orgId)
      .eq("archived", false)
      .in("feature_name", names);

    const existingSet = new Set((existing ?? []).map((f: { feature_name: string }) => f.feature_name.toLowerCase().trim()));

    return {
      features: previewFeatures.map(f => ({
        name: f.name,
        exists: existingSet.has(f.name.toLowerCase()),
        group: f.group,
      })),
    };
  } catch (err) {
    console.error("previewSheetFeatures error:", err);
    return { features: [], error: "Failed to process sheet. Please check the file format." };
  }
}


// ─── Import a user-selected subset of features ───────────────────────────────

export async function importSelectedFeatures(
  orgId: string,
  featureNames: string[]
): Promise<SheetImportResult> {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { added: [], skipped: [], error: "Not authenticated" };

    const admin = createAdminClient();

    if (!featureNames.length) return { added: [], skipped: [] };

    const toInsert = featureNames.map(name => ({
      organization_id: orgId,
      created_by: user.id,
      feature_name: name,
      suggestions: [],
      launch_status: "ideation",
    }));

    const { error: insertError } = await admin.from("feature_metrics").insert(toInsert);
    if (insertError) return { added: [], skipped: [], error: insertError.message };

    return { added: featureNames, skipped: [] };
  } catch (err) {
    console.error("importSelectedFeatures error:", err);
    return { added: [], skipped: [], error: "Import failed. Please try again." };
  }
}
