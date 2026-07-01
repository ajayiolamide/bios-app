"use server";

import { createAdminClient, createServerClient } from "@/lib/supabase/server";
import type { AlertRule, AlertRuleType } from "@/types/database";

// ─── helpers ──────────────────────────────────────────────────────────────────

async function getOrgId(): Promise<string> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();
  if (!data) throw new Error("No org found");
  return data.organization_id;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function getAlertRules(): Promise<{ rules: AlertRule[]; error: string | null }> {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { rules: [], error: "Not authenticated" };
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();
    if (!membership) return { rules: [], error: null }; // no org yet — show empty state, not error
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
  rule_type: AlertRuleType;
  numerator_event: string;
  denominator_event?: string | null;
  threshold_pct?: number | null;
  threshold_abs?: number | null;
  lookback_days: number;
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
      enabled: payload.enabled ?? true,
      rule_type: payload.rule_type,
      numerator_event: payload.numerator_event.trim(),
      denominator_event: payload.denominator_event?.trim() || null,
      threshold_pct: payload.threshold_pct ?? null,
      threshold_abs: payload.threshold_abs ?? null,
      lookback_days: payload.lookback_days,
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
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.rule_type !== undefined) update.rule_type = patch.rule_type;
  if (patch.numerator_event !== undefined) update.numerator_event = patch.numerator_event.trim();
  if (patch.denominator_event !== undefined) update.denominator_event = patch.denominator_event?.trim() || null;
  if (patch.threshold_pct !== undefined) update.threshold_pct = patch.threshold_pct ?? null;
  if (patch.threshold_abs !== undefined) update.threshold_abs = patch.threshold_abs ?? null;
  if (patch.lookback_days !== undefined) update.lookback_days = patch.lookback_days;
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

// ─── Evaluation engine ────────────────────────────────────────────────────────
// Evaluates a single rule against the mixpanel_events table and (if the
// condition is met) fires a Slack notification. Returns a result object
// describing what was computed — used both by the scheduler and by the
// "Test now" button in the UI.

export type EvalResult = {
  fired: boolean;
  current: number;
  prior: number;
  pct_change: number;      // positive = rose, negative = fell
  message: string;
  error?: string;
};

async function countEvents(admin: ReturnType<typeof createAdminClient>, orgId: string, eventName: string, from: Date, to: Date): Promise<number> {
  const { count } = await admin
    .from("mixpanel_events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("event_name", eventName)
    .gte("event_time", from.toISOString())
    .lt("event_time", to.toISOString());
  return count ?? 0;
}

export async function evaluateRule(ruleId: string): Promise<EvalResult> {
  const orgId = await getOrgId();
  const admin = createAdminClient();

  // Fetch the rule
  const { data: rule, error: ruleErr } = await admin
    .from("alert_rules")
    .select("*")
    .eq("id", ruleId)
    .eq("organization_id", orgId)
    .single();
  if (ruleErr || !rule) return { fired: false, current: 0, prior: 0, pct_change: 0, message: "Rule not found", error: "Rule not found" };

  const r = rule as AlertRule;
  return _evaluateRuleData(admin, orgId, r);
}

// Internal: evaluate rule + optionally post to Slack. Called both from the
// public evaluateRule (for "Test now") and from evaluateAllRules (for scheduled runs).
async function _evaluateRuleData(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  rule: AlertRule,
  fireSlack = false
): Promise<EvalResult> {
  try {
    const now = new Date();
    const currentFrom = new Date(now.getTime() - rule.lookback_days * 86400_000);
    const priorFrom   = new Date(now.getTime() - rule.lookback_days * 2 * 86400_000);

    // Count events
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

    // Evaluate condition
    let fired = false;
    let reason = "";
    const thr = rule.threshold_pct ?? 0;
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
    }

    const metric = isRatio
      ? `${rule.numerator_event} / ${rule.denominator_event}`
      : rule.numerator_event;
    const message = fired
      ? `🚨 *Alert: ${rule.name}*\n>${metric}: ${current.toFixed(isRatio ? 1 : 0)}${unitLabel} now vs ${prior.toFixed(isRatio ? 1 : 0)}${unitLabel} prior period\n>${reason}`
      : `✅ *${rule.name}* — No action needed\n>${metric}: ${current.toFixed(isRatio ? 1 : 0)}${unitLabel} now vs ${prior.toFixed(isRatio ? 1 : 0)}${unitLabel} prior — ${reason}`;

    // Optionally fire Slack
    if (fired && fireSlack) {
      const { data: settings } = await admin
        .from("brand_settings")
        .select("slack_webhook")
        .eq("organization_id", orgId)
        .single();
      const webhookUrl = rule.slack_webhook_override || settings?.slack_webhook;
      if (webhookUrl) {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: message }),
        });
      }
    }

    // Persist result
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

// Called by the API route/cron to evaluate ALL enabled rules for an org.
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
      result: await _evaluateRuleData(admin, orgId, rule, true), // fire Slack when triggered
    }))
  );
  return results;
}

// ─── Available event names (for the rule form autocomplete) ───────────────────
export async function getAlertEventNames(): Promise<string[]> {
  try {
    const orgId = await getOrgId();
    const admin = createAdminClient();
    const { data } = await admin
      .from("mixpanel_events")
      .select("event_name")
      .eq("organization_id", orgId)
      .order("event_name");
    if (!data) return [];
    const names = [...new Set(data.map((r: { event_name: string }) => r.event_name))];
    return names.sort();
  } catch {
    return [];
  }
}
