"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { getFeatureImpactSummaries, type FeatureImpactResult } from "./feature-impact";
import type { BusinessGoal } from "@/types/database";

export type RecentReport = {
  id: string;
  template_name: string;
  period: string;
  status: string;
  created_at: string;
  file_url: string | null;
};

export type DashboardData = {
  goals: BusinessGoal[];
  activeGoals: BusinessGoal[];
  achievedGoals: BusinessGoal[];
  missedGoals: BusinessGoal[];
  noFeatureGoals: BusinessGoal[];
  linkedNoDataGoals: BusinessGoal[];
  trackingGoals: BusinessGoal[];
  atRiskGoals: BusinessGoal[];
  attentionGoals: BusinessGoal[];
  featuresByGoal: Record<string, number>;

  eventCount: number;
  eventCount7d: number;
  featureCount: number;

  recentReports: RecentReport[];
  doneReports: number;

  featureImpactSummaries: FeatureImpactResult[];
  positiveImpact: number;
  inconclusiveImpact: number;
  negativeImpact: number;
  unmeasurableImpact: number;
  negativeImpactFeatures: FeatureImpactResult[];
};

// This used to live inline in a server component that independently guessed
// the org via `.single()` on organization_members — which silently breaks
// (returns null) the moment a user belongs to more than one org, since
// .single() errors on anything other than exactly one row. That guess also
// had no relationship to whichever org is actually selected in the sidebar
// (that selection lives in localStorage, client-side only). The result: the
// dashboard could query a different org than every other page, or query none
// at all, and just show zeros — looking "stuck" even when there's real data.
// Taking orgId as a parameter from the same client-side selection every other
// page already uses fixes that at the source.
export async function getDashboardData(orgId: string): Promise<DashboardData> {
  const admin = createAdminClient();

  const [
    { data: allGoals },
    { data: allFeatures },
    { count: eventCount },
    { count: eventCount7d },
    { count: featureCount },
    { data: recentReports },
    featureImpactSummaries,
  ] = await Promise.all([
    admin.from("business_goals")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
    admin.from("feature_metrics")
      .select("id, business_goal_id, suggestions, status")
      .eq("organization_id", orgId)
      .eq("status", "active"),
    admin.from("events")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId),
    admin.from("events")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("timestamp", new Date(Date.now() - 7 * 86400e3).toISOString()),
    admin.from("feature_metrics")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "active"),
    admin.from("reports")
      .select("id, template_name, period, status, created_at, file_url")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(4),
    getFeatureImpactSummaries(orgId),
  ]);

  const positiveImpact = featureImpactSummaries.filter(s => s.verdict === "likely_positive").length;
  const inconclusiveImpact = featureImpactSummaries.filter(s => s.verdict === "inconclusive").length;
  const negativeImpact = featureImpactSummaries.filter(s => s.verdict === "likely_negative").length;
  const unmeasurableImpact = featureImpactSummaries.length - positiveImpact - inconclusiveImpact - negativeImpact;
  const negativeImpactFeatures = featureImpactSummaries.filter(s => s.verdict === "likely_negative").slice(0, 3);

  const goals = (allGoals ?? []) as BusinessGoal[];
  const activeGoals = goals.filter(g => g.status === "active");
  const achievedGoals = goals.filter(g => g.status === "achieved");
  const missedGoals = goals.filter(g => g.status === "missed");

  const featuresByGoal: Record<string, number> = {};
  const eventNamesByGoal: Record<string, Set<string>> = {};
  for (const f of (allFeatures ?? [])) {
    const gid = f.business_goal_id as string | null;
    if (!gid) continue;
    featuresByGoal[gid] = (featuresByGoal[gid] ?? 0) + 1;
    if (!eventNamesByGoal[gid]) eventNamesByGoal[gid] = new Set();
    const sug = (f.suggestions ?? []) as { event_name?: string }[];
    sug.forEach(s => s.event_name && eventNamesByGoal[gid].add(s.event_name));
  }

  const noFeatureGoals = activeGoals.filter(g => !featuresByGoal[g.id]);
  const linkedNoDataGoals = activeGoals.filter(g => !!featuresByGoal[g.id] && (eventNamesByGoal[g.id]?.size ?? 0) === 0);
  const trackingGoals = activeGoals.filter(g => !!featuresByGoal[g.id] && (eventNamesByGoal[g.id]?.size ?? 0) > 0);
  const atRiskGoals = activeGoals.filter(g => !trackingGoals.includes(g));
  const attentionGoals = atRiskGoals.slice(0, 5);

  const doneReports = (recentReports ?? []).filter(r => r.status === "done").length;

  return {
    goals,
    activeGoals,
    achievedGoals,
    missedGoals,
    noFeatureGoals,
    linkedNoDataGoals,
    trackingGoals,
    atRiskGoals,
    attentionGoals,
    featuresByGoal,
    eventCount: eventCount ?? 0,
    eventCount7d: eventCount7d ?? 0,
    featureCount: featureCount ?? 0,
    recentReports: (recentReports ?? []) as RecentReport[],
    doneReports,
    featureImpactSummaries,
    positiveImpact,
    inconclusiveImpact,
    negativeImpact,
    unmeasurableImpact,
    negativeImpactFeatures,
  };
}
