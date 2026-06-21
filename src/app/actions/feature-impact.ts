"use server";

import { createAdminClient } from "@/lib/supabase/server";
import type { FeatureSuggestion, FeatureMetric } from "@/types/database";

// ─────────────────────────────────────────────────────────────────────────────
// Feature Impact — does this feature actually move the metric it claims to,
// or is it just being used?
//
// "Tied to a goal" only ever meant: business_goal_id is set, and the feature's
// own events fire at all. That tells you adoption, not impact. This module
// computes two independent, honest signals instead:
//
//   1. Trend-break — take the feature's own KPI-type tracking item (the metric
//      it was supposed to move). Fit the pre-launch trend, extrapolate it
//      forward, and compare against what actually happened post-launch. This
//      answers "did the metric's trajectory bend beyond what it was already
//      doing?" It's correlational — other things can move in the same window
//      — but it's a real upgrade over "the event fired N times."
//
//   2. Adopter vs non-adopter — among users active since launch, compare the
//      KPI outcome rate between people who used the feature (fired its
//      "metric"-type adoption event) and people who didn't. Because both
//      groups lived through the same period, this controls for seasonality
//      and other launches much better than a pre/post comparison alone.
//      Also checks the guardrail item, if one exists, so a KPI win that comes
//      with a guardrail regression doesn't read as a clean positive.
//
// Both methods degrade gracefully to "insufficient data" rather than forcing
// a verdict off too little signal. Neither is a substitute for a real
// experiment — that caveat ships with every result.
// ─────────────────────────────────────────────────────────────────────────────

export type FeatureImpactStatus =
  | "not_launched"        // feature hasn't launched yet
  | "no_kpi_defined"       // no kpi/metric event_name to evaluate against
  | "too_early"            // launched too recently to have a post-launch window
  | "insufficient_data"    // not enough events/users to say anything
  | "computed";

export type FeatureImpactResult = {
  featureId: string;
  featureName: string;
  status: FeatureImpactStatus;
  verdict: "likely_positive" | "inconclusive" | "likely_negative" | null;
  trend: {
    kpiEventName: string;
    kpiLabel: string;
    preDays: number;
    postDays: number;
    preDailyAvg: number;
    predictedPostDailyAvg: number;
    actualPostDailyAvg: number;
    deltaPct: number;
  } | null;
  cohort: {
    adoptionEventName: string;
    kpiEventName: string;
    adopters: number;
    nonAdopters: number;
    adopterKpiRate: number;
    nonAdopterKpiRate: number;
    liftPct: number;
    guardrailEventName: string | null;
    adopterGuardrailRate: number | null;
    nonAdopterGuardrailRate: number | null;
    guardrailRegressed: boolean;
  } | null;
  caveat: string;
};

const STANDARD_CAVEAT =
  "Directional signal from observed usage data, not a controlled experiment — treat as evidence, not proof.";

function insufficient(featureId: string, featureName: string, status: FeatureImpactStatus): FeatureImpactResult {
  return { featureId, featureName, status, verdict: null, trend: null, cohort: null, caveat: STANDARD_CAVEAT };
}

// ── Least-squares linear fit over (0..n-1) index → value ──────────────────────
function linearFit(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  const xs = values.map((_, i) => i);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (values[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  return { slope, intercept };
}

// ── Bucket raw event timestamps into daily counts across a date range ─────────
function bucketDaily(timestamps: string[], startMs: number, days: number): number[] {
  const buckets = new Array(days).fill(0);
  const dayMs = 86400000;
  for (const ts of timestamps) {
    const idx = Math.floor((new Date(ts).getTime() - startMs) / dayMs);
    if (idx >= 0 && idx < days) buckets[idx]++;
  }
  return buckets;
}

export async function computeFeatureImpact(feature: FeatureMetric): Promise<FeatureImpactResult> {
  const admin = createAdminClient();
  const suggestions = (feature.suggestions ?? []) as FeatureSuggestion[];

  if (feature.launch_status !== "launched" || !feature.actual_launch_date) {
    return insufficient(feature.id, feature.feature_name, "not_launched");
  }

  // The KPI this feature is supposed to move belongs to the business goal,
  // not the feature — multiple features can target the same one. Resolve it
  // via target_kpi_id first. Older feature plans saved before that link
  // existed fall back to their own self-declared "kpi" suggestion.
  let kpiEventName: string | null = null;
  let kpiLabel: string | null = null;

  if (feature.target_kpi_id) {
    const { data: kpiMetric } = await admin
      .from("metrics")
      .select("event_name, name")
      .eq("id", feature.target_kpi_id)
      .single();
    if (kpiMetric) {
      kpiEventName = kpiMetric.event_name;
      kpiLabel = kpiMetric.name;
    }
  }
  if (!kpiEventName) {
    const kpiSuggestion = suggestions.find(s => s.type === "kpi" && s.event_name)
      ?? suggestions.find(s => s.type === "metric" && s.event_name);
    if (kpiSuggestion?.event_name) {
      kpiEventName = kpiSuggestion.event_name;
      kpiLabel = kpiSuggestion.name;
    }
  }
  if (!kpiEventName || !kpiLabel) {
    return insufficient(feature.id, feature.feature_name, "no_kpi_defined");
  }
  const adoptionSuggestion = suggestions.find(s => s.type === "metric" && s.event_name && s.event_name !== kpiEventName);
  const guardrailSuggestion = suggestions.find(s => s.type === "guardrail" && s.event_name);

  const launchMs = new Date(feature.actual_launch_date).getTime();
  const nowMs = Date.now();
  const daysSinceLaunch = Math.floor((nowMs - launchMs) / 86400000);

  if (daysSinceLaunch < 7) {
    return insufficient(feature.id, feature.feature_name, "too_early");
  }

  const result: FeatureImpactResult = {
    featureId: feature.id,
    featureName: feature.feature_name,
    status: "computed",
    verdict: null,
    trend: null,
    cohort: null,
    caveat: STANDARD_CAVEAT,
  };

  // ── Method 1: trend-break on the KPI event ──────────────────────────────────
  try {
    const N = Math.min(28, daysSinceLaunch);
    const preStartMs = launchMs - N * 86400000;
    const postEndMs = Math.min(launchMs + N * 86400000, nowMs);
    const postDays = Math.floor((postEndMs - launchMs) / 86400000);

    if (N >= 5 && postDays >= 5) {
      const { data: preRows } = await admin
        .from("events")
        .select("timestamp")
        .eq("organization_id", feature.organization_id)
        .eq("name", kpiEventName)
        .gte("timestamp", new Date(preStartMs).toISOString())
        .lt("timestamp", new Date(launchMs).toISOString())
        .limit(50000);

      const { data: postRows } = await admin
        .from("events")
        .select("timestamp")
        .eq("organization_id", feature.organization_id)
        .eq("name", kpiEventName)
        .gte("timestamp", new Date(launchMs).toISOString())
        .lt("timestamp", new Date(postEndMs).toISOString())
        .limit(50000);

      const preDaily = bucketDaily((preRows ?? []).map(r => r.timestamp), preStartMs, N);
      const postDaily = bucketDaily((postRows ?? []).map(r => r.timestamp), launchMs, postDays);

      const { slope, intercept } = linearFit(preDaily);
      const predictedPost = postDaily.map((_, i) => Math.max(0, slope * (N + i) + intercept));

      const preDailyAvg = preDaily.reduce((a, b) => a + b, 0) / N;
      const actualPostDailyAvg = postDaily.reduce((a, b) => a + b, 0) / postDays;
      const predictedPostDailyAvg = predictedPost.reduce((a, b) => a + b, 0) / postDays;

      const deltaPct = predictedPostDailyAvg > 0.01
        ? ((actualPostDailyAvg - predictedPostDailyAvg) / predictedPostDailyAvg) * 100
        : (actualPostDailyAvg > 0.01 ? 100 : 0);

      result.trend = {
        kpiEventName,
        kpiLabel,
        preDays: N,
        postDays,
        preDailyAvg: Math.round(preDailyAvg * 100) / 100,
        predictedPostDailyAvg: Math.round(predictedPostDailyAvg * 100) / 100,
        actualPostDailyAvg: Math.round(actualPostDailyAvg * 100) / 100,
        deltaPct: Math.round(deltaPct * 10) / 10,
      };
    }
  } catch (err) {
    console.warn("[computeFeatureImpact] trend method failed:", err);
  }

  // ── Method 2: adopters vs non-adopters cohort comparison ───────────────────
  try {
    if (adoptionSuggestion?.event_name) {
      const windowDays = Math.min(60, daysSinceLaunch);
      const windowStartIso = new Date(launchMs).toISOString();
      const windowEndIso = new Date(Math.min(launchMs + windowDays * 86400000, nowMs)).toISOString();

      const [{ data: adoptionRows }, { data: kpiRows }, { data: activeRows }, guardrailQuery] = await Promise.all([
        admin.from("events").select("user_id")
          .eq("organization_id", feature.organization_id).eq("name", adoptionSuggestion.event_name)
          .gte("timestamp", windowStartIso).lt("timestamp", windowEndIso).not("user_id", "is", null).limit(50000),
        admin.from("events").select("user_id")
          .eq("organization_id", feature.organization_id).eq("name", kpiEventName)
          .gte("timestamp", windowStartIso).lt("timestamp", windowEndIso).not("user_id", "is", null).limit(50000),
        admin.from("events").select("user_id")
          .eq("organization_id", feature.organization_id)
          .gte("timestamp", windowStartIso).lt("timestamp", windowEndIso).not("user_id", "is", null).limit(50000),
        guardrailSuggestion?.event_name
          ? admin.from("events").select("user_id")
              .eq("organization_id", feature.organization_id).eq("name", guardrailSuggestion.event_name)
              .gte("timestamp", windowStartIso).lt("timestamp", windowEndIso).not("user_id", "is", null).limit(50000)
          : Promise.resolve({ data: null }),
      ]);

      const adopters = new Set((adoptionRows ?? []).map(r => r.user_id as string));
      const kpiHitters = new Set((kpiRows ?? []).map(r => r.user_id as string));
      const allActive = new Set((activeRows ?? []).map(r => r.user_id as string));
      const nonAdopters = new Set([...allActive].filter(u => !adopters.has(u)));

      if (adopters.size >= 10 && nonAdopters.size >= 10) {
        const adopterKpiHits = [...adopters].filter(u => kpiHitters.has(u)).length;
        const nonAdopterKpiHits = [...nonAdopters].filter(u => kpiHitters.has(u)).length;
        const adopterKpiRate = (adopterKpiHits / adopters.size) * 100;
        const nonAdopterKpiRate = (nonAdopterKpiHits / nonAdopters.size) * 100;
        const liftPct = nonAdopterKpiRate > 0.01
          ? ((adopterKpiRate - nonAdopterKpiRate) / nonAdopterKpiRate) * 100
          : (adopterKpiRate > 0.01 ? 100 : 0);

        let adopterGuardrailRate: number | null = null;
        let nonAdopterGuardrailRate: number | null = null;
        let guardrailRegressed = false;
        if (guardrailSuggestion?.event_name && guardrailQuery.data) {
          const guardrailHitters = new Set((guardrailQuery.data ?? []).map((r: { user_id: string | null }) => r.user_id as string));
          const adopterGuardrailHits = [...adopters].filter(u => guardrailHitters.has(u)).length;
          const nonAdopterGuardrailHits = [...nonAdopters].filter(u => guardrailHitters.has(u)).length;
          adopterGuardrailRate = (adopterGuardrailHits / adopters.size) * 100;
          nonAdopterGuardrailRate = (nonAdopterGuardrailHits / nonAdopters.size) * 100;
          // Guardrails track things that should NOT get worse — flag if adopters trip it
          // meaningfully more often than non-adopters.
          guardrailRegressed = nonAdopterGuardrailRate < 0.01
            ? adopterGuardrailRate > 5
            : adopterGuardrailRate > nonAdopterGuardrailRate * 1.2 && (adopterGuardrailRate - nonAdopterGuardrailRate) > 3;
        }

        result.cohort = {
          adoptionEventName: adoptionSuggestion.event_name,
          kpiEventName,
          adopters: adopters.size,
          nonAdopters: nonAdopters.size,
          adopterKpiRate: Math.round(adopterKpiRate * 10) / 10,
          nonAdopterKpiRate: Math.round(nonAdopterKpiRate * 10) / 10,
          liftPct: Math.round(liftPct * 10) / 10,
          guardrailEventName: guardrailSuggestion?.event_name ?? null,
          adopterGuardrailRate: adopterGuardrailRate !== null ? Math.round(adopterGuardrailRate * 10) / 10 : null,
          nonAdopterGuardrailRate: nonAdopterGuardrailRate !== null ? Math.round(nonAdopterGuardrailRate * 10) / 10 : null,
          guardrailRegressed,
        };
      }
    }
  } catch (err) {
    console.warn("[computeFeatureImpact] cohort method failed:", err);
  }

  if (!result.trend && !result.cohort) {
    result.status = "insufficient_data";
    return result;
  }

  // ── Combine into a single verdict — cohort comparison wins when available,
  //    since it controls for confounders better than pre/post alone ──────────
  if (result.cohort) {
    const { liftPct, guardrailRegressed } = result.cohort;
    if (guardrailRegressed) result.verdict = "likely_negative";
    else if (liftPct >= 15) result.verdict = "likely_positive";
    else if (liftPct <= -15) result.verdict = "likely_negative";
    else result.verdict = "inconclusive";
  } else if (result.trend) {
    const { deltaPct } = result.trend;
    if (deltaPct >= 15) result.verdict = "likely_positive";
    else if (deltaPct <= -15) result.verdict = "likely_negative";
    else result.verdict = "inconclusive";
  }

  return result;
}

// ─── Batch compute for all launched, goal-linked features in an org ───────────

export async function getFeatureImpactSummaries(orgId: string): Promise<FeatureImpactResult[]> {
  const admin = createAdminClient();
  const { data: features } = await admin
    .from("feature_metrics")
    .select("*")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .eq("launch_status", "launched");

  if (!features?.length) return [];

  const results = await Promise.all(features.map(f => computeFeatureImpact(f as FeatureMetric)));
  return results;
}
