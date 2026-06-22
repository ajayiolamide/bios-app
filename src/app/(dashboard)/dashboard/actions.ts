"use server";

import { createAdminClient, createServerClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { getGoalProgress } from "@/app/actions/metrics";
import { getFeatureImpactSummaries } from "@/app/actions/feature-impact";
import { getWeeklyActiveUsers } from "@/app/actions/cohorts";
import type { BusinessGoal } from "@/types/database";

const client = new Anthropic();

export type BusinessBrief = { id: string; content: string; created_at: string };

// Past briefs, newest first — backs the "history" view on the dashboard card.
export async function getBusinessBriefHistory(orgId: string, limit = 10): Promise<BusinessBrief[]> {
  if (!orgId) return [];
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("ai_business_briefs")
    .select("id, content, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data;
}

// The most recent brief, if one exists — shown on first load instead of
// forcing a fresh AI call every time the dashboard is opened.
export async function getLatestBusinessBrief(orgId: string): Promise<BusinessBrief | null> {
  const history = await getBusinessBriefHistory(orgId, 1);
  return history[0] ?? null;
}

export async function getQuickInsight(orgId: string): Promise<{ insight?: string; createdAt?: string; error?: string }> {
  if (!orgId) return { error: "No organisation found." };

  const admin = createAdminClient();

  // Fetch context in parallel
  const [
    { count: eventCount },
    { count: sourceCount },
    { count: metricCount },
    { count: reportCount },
    { data: sources },
    { data: metrics },
    { data: recentReports },
    { data: goals },
    featureImpact,
    wau,
  ] = await Promise.all([
    admin.from("events").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
    admin.from("report_sources").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
    admin.from("metrics").select("*", { count: "exact", head: true }).eq("organization_id", orgId),
    admin.from("reports").select("*", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "done"),
    admin.from("report_sources")
      .select("name, last_fetched_at, cached_data")
      .eq("organization_id", orgId)
      .limit(5),
    admin.from("metrics")
      .select("name, event_name, aggregation")
      .eq("organization_id", orgId)
      .limit(8),
    admin.from("reports")
      .select("template_name, period, created_at")
      .eq("organization_id", orgId)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(3),
    // Goals + their real progress (same computation as the Goals page and
    // Reports use) — see the prompt rewrite below for why this needed to
    // become the LEAD data instead of an afterthought.
    admin.from("business_goals").select("*").eq("organization_id", orgId).neq("status", "dropped").order("created_at", { ascending: false }).limit(20),
    getFeatureImpactSummaries(orgId).catch(() => []),
    getWeeklyActiveUsers(orgId, 8).catch(() => []),
  ]);
  const goalProgress = goals?.length ? await getGoalProgress(orgId) : {};

  // A goals-only org (no sources/events connected yet) still has a real
  // brief worth writing — refusing here just because infrastructure is
  // empty would contradict the whole point of leading with goals over it.
  if (!sourceCount && !eventCount && !goals?.length) {
    return { error: "No data connected yet. Add a source first, then generate your brief." };
  }

  // Build a concise data summary for the AI
  //
  // Explicit shape here because Supabase's generated query types can
  // collapse to `never` for this select on certain TypeScript versions —
  // `next dev` doesn't full-project type-check so it never surfaced
  // locally, but Vercel's production build does. This annotation matches
  // exactly what the .select() above actually returns; no behavior change.
  type SourceRow = { name: string; last_fetched_at: string | null; cached_data: unknown };
  const sourcesSummary = ((sources ?? []) as SourceRow[]).map(s => {
    const rows = (s.cached_data as Record<string, string>[] | null) ?? [];
    const headers = rows.length ? Object.keys(rows[0]).slice(0, 6).join(", ") : "no data";
    return `- ${s.name}: ${rows.length} rows, columns: ${headers}`;
  }).join("\n");

  // Same `never[]` inference issue as sources above, for these two queries.
  type MetricRow = { name: string; event_name: string | null; aggregation: string };
  const metricsSummary = ((metrics ?? []) as MetricRow[]).map(m =>
    `- ${m.name} (tracks: ${m.event_name}, method: ${m.aggregation})`
  ).join("\n");

  type ReportRow = { template_name: string; period: string };
  const reportsSummary = ((recentReports ?? []) as ReportRow[]).map(r =>
    `- ${r.template_name} (${r.period})`
  ).join("\n");

  // Business Goals + their real progress — THE primary signal for this
  // brief. Previously the only data here was raw infrastructure counts
  // (events/sources/metrics/reports), so the AI had nothing else to talk
  // about and every brief read as "N events tracked, N sources connected"
  // instead of actual business health. Goals and Feature Impact below are
  // now the lead content; infrastructure counts are demoted to one footer
  // line for context only.
  const goalsSummary = ((goals ?? []) as BusinessGoal[]).map((g) => {
    const gp = goalProgress[g.id];
    const progress = gp?.progressRatio != null
      ? `${Math.round(gp.progressRatio * 100)}% of target`
      : "not yet measurable (no KPI with a numeric target attached)";
    return `- [${(g.status ?? "active").toUpperCase()}] ${g.title} (${g.type}): ${progress}`;
  }).join("\n");

  const featureImpactSummary = featureImpact
    .filter((fi) => fi.status === "computed")
    .map((fi) => {
      if (fi.cohort) return `- ${fi.featureName}: ${fi.verdict} — adopters hit their KPI at ${fi.cohort.adopterKpiRate}% vs ${fi.cohort.nonAdopterKpiRate}% for non-adopters`;
      if (fi.trend) return `- ${fi.featureName}: ${fi.verdict} — ${fi.trend.deltaPct >= 0 ? "+" : ""}${fi.trend.deltaPct}% vs predicted trend`;
      return `- ${fi.featureName}: ${fi.verdict}`;
    }).join("\n");

  // Weekly active users — a real cohort/engagement signal, computed
  // server-side from actual event data. Saved cohorts from Cohort Builder
  // can't be included here (they only ever live in that browser's local
  // storage, never the database), so this is the closest genuine
  // engagement/retention proxy available without that bigger change.
  let engagementSummary = "Not enough event history yet";
  if (wau.length >= 2) {
    const last = wau[wau.length - 1];
    const prev = wau[wau.length - 2];
    const pctChange = prev.users > 0 ? Math.round(((last.users - prev.users) / prev.users) * 1000) / 10 : null;
    engagementSummary = `- Weekly active users: ${last.users} this week${pctChange != null ? ` (${pctChange >= 0 ? "+" : ""}${pctChange}% vs last week)` : ""}`;
  } else if (wau.length === 1) {
    engagementSummary = `- Weekly active users: ${wau[0].users} (only 1 week of history so far, no trend yet)`;
  }

  const prompt = `You are a business intelligence assistant writing an executive brief for a company's Metrik dashboard.

PRIORITY ORDER — this matters: lead with Business Goals progress, Feature Impact verdicts, and the user engagement trend below. Those are the real business signal. Raw infrastructure counts (events tracked, sources connected, reports generated) are supporting context ONLY — never make one of your 3-5 bullets just "X events are being tracked" or "N sources are connected" unless something there is genuinely broken (e.g. tracking has stopped entirely). If goals, feature impact, or engagement data exists, at least 2 of your bullets must be about THAT, not about infrastructure.

Write 3 to 5 bullet points covering:
1. What's looking good (goal progress, feature wins — not infrastructure health)
2. What needs attention or action (goals off track, features with poor impact, or — only if truly nothing else exists — data gaps)
3. One specific next step you recommend

Keep it direct and actionable. No fluff.

Each line must follow this exact structure so it can be parsed and displayed cleanly:
EMOJI|SHORT LABEL (3-5 words)|One sentence of detail.

Example line:
✅|Signups goal ahead of pace|Currently at 78% of target with 6 weeks left in the quarter.

Do not use markdown (no **, no #, no -). Do not add headers or any text outside the EMOJI|LABEL|DETAIL lines.

BUSINESS GOALS (${goals?.length ?? 0} — the main story, lead with this):
${goalsSummary || "None created yet — if this is the only major gap, it's fine to recommend adding one."}

FEATURE IMPACT (measured adoption-vs-KPI evidence, not speculation):
${featureImpactSummary || "None computed yet"}

USER ENGAGEMENT (cohort/retention signal):
${engagementSummary}

Recent reports:
${reportsSummary || "None"}

Infrastructure (context only — do not lead a bullet with this unless something is actually broken):
${eventCount ?? 0} events tracked across ${sourceCount ?? 0} sources, ${metricCount ?? 0} KPIs/metrics defined, ${reportCount ?? 0} reports generated.
${sourcesSummary || "No sources connected"}
${metricsSummary ? `Defined metrics:\n${metricsSummary}` : ""}

Output 3 to 5 lines in the EMOJI|LABEL|DETAIL format above. Nothing else.`;

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const text = (msg.content[0] as { type: string; text: string }).text ?? "";
    const insight = text.trim();

    // Persist so the card has real history with real dates instead of
    // disappearing the moment the page refreshes. Best-effort — a save
    // failure shouldn't block showing the brief the user just paid for.
    let createdAt = new Date().toISOString();
    try {
      const supabase = await createServerClient();
      const { data: { user } } = await supabase.auth.getUser();
      const { data: saved } = await admin
        .from("ai_business_briefs")
        .insert({ organization_id: orgId, created_by: user?.id ?? null, content: insight })
        .select("created_at")
        .single();
      if (saved?.created_at) createdAt = saved.created_at;
    } catch (saveErr) {
      console.error("Failed to save AI brief history:", saveErr);
    }

    return { insight, createdAt };
  } catch (err) {
    console.error("AI brief error:", err);
    return { error: "AI brief failed. Check your Anthropic API key." };
  }
}
