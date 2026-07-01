"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient, createServerClient } from "@/lib/supabase/server";
import type { AlertRule, AlertRuleType } from "@/types/database";
import { fetchEventRows } from "@/app/actions/metrics";
import { computeTimeWindowedRate } from "@/lib/metrics-engine";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── AI insight for fired alerts ─────────────────────────────────────────────
async function generateAlertInsight(context: {
  ruleName: string;
  ruleDescription?: string | null;
  ruleType: string;
  metric: string;
  current: number;
  prior: number | null;
  unit: string;
  isRatio: boolean;
  numeratorCount?: number;
  denominatorCount?: number;
}): Promise<string> {
  try {
    const priorLine = context.prior != null
      ? `Prior period: ${context.prior.toFixed(context.isRatio ? 1 : 0)}${context.unit}`
      : "";
    const countsLine = context.isRatio && context.numeratorCount != null && context.denominatorCount != null
      ? `Real user counts: ${context.numeratorCount} completed out of ${context.denominatorCount} who started (${context.denominatorCount - context.numeratorCount} did not complete)`
      : "";
    // Description is the human-readable intent — use it as the primary context.
    // Event names (in metric) are internal technical identifiers; the AI must NOT
    // interpret or expand them (e.g. "IDV" is NOT "identity verification" — it's
    // an internal event naming convention). Use only the description and rule name.
    const humanContext = context.ruleDescription
      ? `What this alert tracks: ${context.ruleDescription}`
      : `Alert name: ${context.ruleName}`;

    const changeStr = context.prior != null
      ? context.current < context.prior
        ? `dropped from ${context.prior.toFixed(1)}% to ${context.current.toFixed(1)}%`
        : `changed from ${context.prior.toFixed(1)}% to ${context.current.toFixed(1)}%`
      : `is now ${context.current.toFixed(1)}%`;

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 180,
      messages: [{
        role: "user",
        content: `You are writing a Slack alert for a whole company — product, ops, finance, and leadership will read this. Write 2-3 sentences maximum.

STRICT RULES:
- Use ONLY the information given below. Do not invent, assume, or name any process or technology not explicitly stated.
- Do NOT mention specific user counts or raw numbers — use percentages only.
- Sentence 1: in plain English, what happened and what it means for the business (not just the number — explain the impact).
- Sentence 2: the single most specific action someone should take right now.
- Optional sentence 3: only if there is a meaningful consequence if no action is taken.

${humanContext}
Rate ${changeStr}`,
      }],
    });
    return msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
  } catch {
    return "";
  }
}

// ─── Preview insight for the rule form (mock numbers, real description) ──────
// Called client-side as the user types their description — lets them see
// exactly what the AI will write in Slack before they save the rule.
export async function previewAlertInsight(
  description: string,
  ruleName: string,
): Promise<string> {
  if (!description.trim()) return "";
  return generateAlertInsight({
    ruleName,
    ruleDescription: description,
    ruleType: "event_ratio_drop",
    metric: "",
    current: 54.8,
    prior: 55.3,
    unit: "%",
    isRatio: true,
    numeratorCount: 57,
    denominatorCount: 105,
  });
}

// ─── Build Block Kit payload for a fired alert ───────────────────────────────
async function buildAlertBlocks(opts: {
  ruleName: string;
  ruleType: string;
  description?: string | null;
  metricLabel: string;
  current: number;
  prior: number | null;
  unit: string;
  isRatio: boolean;
  reason: string;
  appUrl?: string;
  numeratorCount?: number;
  denominatorCount?: number;
  // If the user saved an edited insight on the rule, use that — no AI call needed.
  insightOverride?: string | null;
}): Promise<object[]> {
  // Use the saved insight if set; only call AI as a fallback.
  const insight = opts.insightOverride?.trim()
    ? opts.insightOverride.trim()
    : await generateAlertInsight({
        ruleName: opts.ruleName,
        ruleDescription: opts.description,
        ruleType: opts.ruleType,
        metric: opts.metricLabel,
        current: opts.current,
        prior: opts.prior,
        unit: opts.unit,
        isRatio: opts.isRatio,
        numeratorCount: opts.numeratorCount,
        denominatorCount: opts.denominatorCount,
      });

  const currentStr = `${opts.current.toFixed(opts.isRatio ? 1 : 0)}${opts.unit}`;
  const priorStr = opts.prior != null ? `${opts.prior.toFixed(opts.isRatio ? 1 : 0)}${opts.unit}` : null;

  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `🚨 ${opts.ruleName}`, emoji: true },
    },
  ];

  if (opts.description) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: opts.description }],
    });
  }

  // Metric values row
  const fields: object[] = [
    { type: "mrkdwn", text: `*Now*\n${currentStr}` },
  ];
  if (priorStr) {
    fields.push({ type: "mrkdwn", text: `*Prior period*\n${priorStr}` });
  }
  fields.push({ type: "mrkdwn", text: `*Condition*\n${opts.reason}` });

  blocks.push({ type: "section", fields });

  if (insight) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `💡 ${insight}` },
    });
  }

  const actions: object[] = [];
  if (opts.appUrl) {
    actions.push({
      type: "button",
      text: { type: "plain_text", text: "View in Metrik", emoji: true },
      url: opts.appUrl,
      style: "primary",
    });
  }
  if (actions.length) {
    blocks.push({ type: "actions", elements: actions });
  }

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `_Metrik alert · ${new Date().toUTCString()}_` }],
  });

  return blocks;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

async function getOrgId(): Promise<string> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1);
  if (!data || data.length === 0) throw new Error("No org found");
  return data[0].organization_id;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function getAlertRules(): Promise<{ rules: AlertRule[]; error: string | null }> {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { rules: [], error: "Not authenticated" };
    const { data: memberships } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .limit(1);
    const membership = memberships?.[0] ?? null;
    if (!membership) return { rules: [], error: null };
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("alert_rules")
      .select("*")
      .eq("organization_id", membership.organization_id)
      .order("created_at", { ascending: false });
    if (error) return { rules: [], error: error.message };
    return { rules: (data ?? []) as AlertRule[], error: null };
  } catch (err) {
    return { rules: [], error: (err as Error).message ?? String(err) };
  }
}

export type AlertRulePayload = {
  name: string;
  description?: string | null;
  rule_type: AlertRuleType;
  numerator_event: string;
  denominator_event?: string | null;
  threshold_pct?: number | null;
  threshold_abs?: number | null;
  lookback_days: number;
  kpi_id?: string | null;
  count_method?: "total" | "unique"; // event-based rules only; KPI rules use metric.aggregation
  slack_webhook_override?: string | null;
  slack_insight_override?: string | null; // user-edited insight text saved on the rule
  enabled?: boolean;
};

export async function createAlertRule(payload: AlertRulePayload): Promise<AlertRule> {
  const orgId = await getOrgId();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("alert_rules")
    .insert({
      organization_id: orgId,
      name: payload.name,
      description: payload.description?.trim() || null,
      enabled: payload.enabled ?? true,
      rule_type: payload.rule_type,
      numerator_event: payload.numerator_event.trim(),
      denominator_event: payload.denominator_event?.trim() || null,
      threshold_pct: payload.threshold_pct ?? null,
      threshold_abs: payload.threshold_abs ?? null,
      lookback_days: payload.lookback_days,
      kpi_id: payload.kpi_id ?? null,
      count_method: payload.count_method ?? "total",
      slack_webhook_override: payload.slack_webhook_override?.trim() || null,
      slack_insight_override: payload.slack_insight_override?.trim() || null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message ?? String(error));
  return data as AlertRule;
}

export async function updateAlertRule(id: string, patch: Partial<AlertRulePayload>): Promise<void> {
  const orgId = await getOrgId();
  const admin = createAdminClient();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description?.trim() || null;
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.rule_type !== undefined) update.rule_type = patch.rule_type;
  if (patch.numerator_event !== undefined) update.numerator_event = patch.numerator_event.trim();
  if (patch.denominator_event !== undefined) update.denominator_event = patch.denominator_event?.trim() || null;
  if (patch.threshold_pct !== undefined) update.threshold_pct = patch.threshold_pct ?? null;
  if (patch.threshold_abs !== undefined) update.threshold_abs = patch.threshold_abs ?? null;
  if (patch.lookback_days !== undefined) update.lookback_days = patch.lookback_days;
  if (patch.kpi_id !== undefined) update.kpi_id = patch.kpi_id ?? null;
  if (patch.count_method !== undefined) update.count_method = patch.count_method ?? "total";
  if (patch.slack_webhook_override !== undefined) update.slack_webhook_override = patch.slack_webhook_override?.trim() || null;
  if (patch.slack_insight_override !== undefined) update.slack_insight_override = patch.slack_insight_override?.trim() || null;
  const { error } = await admin
    .from("alert_rules")
    .update(update)
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) throw new Error(error.message ?? String(error));
}

export async function deleteAlertRule(id: string): Promise<void> {
  const orgId = await getOrgId();
  const admin = createAdminClient();
  const { error } = await admin
    .from("alert_rules")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) throw new Error(error.message ?? String(error));
}

// ─── KPI lookup (for the form dropdown) ──────────────────────────────────────

export type KpiOption = {
  id: string;
  name: string;
  event_name: string | null;
  denominator_event_name: string | null;
  target_value: number | null;
  rate_as_percentage: boolean | null;
  aggregation: "count" | "unique_users" | "unique_sessions" | null;
  goal_name?: string;
  goal_id?: string | null;
};

export async function getOrgKpis(): Promise<KpiOption[]> {
  try {
    const orgId = await getOrgId();
    const admin = createAdminClient();
    // Only pull real KPI-kind metrics that have a tracked event
    // (excludes orphaned feature guardrails, deleted-feature metrics, etc.)
    const { data } = await admin
      .from("metrics")
      .select("id, name, event_name, denominator_event_name, target_value, rate_as_percentage, aggregation, business_goal_id")
      .eq("organization_id", orgId)
      .eq("kind", "kpi")
      .not("event_name", "is", null)
      .order("name");
    if (!data || data.length === 0) return [];

    // Enrich with goal names from business_goals
    const goalIds = [...new Set(data.map((m: { business_goal_id: string | null }) => m.business_goal_id).filter(Boolean))] as string[];
    let goalMap: Record<string, string> = {};
    if (goalIds.length > 0) {
      const { data: goals } = await admin
        .from("business_goals")
        .select("id, name")
        .in("id", goalIds);
      if (goals) goalMap = Object.fromEntries(goals.map((g: { id: string; name: string }) => [g.id, g.name]));
    }

    return data.map((m: {
      id: string; name: string; event_name: string | null;
      denominator_event_name: string | null; target_value: number | null;
      rate_as_percentage: boolean | null; aggregation: string | null;
      business_goal_id: string | null;
    }) => ({
      id: m.id,
      name: m.name,
      event_name: m.event_name,
      denominator_event_name: m.denominator_event_name,
      target_value: m.target_value,
      rate_as_percentage: m.rate_as_percentage,
      aggregation: (m.aggregation as KpiOption["aggregation"]) ?? "count",
      goal_name: m.business_goal_id ? goalMap[m.business_goal_id] : undefined,
      goal_id: m.business_goal_id,
    }));
  } catch {
    return [];
  }
}

// ─── Evaluation engine ────────────────────────────────────────────────────────

export type EvalResult = {
  fired: boolean;
  current: number;
  prior: number;
  pct_change: number;
  message: string;
  error?: string;
};

async function countEvents(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  eventName: string,
  from: Date,
  to: Date,
  aggregation: "count" | "unique_users" | "unique_sessions" = "count"
): Promise<number> {
  if (aggregation === "unique_users") {
    // Count distinct user_ids
    const { data } = await admin
      .from("events")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("name", eventName)
      .gte("timestamp", from.toISOString())
      .lt("timestamp", to.toISOString())
      .not("user_id", "is", null);
    return new Set(data?.map((e: { user_id: string }) => e.user_id)).size;
  }
  if (aggregation === "unique_sessions") {
    const { data } = await admin
      .from("events")
      .select("session_id")
      .eq("organization_id", orgId)
      .eq("name", eventName)
      .gte("timestamp", from.toISOString())
      .lt("timestamp", to.toISOString())
      .not("session_id", "is", null);
    return new Set(data?.map((e: { session_id: string }) => e.session_id)).size;
  }
  // Default: total event count
  const { count } = await admin
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("name", eventName)
    .gte("timestamp", from.toISOString())
    .lt("timestamp", to.toISOString());
  return count ?? 0;
}

/**
 * Funnel-style ratio: of users who fired denominatorEvent in the window,
 * how many also fired numeratorEvent in the same window?
 * Numerator is always a subset of denominator — rate can never exceed 100%.
 * Returns { numerator, denominator } counts.
 */
async function countFunnelRatio(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  numeratorEvent: string,
  denominatorEvent: string,
  from: Date,
  to: Date,
): Promise<{ numerator: number; denominator: number }> {
  // Step 1: all unique users who fired the denominator (entry step) in the window
  const { data: denData } = await admin
    .from("events")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("name", denominatorEvent)
    .gte("timestamp", from.toISOString())
    .lt("timestamp", to.toISOString())
    .not("user_id", "is", null);

  const denUserIds = [...new Set((denData ?? []).map((e: { user_id: string }) => e.user_id))];
  const denominator = denUserIds.length;
  if (denominator === 0) return { numerator: 0, denominator: 0 };

  // Step 2: of those users, how many also fired the numerator event in the window?
  const { data: numData } = await admin
    .from("events")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("name", numeratorEvent)
    .gte("timestamp", from.toISOString())
    .lt("timestamp", to.toISOString())
    .in("user_id", denUserIds);

  const numUserIds = new Set((numData ?? []).map((e: { user_id: string }) => e.user_id));
  // Intersect: only count users who appear in both sets
  const numerator = denUserIds.filter(uid => numUserIds.has(uid)).length;

  return { numerator, denominator };
}

export async function evaluateRule(ruleId: string): Promise<EvalResult> {
  const orgId = await getOrgId();
  const admin = createAdminClient();
  const { data: rule, error: ruleErr } = await admin
    .from("alert_rules")
    .select("*")
    .eq("id", ruleId)
    .eq("organization_id", orgId)
    .single();
  if (ruleErr || !rule) return { fired: false, current: 0, prior: 0, pct_change: 0, message: "Rule not found", error: "Rule not found" };
  return _evaluateRuleData(admin, orgId, rule as AlertRule);
}

// Public server action: evaluate all rules for the current user's org right now.
// Used by the "Run all checks now" button on the Alerts page.
export async function runAllChecksNow(): Promise<{
  results: { ruleId: string; name: string; fired: boolean; message: string }[];
  error: string | null;
}> {
  try {
    const orgId = await getOrgId();
    const raw = await evaluateAllRules(orgId);
    const admin = createAdminClient();
    const { data: rules } = await admin
      .from("alert_rules")
      .select("id, name")
      .eq("organization_id", orgId);
    const nameMap: Record<string, string> = Object.fromEntries(
      (rules ?? []).map((r: { id: string; name: string }) => [r.id, r.name])
    );
    return {
      results: raw.map(r => ({
        ruleId: r.ruleId,
        name: nameMap[r.ruleId] ?? r.ruleId,
        fired: r.result.fired,
        message: r.result.message,
      })),
      error: null,
    };
  } catch (err) {
    return { results: [], error: (err as Error).message ?? String(err) };
  }
}

// ─── KPI-based rule evaluation ────────────────────────────────────────────────

async function _evaluateKpiRule(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  rule: AlertRule,
  fireSlack: boolean
): Promise<EvalResult> {
  try {
    if (!rule.kpi_id) throw new Error("kpi_below_target rule has no kpi_id");

    const { data: metric } = await admin
      .from("metrics")
      .select("id, name, event_name, denominator_event_name, target_value, rate_as_percentage, within_hours, aggregation, match_key_property, min_elapsed_hours, dedupe_minutes")
      .eq("id", rule.kpi_id)
      .single();

    if (!metric || !metric.event_name) {
      return { fired: false, current: 0, prior: 0, pct_change: 0, message: "KPI not found or has no event configured", error: "KPI not found" };
    }
    if (metric.target_value == null) {
      return { fired: false, current: 0, prior: 0, pct_change: 0, message: "KPI has no target value set", error: "No target" };
    }

    const agg = (metric.aggregation as "count" | "unique_users" | "unique_sessions") ?? "count";
    const now = new Date();
    const lookbackMs = (metric.within_hours ?? rule.lookback_days * 24) * 3600_000;
    const from = new Date(now.getTime() - lookbackMs);

    let actual: number;

    if (metric.denominator_event_name && metric.within_hours) {
      // Time-windowed KPI (e.g. "% of claims paid within 1200h of being lodged").
      // Must use per-occurrence matching (computeTimeWindowedRate), NOT independent
      // headcounts — independent counting would give >100% whenever successes from
      // earlier batches land inside the window while their triggers are outside it.
      const requireMatchKey = !!metric.match_key_property;
      // Extend the numerator window by within_hours so late-but-in-window matches
      // aren't clipped by the calendar boundary (same logic as attachTrendData).
      const numeratorUntil = new Date(now.getTime() + metric.within_hours * 3600_000);
      const [numeratorEvents, denominatorEvents] = await Promise.all([
        fetchEventRows(admin, orgId, metric.event_name, from, numeratorUntil),
        fetchEventRows(admin, orgId, metric.denominator_event_name, from, now),
      ]);
      const { total } = computeTimeWindowedRate(
        numeratorEvents,
        denominatorEvents,
        metric.within_hours,
        from,
        Math.ceil(lookbackMs / 86400_000),
        requireMatchKey,
        metric.min_elapsed_hours ?? null,
        metric.dedupe_minutes ?? null,
      );
      actual = total;
    } else if (metric.denominator_event_name && agg === "unique_users") {
      // Plain ratio KPI with unique-user aggregation: use funnel-style intersection
      // so the numerator is always a subset of the denominator and rate ≤ 100%.
      const { numerator, denominator } = await countFunnelRatio(
        admin, orgId, metric.event_name, metric.denominator_event_name, from, now
      );
      actual = denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
    } else if (metric.denominator_event_name) {
      // Plain ratio with raw event counts — independent headcounts are the right
      // method here (total successes ÷ total attempts, not per-user).
      const numCount = await countEvents(admin, orgId, metric.event_name, from, now, agg);
      const denCount = await countEvents(admin, orgId, metric.denominator_event_name, from, now, agg);
      actual = denCount > 0 ? Math.round((numCount / denCount) * 1000) / 10 : 0;
    } else {
      // Single-event KPI — just count/unique-count.
      actual = await countEvents(admin, orgId, metric.event_name, from, now, agg);
    }

    const target = metric.target_value as number;
    const thresholdPct = rule.threshold_pct ?? 70; // default: alert if below 70% of target
    const thresholdValue = (thresholdPct / 100) * target;

    const fired = actual < thresholdValue;
    const pctOfTarget = target > 0 ? (actual / target) * 100 : 0;
    const isRate = !!metric.denominator_event_name;
    const unit = isRate ? "%" : "";

    const message = fired
      ? `🚨 KPI Alert: ${rule.name} — ${metric.name}: ${actual.toFixed(1)}${unit} actual vs ${target}${unit} target (${pctOfTarget.toFixed(0)}% of target)`
      : `✅ ${rule.name} — On track: ${metric.name}: ${actual.toFixed(1)}${unit} actual vs ${target}${unit} target`;

    if (fired && fireSlack) {
      const { data: settings } = await admin
        .from("brand_settings")
        .select("slack_webhook")
        .eq("organization_id", orgId)
        .single();
      const webhookUrl = rule.slack_webhook_override || settings?.slack_webhook;
      if (webhookUrl) {
        const blocks = await buildAlertBlocks({
          ruleName: rule.name,
          ruleType: rule.rule_type,
          description: rule.description,
          metricLabel: metric.name,
          current: actual,
          prior: target,
          unit,
          isRatio: isRate,
          reason: `${actual.toFixed(1)}${unit} vs ${target}${unit} target — ${pctOfTarget.toFixed(0)}% of target (threshold: ${thresholdPct}%)`,
          appUrl: "https://metrik-tool.vercel.app/alerts",
          insightOverride: rule.slack_insight_override,
        });
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blocks, text: message }),
        });
      }
    }

    await admin
      .from("alert_rules")
      .update({
        last_checked_at: now.toISOString(),
        ...(fired ? { last_fired_at: now.toISOString() } : {}),
        last_result: { current: actual, prior: target, pct_change: pctOfTarget - 100, fired },
        updated_at: now.toISOString(),
      })
      .eq("id", rule.id);

    return { fired, current: actual, prior: target, pct_change: pctOfTarget - 100, message };
  } catch (err) {
    const error = (err as Error).message;
    return { fired: false, current: 0, prior: 0, pct_change: 0, message: `Error: ${error}`, error };
  }
}

// ─── Event-based rule evaluation ─────────────────────────────────────────────

async function _evaluateRuleData(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  rule: AlertRule,
  fireSlack = false
): Promise<EvalResult> {
  // Dispatch to KPI evaluator when it's a KPI rule
  if (rule.rule_type === "kpi_below_target") {
    return _evaluateKpiRule(admin, orgId, rule, fireSlack);
  }

  try {
    const now = new Date();
    const currentFrom = new Date(now.getTime() - rule.lookback_days * 86400_000);
    const priorFrom   = new Date(now.getTime() - rule.lookback_days * 2 * 86400_000);

    // count_method: "unique" uses funnel logic for ratios (numerator must be subset of denominator users)
    // and distinct user counts for single-event rules.
    // "total" counts all event occurrences.
    const isUnique = rule.count_method === "unique";
    const agg = isUnique ? "unique_users" : "count";

    let current: number;
    let prior: number;
    // Raw counts for ratio rules — threaded into Slack so the message can say
    // "48 of 105 users dropped off" instead of just "54.8%"
    let rawNumerator: number | undefined;
    let rawDenominator: number | undefined;

    if (isUnique && rule.denominator_event) {
      // Funnel mode: of users who fired denominator, how many also fired numerator?
      // This mirrors Mixpanel funnel behaviour — rate is always ≤ 100%.
      const [fCurrent, fPrior] = await Promise.all([
        countFunnelRatio(admin, orgId, rule.numerator_event, rule.denominator_event, currentFrom, now),
        countFunnelRatio(admin, orgId, rule.numerator_event, rule.denominator_event, priorFrom, currentFrom),
      ]);
      current = fCurrent.denominator > 0 ? (fCurrent.numerator / fCurrent.denominator) * 100 : 0;
      prior   = fPrior.denominator   > 0 ? (fPrior.numerator   / fPrior.denominator)   * 100 : 0;
      rawNumerator   = fCurrent.numerator;
      rawDenominator = fCurrent.denominator;
    } else {
      const numCurrent = await countEvents(admin, orgId, rule.numerator_event, currentFrom, now, agg);
      const numPrior   = await countEvents(admin, orgId, rule.numerator_event, priorFrom, currentFrom, agg);
      current = numCurrent;
      prior   = numPrior;
      if (rule.denominator_event) {
        const denCurrent = await countEvents(admin, orgId, rule.denominator_event, currentFrom, now, agg);
        const denPrior   = await countEvents(admin, orgId, rule.denominator_event, priorFrom, currentFrom, agg);
        current = denCurrent > 0 ? (numCurrent / denCurrent) * 100 : 0;
        prior   = denPrior  > 0 ? (numPrior  / denPrior)  * 100 : 0;
      }
    }

    const pct_change = prior > 0 ? ((current - prior) / prior) * 100 : 0;
    const isRatio = !!rule.denominator_event;
    const unitLabel = isRatio ? "%" : " events";

    let fired = false;
    let reason = "";
    const thr    = rule.threshold_pct ?? 0;
    const thrAbs = rule.threshold_abs ?? 0;

    if (rule.rule_type === "event_count_drop" || rule.rule_type === "event_ratio_drop") {
      fired = pct_change <= -thr;
      reason = `${pct_change.toFixed(1)}% change vs prior ${rule.lookback_days}d (threshold: −${thr}%)`;
    } else if (rule.rule_type === "event_count_rise" || rule.rule_type === "event_ratio_rise") {
      fired = pct_change >= thr;
      reason = `${pct_change >= 0 ? "+" : ""}${pct_change.toFixed(1)}% change vs prior ${rule.lookback_days}d (threshold: +${thr}%)`;
    } else if (rule.rule_type === "event_count_below") {
      fired = current < thrAbs;
      reason = `${current.toFixed(isRatio ? 1 : 0)}${unitLabel} (threshold: below ${thrAbs})`;
    } else if (rule.rule_type === "event_count_above") {
      fired = current > thrAbs;
      reason = `${current.toFixed(isRatio ? 1 : 0)}${unitLabel} (threshold: above ${thrAbs})`;
    } else if (rule.rule_type === "event_ratio_below") {
      fired = current < thrAbs;
      reason = `Conversion rate: ${current.toFixed(1)}% (threshold: below ${thrAbs}%)`;
    } else if (rule.rule_type === "event_ratio_above") {
      fired = current > thrAbs;
      reason = `Conversion rate: ${current.toFixed(1)}% (threshold: above ${thrAbs}%)`;
    }

    const metricLabel = isRatio
      ? `${rule.numerator_event} ÷ ${rule.denominator_event}`
      : rule.numerator_event;
    const message = fired
      ? `🚨 Alert: ${rule.name} — ${metricLabel}: ${current.toFixed(isRatio ? 1 : 0)}${unitLabel} now vs ${prior.toFixed(isRatio ? 1 : 0)}${unitLabel} prior`
      : `✅ ${rule.name} — OK: ${metricLabel}: ${current.toFixed(isRatio ? 1 : 0)}${unitLabel} now`;

    if (fired && fireSlack) {
      const { data: settings } = await admin
        .from("brand_settings")
        .select("slack_webhook")
        .eq("organization_id", orgId)
        .single();
      const webhookUrl = rule.slack_webhook_override || settings?.slack_webhook;
      if (webhookUrl) {
        const blocks = await buildAlertBlocks({
          ruleName: rule.name,
          ruleType: rule.rule_type,
          description: rule.description,
          metricLabel,
          current,
          prior,
          unit: unitLabel,
          isRatio,
          reason,
          appUrl: "https://metrik-tool.vercel.app/alerts",
          numeratorCount: rawNumerator,
          denominatorCount: rawDenominator,
          insightOverride: rule.slack_insight_override,
        });
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blocks, text: message }),
        });
      }
    }

    await admin
      .from("alert_rules")
      .update({
        last_checked_at: now.toISOString(),
        ...(fired ? { last_fired_at: now.toISOString() } : {}),
        last_result: { current, prior, pct_change, fired },
        updated_at: now.toISOString(),
      })
      .eq("id", rule.id);

    return { fired, current, prior, pct_change, message };
  } catch (err) {
    const error = (err as Error).message;
    return { fired: false, current: 0, prior: 0, pct_change: 0, message: `Error: ${error}`, error };
  }
}

// Called by the API cron route — evaluates ALL enabled rules for an org.
export async function evaluateAllRules(orgId: string): Promise<{ ruleId: string; result: EvalResult }[]> {
  const admin = createAdminClient();
  const { data: rules } = await admin
    .from("alert_rules")
    .select("*")
    .eq("organization_id", orgId)
    .eq("enabled", true);

  if (!rules || rules.length === 0) return [];

  const results = await Promise.all(
    (rules as AlertRule[]).map(async (rule) => ({
      ruleId: rule.id,
      result: await _evaluateRuleData(admin, orgId, rule, true),
    }))
  );
  return results;
}

// ─── Available event names (for rule form autocomplete) ───────────────────────
export async function getAlertEventNames(): Promise<string[]> {
  try {
    const orgId = await getOrgId();
    const admin = createAdminClient();
    const { data } = await admin
      .from("events")
      .select("name")
      .eq("organization_id", orgId)
      .order("name");
    if (!data) return [];
    const names = [...new Set(data.map((r: { name: string }) => r.name))];
    return names.sort();
  } catch {
    return [];
  }
}
