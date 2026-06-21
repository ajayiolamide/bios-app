"use server";

import { createAdminClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function getQuickInsight(orgId: string): Promise<{ insight?: string; error?: string }> {
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
  const sourcesSummary = (sources ?? []).map(s => {
    const rows = (s.cached_data as Record<string, string>[] | null) ?? [];
    const headers = rows.length ? Object.keys(rows[0]).slice(0, 6).join(", ") : "no data";
    return `- ${s.name}: ${rows.length} rows, columns: ${headers}`;
  }).join("\n");

  const metricsSummary = (metrics ?? []).map(m =>
    `- ${m.name} (tracks: ${m.event_name}, method: ${m.aggregation})`
  ).join("\n");

  const reportsSummary = (recentReports ?? []).map(r =>
    `- ${r.template_name} (${r.period})`
  ).join("\n");

  const prompt = `You are a business intelligence assistant. Analyse the following data snapshot from a company's BIOS (Business Intelligence OS) dashboard and write a concise, sharp executive brief — 3 to 5 bullet points — covering:
1. What's looking good
2. What needs attention or action
3. One specific next step you recommend

Keep it direct and actionable. No fluff.

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

Write bullet points starting with a relevant emoji (✅ ⚠️ 🎯 📊 💡 etc). No headers.`;

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const text = (msg.content[0] as { type: string; text: string }).text ?? "";
    return { insight: text.trim() };
  } catch (err) {
    console.error("AI brief error:", err);
    return { error: "AI brief failed. Check your Anthropic API key." };
  }
}
