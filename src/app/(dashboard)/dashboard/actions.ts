"use server";

import { createAdminClient, createServerClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

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
  ]);

  if (!sourceCount && !eventCount) {
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

  const prompt = `You are a business intelligence assistant. Analyse the following data snapshot from a company's Metrik dashboard and write a concise, sharp executive brief — 3 to 5 bullet points — covering:
1. What's looking good
2. What needs attention or action
3. One specific next step you recommend

Keep it direct and actionable. No fluff.

Each line must follow this exact structure so it can be parsed and displayed cleanly:
EMOJI|SHORT LABEL (3-5 words)|One sentence of detail.

Example line:
✅|Tracking foundation is solid|8 sources are connected and feeding clean data into your reports.

Do not use markdown (no **, no #, no -). Do not add headers or any text outside the EMOJI|LABEL|DETAIL lines.

DATA SNAPSHOT:
- Events tracked: ${eventCount ?? 0}
- Data sources: ${sourceCount ?? 0}
- Tracked metrics: ${metricCount ?? 0}
- Reports generated: ${reportCount ?? 0}

Connected sources:
${sourcesSummary || "None"}

Tracked metrics (raw event counters, not goals):
${metricsSummary || "None defined yet"}

Recent reports:
${reportsSummary || "None"}

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
