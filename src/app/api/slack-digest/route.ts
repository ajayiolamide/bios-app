import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Called by Vercel Cron — see vercel.json.
// Fetches objectives, product goals, KPIs, and features for each org,
// then builds a rich, well-spaced Slack digest.
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
    .select("organization_id, slack_webhook, slack_digest_enabled, slack_digest_cadence, company_name")
    .eq("slack_digest_enabled", true);

  if (!settings?.length) return NextResponse.json({ sent: 0 });

  let sent = 0;
  for (const org of settings) {
    if (!org.slack_webhook) continue;
    if (org.slack_digest_cadence === "weekly" && !isMonday) continue;
    if (org.slack_digest_cadence === "monthly" && !isFirstOfMonth) continue;

    const [
      { data: objectives },
      { data: goals },
      { data: kpis },
      { data: features },
    ] = await Promise.all([
      supabase.from("company_objectives").select("id, title, target, timeframe").eq("organization_id", org.organization_id),
      supabase.from("business_goals").select("id, title, status, objective_id").eq("organization_id", org.organization_id),
      supabase.from("metrics").select("id, name, kind, target_value, goal_id, rate_as_percentage, event_name").eq("organization_id", org.organization_id).in("kind", ["kpi", "metric"]),
      supabase.from("feature_metrics").select("id, feature_name, launch_status, actual_launch_date, planned_launch_date").eq("organization_id", org.organization_id).eq("status", "active"),
    ]);

    const blocks = buildDigestBlocks(
      org.company_name || "Your team",
      org.slack_digest_cadence,
      objectives ?? [],
      goals ?? [],
      kpis ?? [],
      features ?? [],
    );

    await fetch(org.slack_webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });

    sent++;
  }

  return NextResponse.json({ sent });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildDigestBlocks(companyName: string, cadence: string, objectives: any[], goals: any[], kpis: any[], features: any[]) {
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

  if (!objectives?.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "⚠️ No Business Goals set yet. Head to Metrik → Goals to get started." } });
    return blocks;
  }

  // ── Snapshot summary bar ──────────────────────────────────────────────────
  const totalKpis = kpis.length;
  // KPIs are "wired" if they have an event source or a target — shows they're set up properly
  const wiredKpis = kpis.filter((k: { event_name?: string | null; target_value?: number | null }) => k.event_name || k.target_value != null);
  const unwiredKpis = kpis.filter((k: { event_name?: string | null; target_value?: number | null }) => !k.event_name && k.target_value == null);

  const deployedFeatures = features.filter((f: { launch_status: string }) => ["deployed", "launched", "post_launch"].includes(f.launch_status));
  const inProgressFeatures = features.filter((f: { launch_status: string }) => ["dev", "uat", "ready_for_launch", "design"].includes(f.launch_status));

  const summaryParts: string[] = [];
  if (totalKpis > 0) {
    summaryParts.push(`*${wiredKpis.length}/${totalKpis}* KPIs configured`);
  }
  if (deployedFeatures.length > 0) summaryParts.push(`*${deployedFeatures.length}* feature${deployedFeatures.length !== 1 ? "s" : ""} live`);
  if (inProgressFeatures.length > 0) summaryParts.push(`*${inProgressFeatures.length}* in progress`);
  if (goals.length > 0) summaryParts.push(`*${goals.length}* product goal${goals.length !== 1 ? "s" : ""} active`);

  if (summaryParts.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: summaryParts.join("  ·  ") },
    });
    blocks.push({ type: "divider" });
  }

  // ── Business Goals + KPIs ─────────────────────────────────────────────────
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "*🎯  Business Goals*" },
  });

  for (const obj of objectives) {
    const linkedGoals = goals.filter((g: { objective_id?: string }) => g.objective_id === obj.id);
    const linkedKpis = kpis.filter((k: { goal_id?: string }) =>
      linkedGoals.some((g: { id: string }) => g.id === k.goal_id)
    );

    // Build KPI lines — show name + target (actual values are computed on-demand, not stored)
    const kpiLines: string[] = [];
    for (const kpi of linkedKpis.slice(0, 3)) {
      const suffix = kpi.rate_as_percentage ? "%" : "";
      const hasTarget = kpi.target_value != null;
      const hasEvent = !!kpi.event_name;
      const icon = hasTarget && hasEvent ? "📈" : hasTarget || hasEvent ? "⚪" : "🔲";
      const targetStr = hasTarget ? `Target: *${kpi.target_value}${suffix}*` : "No target set";
      const trackStr = hasEvent ? "· tracked" : "· no event";
      kpiLines.push(`${icon} ${kpi.name}  ${targetStr} ${trackStr}`);
    }

    const timeframe = obj.timeframe || "No timeframe";
    const target = obj.target || "No target set";
    let bodyText = `*${obj.title}*\n_${target}  ·  ${timeframe}_`;
    if (kpiLines.length > 0) {
      bodyText += "\n" + kpiLines.join("\n");
    } else if (linkedGoals.length === 0) {
      bodyText += "\n_No product goals linked yet_";
    } else {
      bodyText += `\n_${linkedGoals.length} product goal${linkedGoals.length !== 1 ? "s" : ""} — no KPI data available yet_`;
    }

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: bodyText },
    });
  }

  blocks.push({ type: "divider" });

  // ── What's happening — features ───────────────────────────────────────────
  if (features.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*⚡  What's in flight*" },
    });

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

    // Sort: deployed/launched first, then in-progress, then others
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
      text: { type: "mrkdwn", text: featureLines.join("\n") },
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
  const attention: string[] = [];

  // KPIs not fully wired up
  if (unwiredKpis.length > 0) {
    attention.push(`⚙️ *${unwiredKpis.length} KPI${unwiredKpis.length !== 1 ? "s" : ""}* missing a tracking event or target`);
  }

  // Goals with no KPIs
  const goalsWithNoKpi = goals.filter((g: { id: string }) => !kpis.some((k: { goal_id?: string }) => k.goal_id === g.id));
  if (goalsWithNoKpi.length > 0) {
    attention.push(`📌 *${goalsWithNoKpi.length} product goal${goalsWithNoKpi.length !== 1 ? "s" : ""}* ha${goalsWithNoKpi.length !== 1 ? "ve" : "s"} no KPIs set up yet`);
  }

  // Objectives with no goals
  const objsWithNoGoals = objectives.filter((o: { id: string }) => !goals.some((g: { objective_id?: string }) => g.objective_id === o.id));
  if (objsWithNoGoals.length > 0) {
    attention.push(`🔗 *${objsWithNoGoals.length} business goal${objsWithNoGoals.length !== 1 ? "s" : ""}* not yet linked to any product goal`);
  }

  if (attention.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*👀  Needs attention*\n${attention.join("\n")}` },
    });
    blocks.push({ type: "divider" });
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
