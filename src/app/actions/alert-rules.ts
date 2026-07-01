"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient, createServerClient } from "@/lib/supabase/server";
import type { AlertRule, AlertRuleType } from "@/types/database";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── AI insight for fired alerts ─────────────────────────────────────────────
async function generateAlertInsight(context: {
  ruleName: string;
  ruleType: string;
  metric: string;
  current: number;
  prior: number | null;
  unit: string;
  isRatio: boolean;
}): Promise<string> {
  try {
    const priorLine = context.prior != null
      ? `Prior period: ${context.prior.toFixed(context.isRatio ? 1 : 0)}${context.unit}`
      : "";
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 120,
      messages: [{
        role: "user",
        content: `You are the Head of Growth. A metric just triggered an alert. Write ONE sentence (max 25 words) that tells the team what this likely means for the business and the single most important action to take. Be specific and direct — no filler.

Alert: ${context.ruleName}
Metric: ${context.metric}
Current value: ${context.current.toFixed(context.isRatio ? 1 : 0)}${context.unit}
${priorLine}
Rule type: ${context.ruleType}`,
      }],
    });
    return msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
  } catch {
    return "";
  }
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
}): Promise<object[]> {
  const insight = await generateAlertInsight({
    ruleName: opts.ruleName,
    ruleType: opts.ruleType,
    metric: opts.metricLabel,
    current: opts.current,
    prior: opts.prior,
    unit: opts.unit,
    isRatio: opts.isRatio,
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
  slack_webhook_override?: string | null;
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
      slack_webhook_override: payload.slack_webhook_override?.trim() || null,
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
  if (patch.slack_webhook_override !== undefined) update.slack_webhook_override = patch.slack_webhook_override?.trim() || null;
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
  goal_name?: string;
};

export async function getOrgKpis(): Promise<KpiOption[]> {
  try {
    const orgId = await getOrgId();
    const admin = createAdminClient();
    // Fetch metrics with their goal name via business_goals join
    const { data } = await admin
      .from("metrics")
      .select("id, name, event_name, denominator_event_name, target_value, rate_as_percentage, business_goal_id")
      .eq("organization_id", orgId)
      .not("event_name", "is", null)
      .order("name");
    if (!data || data.length === 0) return [];

    // Enrich with goal names
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
      rate_as_percentage: boolean | null; business_goal_id: string | null;
    }) => ({
      id: m.id,
      name: m.name,
      event_name: m.event_name,
      denominator_event_name: m.denominator_event_name,
      target_value: m.target_value,
      rate_as_percentage: m.rate_as_percentage,
      goal_name: m.business_goal_id ? goalMap[m.business_goal_id] : undefined,
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
  to: Date
): Promise<number> {
  const { count } = await admin
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("name", eventName)
    .gte("timestamp", from.toISOString())
    .lt("timestamp", to.toISOString());
  return count ?? 0;
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
      .select("id, name, event_name, denominator_event_name, target_value, rate_as_percentage, within_hours")
      .eq("id", rule.kpi_id)
      .single();

    if (!metric || !metric.event_name) {
      return { fired: false, current: 0, prior: 0, pct_change: 0, message: "KPI not found or has no event configured", error: "KPI not found" };
    }
    if (metric.target_value == null) {
      return { fired: false, current: 0, prior: 0, pct_change: 0, message: "KPI has no target value set", error: "No target" };
    }

    const now = new Date();
    const lookbackMs = (metric.within_hours ?? rule.lookback_days * 24) * 3600_000;
    const from = new Date(now.getTime() - lookbackMs);

    const numCount = await countEvents(admin, orgId, metric.event_name, from, now);
    let actual: number;
    if (metric.denominator_event_name) {
      const denCount = await countEvents(admin, orgId, metric.denominator_event_name, from, now);
      actual = denCount > 0 ? (numCount / denCount) * 100 : 0;
    } else {
      actual = numCount;
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

    const numCurrent = await countEvents(admin, orgId, rule.numerator_event, currentFrom, now);
    const numPrior   = await countEvents(admin, orgId, rule.numerator_event, priorFrom, currentFrom);

    let current = numCurrent;
    let prior   = numPrior;

    if (rule.denominator_event) {
      const denCurrent = await countEvents(admin, orgId, rule.denominator_event, currentFrom, now);
      const denPrior   = await countEvents(admin, orgId, rule.denominator_event, priorFrom, currentFrom);
      current = denCurrent > 0 ? (numCurrent / denCurrent) * 100 : 0;
      prior   = denPrior  > 0 ? (numPrior  / denPrior)  * 100 : 0;
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
