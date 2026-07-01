"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/server";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type TrendDirection = "up" | "down" | "flat";

export type EventTrend = {
  event_name: string;
  this_week: number;
  last_week: number;
  change_pct: number;
  direction: TrendDirection;
};

export type InsightsData = {
  total_events_today: number;
  total_events_this_week: number;
  unique_users_this_week: number;
  top_event: string | null;
  trends: EventTrend[];
  anomalies: EventTrend[]; // biggest movers
  summary: string; // AI-generated narrative
  generated_at: string;
};

export async function generateInsights(orgId: string): Promise<InsightsData> {
  const admin = createAdminClient();

  const now = new Date();

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(now.getDate() - 6);
  thisWeekStart.setHours(0, 0, 0, 0);

  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  // Fetch last 14 days of events
  const { data: events } = await admin
    .from("events")
    .select("name, user_id, timestamp")
    .eq("organization_id", orgId)
    .gte("timestamp", lastWeekStart.toISOString())
    // Exclude only Sync Event Names' name-only placeholder rows — real
    // Mixpanel occurrences from Pull Mixpanel Data share the source tag but
    // aren't placeholders, so they should count as real activity here too.
    .or("properties->>is_placeholder.is.null,properties->>is_placeholder.neq.true");

  if (!events || events.length === 0) {
    return {
      total_events_today: 0,
      total_events_this_week: 0,
      unique_users_this_week: 0,
      top_event: null,
      trends: [],
      anomalies: [],
      summary: "No events found. Import some events to start seeing insights.",
      generated_at: now.toISOString(),
    };
  }

  // Split into time buckets
  const thisWeekEvents = events.filter((e) => e.timestamp >= thisWeekStart.toISOString());
  const lastWeekEvents = events.filter(
    (e) =>
      e.timestamp >= lastWeekStart.toISOString() &&
      e.timestamp < thisWeekStart.toISOString()
  );
  const todayEvents = events.filter((e) => e.timestamp >= todayStart.toISOString());

  // Aggregations
  const total_events_today = todayEvents.length;
  const total_events_this_week = thisWeekEvents.length;
  const unique_users_this_week = new Set(
    thisWeekEvents.map((e) => e.user_id).filter(Boolean)
  ).size;

  // Per-event counts
  const thisWeekByName: Record<string, number> = {};
  const lastWeekByName: Record<string, number> = {};

  for (const ev of thisWeekEvents) {
    thisWeekByName[ev.name] = (thisWeekByName[ev.name] ?? 0) + 1;
  }
  for (const ev of lastWeekEvents) {
    lastWeekByName[ev.name] = (lastWeekByName[ev.name] ?? 0) + 1;
  }

  const allEventNames = new Set([
    ...Object.keys(thisWeekByName),
    ...Object.keys(lastWeekByName),
  ]);

  const trends: EventTrend[] = [];
  for (const name of allEventNames) {
    const thisW = thisWeekByName[name] ?? 0;
    const lastW = lastWeekByName[name] ?? 0;
    const change_pct =
      lastW === 0
        ? thisW > 0 ? 100 : 0
        : Math.round(((thisW - lastW) / lastW) * 100);
    const direction: TrendDirection =
      change_pct > 5 ? "up" : change_pct < -5 ? "down" : "flat";

    trends.push({ event_name: name, this_week: thisW, last_week: lastW, change_pct, direction });
  }

  trends.sort((a, b) => b.this_week - a.this_week);

  const top_event = trends[0]?.event_name ?? null;

  // Anomalies = biggest absolute % movers (min 5 events this week)
  const anomalies = [...trends]
    .filter((t) => t.this_week >= 3 || t.last_week >= 3)
    .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))
    .slice(0, 4);

  // AI narrative
  const dataBlurb = `
Organization data (last 7 days vs previous 7 days):
- Total events this week: ${total_events_this_week} (today: ${total_events_today})
- Unique users this week: ${unique_users_this_week}
- Top events this week: ${trends.slice(0, 5).map((t) => `${t.event_name} (${t.this_week})`).join(", ")}
- Biggest changes: ${anomalies.map((t) => `${t.event_name} ${t.change_pct > 0 ? "+" : ""}${t.change_pct}%`).join(", ")}
`.trim();

  let summary = "";
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `You are the Head of Growth reviewing this week's numbers. Write 2-3 sentences for the team — plain English, specific numbers, growth lens. What's the headline? What moved and why does it matter for the business? If something is down, say it plainly and what it likely means. No filler, no "it is worth noting", no "stakeholders".\n\n${dataBlurb}`,
        },
      ],
    });
    summary = msg.content[0].type === "text" ? msg.content[0].text : "";
  } catch {
    summary = `This week you had ${total_events_this_week} events from ${unique_users_this_week} unique users.`;
  }

  return {
    total_events_today,
    total_events_this_week,
    unique_users_this_week,
    top_event,
    trends,
    anomalies,
    summary,
    generated_at: now.toISOString(),
  };
}
