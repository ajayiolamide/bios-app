"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient, createServerClient } from "@/lib/supabase/server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Build a rich data context for the AI to reason over
async function buildContext(orgId: string): Promise<string> {
  const admin = createAdminClient();

  const since = new Date();
  since.setDate(since.getDate() - 29);
  since.setHours(0, 0, 0, 0);

  // Fetch everything in parallel
  const [
    { data: events },
    { data: metrics },
    { data: funnels },
    { data: sources },
  ] = await Promise.all([
    // Exclude only Sync Event Names' name-only placeholder rows — real
    // Mixpanel occurrences from Pull Mixpanel Data share the source tag but
    // aren't placeholders, so they count as real activity for the AI Analyst.
    admin.from("events").select("name, user_id, timestamp, properties").eq("organization_id", orgId).gte("timestamp", since.toISOString()).or("properties->>is_placeholder.is.null,properties->>is_placeholder.neq.true").limit(5000),
    admin.from("metrics").select("name, event_name, aggregation").eq("organization_id", orgId),
    admin.from("funnels").select("name, steps").eq("organization_id", orgId),
    admin.from("report_sources").select("name, cached_data, last_fetched_at").eq("organization_id", orgId).limit(10),
  ]);

  const sections: string[] = [];

  // ── Connected sources (Google Sheets) ────────────────────────────────────────
  if (sources?.length) {
    const sourceParts: string[] = [];
    for (const src of sources) {
      const rows = (src.cached_data as Record<string, string>[] | null) ?? [];
      if (!rows.length) continue;
      const headers = Object.keys(rows[0]);
      // Include up to 50 rows as a compact table so the AI can actually reason over values
      const sampleRows = rows.slice(0, 50);
      const table = [
        headers.join(" | "),
        headers.map(() => "---").join(" | "),
        ...sampleRows.map(r => headers.map(h => r[h] ?? "").join(" | ")),
      ].join("\n");
      const omitted = rows.length > 50 ? `\n  ... (${rows.length - 50} more rows not shown)` : "";
      sourceParts.push(`### Source: "${src.name}" (${rows.length} rows total, last synced ${src.last_fetched_at ? new Date(src.last_fetched_at).toLocaleDateString() : "never"})\nColumns: ${headers.join(", ")}\n\n${table}${omitted}`);
    }
    if (sourceParts.length) {
      sections.push("## CONNECTED DATA SOURCES\n" + sourceParts.join("\n\n"));
    }
  }

  // ── Event stream ─────────────────────────────────────────────────────────────
  if (events?.length) {
    const countByName: Record<string, number> = {};
    const uniqueUsers = new Set<string>();
    const dailyCounts: Record<string, number> = {};

    for (const ev of events) {
      countByName[ev.name] = (countByName[ev.name] ?? 0) + 1;
      if (ev.user_id) uniqueUsers.add(ev.user_id);
      const day = (ev.timestamp as string).slice(0, 10);
      dailyCounts[day] = (dailyCounts[day] ?? 0) + 1;
    }

    const topEvents = Object.entries(countByName)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15)
      .map(([name, count]) => `  - ${name}: ${count}`)
      .join("\n");

    const dailySummary = Object.entries(dailyCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, count]) => `  - ${date}: ${count}`)
      .join("\n");

    sections.push(`## EVENT STREAM (last 30 days)
Total events: ${events.length}
Unique users: ${uniqueUsers.size}

Top events by volume:
${topEvents}

Daily volumes (last 14 days):
${dailySummary}`);
  } else {
    sections.push("## EVENT STREAM\nNo events in the last 30 days.");
  }

  // ── Metrics & funnels ─────────────────────────────────────────────────────────
  const metricsSummary = metrics?.length
    ? metrics.map((m) => `  - ${m.name}: ${m.aggregation} of "${m.event_name}"`).join("\n")
    : "  None defined.";

  const funnelsSummary = funnels?.length
    ? funnels.map((f) => {
        const steps = (f.steps as { event_name: string }[]).map((s) => s.event_name).join(" → ");
        return `  - ${f.name}: ${steps}`;
      }).join("\n")
    : "  None defined.";

  sections.push(`## GOALS & KPIS\n${metricsSummary}\n\n## USER JOURNEYS (FUNNELS)\n${funnelsSummary}`);

  return sections.join("\n\n");
}

export type Message = { role: "user" | "assistant"; content: string };

export async function askAnalyst(
  orgId: string,
  messages: Message[]
): Promise<ReadableStream<string>> {
  // Verify auth
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const context = await buildContext(orgId);

  const systemPrompt = `You are Metrik AI — the Head of Growth embedded in this team's data platform. You think like a growth lead, not a report generator.

Every answer you give should connect data to outcomes. When a metric moves, your first question is "so what does this mean for growth?" When something is flat, you ask why it's stuck. When something is up, you ask whether it's real traction or noise.

Your operating framework: Acquisition → Activation → Retention → Revenue → Referral. Every number lives somewhere on that spectrum. Say where.

Rules:
- Ground everything in the actual numbers provided. Never invent data.
- Be direct. Skip preamble. If the answer is uncomfortable, say it plainly.
- Jargon ban: no "leverage", "synergies", "stakeholders", "deep-dive", "actionable insights", "going forward", "utilize".
- Short sentences. If you've written more than 20 words in a row, cut it.
- When data is missing, say what you'd need to get the real answer — don't hedge.
- Give one clear recommendation per question, not a list of maybes.

---

${context}

---

Format in markdown. **Bold** key numbers. Keep it tight.`;

  const stream = await anthropic.messages.stream({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  return new ReadableStream<string>({
    async start(controller) {
      for await (const chunk of stream) {
        if (
          chunk.type === "content_block_delta" &&
          chunk.delta.type === "text_delta"
        ) {
          controller.enqueue(chunk.delta.text);
        }
      }
      controller.close();
    },
  });
}

// ── Conversation history ─────────────────────────────────────────────────────
// Previously the chat lived only in React state — a refresh or a navigation
// away threw the whole conversation away. These actions let the page save a
// conversation as it goes and let the user come back to any past one.

export type ConversationSummary = {
  id: string;
  title: string;
  updated_at: string;
  message_count: number;
};

function deriveTitle(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "New conversation";
  const text = firstUser.content.trim().replace(/\s+/g, " ");
  return text.length > 60 ? text.slice(0, 57) + "…" : text;
}

export async function listConversations(orgId: string): Promise<ConversationSummary[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("id, title, updated_at, messages")
    .eq("organization_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    title: row.title,
    updated_at: row.updated_at,
    message_count: Array.isArray(row.messages) ? row.messages.length : 0,
  }));
}

export async function getConversation(
  id: string
): Promise<{ id: string; title: string; messages: Message[] } | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("id, title, messages")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return { id: data.id, title: data.title, messages: (data.messages as Message[]) ?? [] };
}

// Called after each assistant reply finishes streaming. `conversationId` is
// null for a brand-new chat (a row gets created and its id handed back so
// the page can keep saving into the same row), otherwise it's an update.
export async function saveConversation(
  orgId: string,
  conversationId: string | null,
  messages: Message[]
): Promise<{ id: string } | { error: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  if (!conversationId) {
    const { data, error } = await supabase
      .from("ai_conversations")
      .insert({
        organization_id: orgId,
        created_by: user.id,
        title: deriveTitle(messages),
        messages,
      })
      .select("id")
      .single();
    if (error || !data) return { error: error?.message ?? "Could not save conversation" };
    return { id: data.id };
  }

  const { error } = await supabase
    .from("ai_conversations")
    .update({ messages, updated_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (error) return { error: error.message };
  return { id: conversationId };
}

export async function deleteConversation(id: string): Promise<{ error?: string }> {
  const supabase = await createServerClient();
  const { error } = await supabase.from("ai_conversations").delete().eq("id", id);
  if (error) return { error: error.message };
  return {};
}
