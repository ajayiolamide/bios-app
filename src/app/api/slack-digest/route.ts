import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import type { Database } from "@/types/database";

// Called by Vercel Cron — see vercel.json.
// Builds a smart, dynamic daily/weekly Slack digest:
// - Computes real KPI actuals (event counts vs targets)
// - Surfaces alert rules that fired in the last 24h
// - Uses AI to write "what changed since yesterday" narrative
// - Respects per-org digest_sections config

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const today = new Date();
  const dayOfWeek = today.getDay();
  const isMonday = dayOfWeek === 1;
  const isFirstOfMonth = today.getDate() === 1;

  const { data: settings } = await supabase
    .from("brand_settings")
    .select("organization_id, slack_webhook, slack_digest_enabled, slack_digest_cadence, company_name, digest_sections")
    .eq("slack_digest_enabled", true);

  if (!settings?.length) return NextResponse.json({ sent: 0 });

  let sent = 0;
  for (const org of settings) {
    if (!org.slack_webhook) continue;
    if (org.slack_digest_cadence === "weekly" && !isMonday) continue;
    if (org.slack_digest_cadence === "monthly" && !isFirstOfMonth) continue;

    const sections = (org.digest_sections as { goals?: boolean; features?: boolean; attention?: boolean } | null) ?? {};
    const showGoals = sections.goals !== false;
    const showFeatures = sections.features !== false;
    const showAttention = sections.attention !== false;

    const orgId = org.organization_id;

    // Fetch everything in parallel
    const [
      { data: objectives },
      { data: goals },
      { data: kpis },
      { data: features },
      { data: alertRules },
    ] = await Promise.all([
      supabase.from("company_objectives").select("id, title, target, timeframe").eq("organization_id", orgId),
      supabase.from("business_goals").select("id, title, status, objective_id").eq("organization_id", orgId),
      supabase.from("metrics")
        .select("id, name, kind, target_value, goal_id, rate_as_percentage, event_name, denominator_event_name, within_hours")
        .eq("organization_id", orgId)
        .in("kind", ["kpi", "metric"]),
      supabase.from("feature_metrics")
        .select("id, feature_name, launch_status, actual_launch_date, planned_launch_date")
        .eq("organization_id", orgId)
        .eq("status", "active"),
      supabase.from("alert_rules")
        .select("id, name, rule_type, last_fired_at, last_checked_at, last_result, description")
        .eq("organization_id", orgId)
        .eq("enabled", true),
    ]);

    // Compute KPI actuals for wired KPIs (event_name set + target set)
    const kpiActuals: Record<string, { actual: number; target: number; pct: number; unit: string }> = {};
    const wiredKpis = (kpis ?? []).filter(k => k.event_name && k.target_value != null);
    const now = new Date();

    await Promise.all(wiredKpis.map(async (kpi) => {
      try {
        const lookbackMs = (kpi.within_hours ?? 24 * 30) * 3600_000; // default 30d
        const from = new Date(now.getTime() - lookbackMs).toISOString();

        const numRes = await supabase
          .from("events")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("name", kpi.event_name!)
          .gte("timestamp", from);
        const numCount = numRes.count ?? 0;

        let actual = numCount;
        if (kpi.denominator_event_name) {
          const denRes = await supabase
            .from("events")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .eq("name", kpi.denominator_event_name)
            .gte("timestamp", from);
          const denCount = denRes.count ?? 0;
          actual = denCount > 0 ? (numCount / denCount) * 100 : 0;
        }

        const target = kpi.target_value as number;
        const pct = target > 0 ? (actual / target) * 100 : 0;
        const unit = kpi.denominator_event_name ? "%" : "";
        kpiActuals[kpi.id] = { actual, target, pct, unit };
      } catch {
        // skip if error
      }
    }));

    // Alerts fired in last 24h
    const yesterday = new Date(now.getTime() - 86400_000).toISOString();
    const recentFired = (alertRules ?? []).filter(
      r => r.last_fired_at && r.last_fired_at >= yesterday
    );

    // Build AI narrative for what's new/changed
    const narrative = await buildNarrative(
      org.company_name || "Your team",
      org.slack_digest_cadence || "daily",
      objectives ?? [],
      goals ?? [],
      kpis ?? [],
      kpiActuals,
      recentFired,
      features ?? [],
    );

    const blocks = buildDigestBlocks({
      companyName: org.company_name || "Your team",
      cadence: org.slack_digest_cadence || "daily",
      objectives: objectives ?? [],
      goals: goals ?? [],
      kpis: kpis ?? [],
      kpiActuals,
      features: features ?? [],
      recentFired,
      narrative,
      showGoals,
      showFeatures,
      showAttention,
    });

    await fetch(org.slack_webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });

    sent++;
  }

  return NextResponse.json({ sent });
}

// ─── AI narrative ─────────────────────────────────────────────────────────────

async function buildNarrative(
  companyName: string,
  cadence: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  objectives: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  goals: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kpis: any[],
  kpiActuals: Record<string, { actual: number; target: number; pct: number; unit: string }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recentFired: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  features: any[],
): Promise<string> {
  try {
    const kpiLines = kpis
      .filter(k => kpiActuals[k.id])
      .map(k => {
        const { actual, target, pct, unit } = kpiActuals[k.id];
        const status = pct >= 100 ? "✅" : pct >= 70 ? "⚠️" : "❌";
        return `${status} ${k.name}: ${actual.toFixed(1)}${unit} vs ${target}${unit} target (${pct.toFixed(0)}%)`;
      })
      .join("\n") || "No KPI data available.";

    const alertLines = recentFired.length > 0
      ? recentFired.map(r => `🚨 ${r.name}`).join(", ")
      : "None";

    const newFeatures = features.filter(f => {
      const d = f.actual_launch_date || f.planned_launch_date;
      if (!d) return false;
      return new Date(d) >= new Date(Date.now() - 7 * 86400_000);
    }).map(f => f.feature_name).join(", ") || "None";

    const period = cadence === "daily" ? "today" : cadence === "weekly" ? "this week" : "this month";

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 180,
      messages: [{
        role: "user",
        content: `You are the Head of Growth writing a quick brief for the ${companyName} team's ${cadence} Slack digest. Write 2-3 punchy sentences: the headline number that matters most ${period}, what's on track vs behind, and the one thing the team should focus on. Use specific numbers. No filler. No "stakeholders". If alerts fired, mention them urgently.

KPI snapshot:
${kpiLines}

Alerts fired in last 24h: ${alertLines}
Features launched recently: ${newFeatures}
Active product goals: ${goals.length}
Business objectives: ${objectives.map((o: { title: string }) => o.title).join(", ") || "None"}`,
      }],
    });
    return msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
  } catch {
    return "";
  }
}

// ─── Block Kit builder ────────────────────────────────────────────────────────

function buildDigestBlocks(opts: {
  companyName: string;
  cadence: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  objectives: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  goals: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  kpis: any[];
  kpiActuals: Record<string, { actual: number; target: number; pct: number; unit: string }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  features: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recentFired: any[];
  narrative: string;
  showGoals: boolean;
  showFeatures: boolean;
  showAttention: boolean;
}) {
  const { companyName, cadence, objectives, goals, kpis, kpiActuals, features, recentFired, narrative, showGoals, showFeatures, showAttention } = opts;
  const label = cadence === "daily" ? "Daily" : cadence === "monthly" ? "Monthly" : "Weekly";
  const dateStr = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const blocks: object[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: `📊 ${label} Digest  ·  ${companyName}`, emoji: true },
  });
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: dateStr }],
  });
  blocks.push({ type: "divider" });

  // ── AI narrative ─────────────────────────────────────────────────────────
  if (narrative) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: narrative },
    });
    blocks.push({ type: "divider" });
  }

  // ── Fired alerts (always shown if any) ───────────────────────────────────
  if (recentFired.length > 0) {
    const alertLines = recentFired.map(r => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lr = r.last_result as any;
      const detail = lr?.current != null ? ` — ${Number(lr.current).toFixed(1)} now` : "";
      return `🚨 *${r.name}*${detail}${r.description ? `\n_${r.description}_` : ""}`;
    }).join("\n\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*⚠️  Alerts fired in last 24h*\n\n${alertLines}` },
    });
    blocks.push({
      type: "actions",
      elements: [{
        type: "button",
        text: { type: "plain_text", text: "View Alerts", emoji: true },
        url: "https://metrik-tool.vercel.app/alerts",
        style: "danger",
      }],
    });
    blocks.push({ type: "divider" });
  }

  if (!objectives?.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "⚠️ No Business Goals set yet. Head to Metrik → Goals to get started." } });
    return blocks;
  }

  // ── Business Goals + KPI actuals ─────────────────────────────────────────
  if (showGoals) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*🎯  Business Goals & KPIs*" },
    });

    for (const obj of objectives) {
      const linkedGoals = goals.filter((g: { objective_id?: string }) => g.objective_id === obj.id);
      const linkedKpis = kpis.filter((k: { goal_id?: string }) =>
        linkedGoals.some((g: { id: string }) => g.id === k.goal_id)
      );

      const kpiLines: string[] = [];
      for (const kpi of linkedKpis.slice(0, 4)) {
        const actuals = kpiActuals[kpi.id];
        if (actuals) {
          const { actual, target, pct, unit } = actuals;
          const icon = pct >= 100 ? "✅" : pct >= 70 ? "⚠️" : "❌";
          const bar = buildProgressBar(pct);
          kpiLines.push(`${icon} *${kpi.name}*  ${bar}  ${actual.toFixed(1)}${unit} / ${target}${unit} _(${pct.toFixed(0)}%)_`);
        } else {
          const suffix = kpi.rate_as_percentage ? "%" : "";
          const hasTarget = kpi.target_value != null;
          const icon = hasTarget && kpi.event_name ? "⚪" : "🔲";
          const targetStr = hasTarget ? `Target: *${kpi.target_value}${suffix}*` : "No target";
          kpiLines.push(`${icon} *${kpi.name}*  ${targetStr} — _not yet tracked_`);
        }
      }

      const timeframe = obj.timeframe || "No timeframe";
      const target = obj.target || "No target set";
      let bodyText = `*${obj.title}*\n_${target}  ·  ${timeframe}_`;
      if (kpiLines.length > 0) {
        bodyText += "\n" + kpiLines.join("\n");
      } else if (linkedGoals.length === 0) {
        bodyText += "\n_No product goals linked yet_";
      } else {
        bodyText += `\n_${linkedGoals.length} product goal${linkedGoals.length !== 1 ? "s" : ""} — no KPI data yet_`;
      }

      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: bodyText },
      });
    }

    blocks.push({ type: "divider" });
  }

  // ── Features in flight ────────────────────────────────────────────────────
  if (showFeatures && features.length > 0) {
    const statusIcon: Record<string, string> = {
      deployed: "✅", launched: "🚀", post_launch: "📈",
      dev: "🔧", uat: "🧪", ready_for_launch: "🟩",
      design: "🎨", ideation: "💡", paused: "⏸️",
      rolled_back: "↩️", cancelled: "❌", delayed: "⚠️",
    };
    const statusLabel: Record<string, string> = {
      deployed: "Deployed", launched: "Launched", post_launch: "Post-launch",
      dev: "In dev", uat: "In UAT", ready_for_launch: "Ready to launch",
      design: "In design", ideation: "Ideation", paused: "Paused",
      rolled_back: "Rolled back", cancelled: "Cancelled", delayed: "Delayed",
    };

    const sorted = [...features].sort((a, b) => {
      const priority = (s: string) => ["deployed", "launched", "post_launch"].includes(s) ? 0 : ["dev", "uat", "ready_for_launch"].includes(s) ? 1 : 2;
      return priority(a.launch_status) - priority(b.launch_status);
    });

    const featureLines = sorted.slice(0, 6).map((f: { feature_name: string; launch_status: string }) => {
      const icon = statusIcon[f.launch_status] ?? "⚪";
      const label = statusLabel[f.launch_status] ?? f.launch_status;
      return `${icon} *${f.feature_name}*  —  ${label}`;
    });

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*⚡  What's in flight*\n${featureLines.join("\n")}` },
    });

    if (features.length > 6) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `_+ ${features.length - 6} more features_` }],
      });
    }

    blocks.push({ type: "divider" });
  }

  // ── Attention needed ──────────────────────────────────────────────────────
  if (showAttention) {
    const attention: string[] = [];

    const unwiredKpis = kpis.filter((k: { event_name?: string | null; target_value?: number | null }) => !k.event_name && k.target_value == null);
    if (unwiredKpis.length > 0) {
      attention.push(`⚙️ *${unwiredKpis.length} KPI${unwiredKpis.length !== 1 ? "s" : ""}* missing a tracking event or target`);
    }

    const goalsWithNoKpi = goals.filter((g: { id: string }) => !kpis.some((k: { goal_id?: string }) => k.goal_id === g.id));
    if (goalsWithNoKpi.length > 0) {
      attention.push(`📌 *${goalsWithNoKpi.length} product goal${goalsWithNoKpi.length !== 1 ? "s" : ""}* ha${goalsWithNoKpi.length !== 1 ? "ve" : "s"} no KPIs yet`);
    }

    const objsWithNoGoals = objectives.filter((o: { id: string }) => !goals.some((g: { objective_id?: string }) => g.objective_id === o.id));
    if (objsWithNoGoals.length > 0) {
      attention.push(`🔗 *${objsWithNoGoals.length} business goal${objsWithNoGoals.length !== 1 ? "s" : ""}* not linked to any product goal`);
    }

    if (attention.length > 0) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*👀  Needs attention*\n${attention.join("\n")}` },
      });
      blocks.push({ type: "divider" });
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  blocks.push({
    type: "context",
    elements: [{
      type: "mrkdwn",
      text: `View full dashboard on <https://metrik-tool.vercel.app|Metrik>  ·  _Sent by Metrik ${label} Digest_`,
    }],
  });

  return blocks;
}

// Build a simple 5-block text progress bar
function buildProgressBar(pct: number): string {
  const filled = Math.round(Math.min(pct, 100) / 20); // 0–5
  return "▓".repeat(filled) + "░".repeat(5 - filled);
}
