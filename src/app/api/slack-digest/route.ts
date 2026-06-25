import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Called by Vercel Cron — see vercel.json.
// Finds all orgs with digest enabled whose cadence aligns with today,
// builds a plain-language goal summary, and POSTs it to their Slack webhook.
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
  const dayOfWeek = today.getDay(); // 0=Sun … 6=Sat
  const isMonday = dayOfWeek === 1;
  const isFirstOfMonth = today.getDate() === 1;

  // Fetch all orgs with digests enabled
  const { data: settings } = await supabase
    .from("brand_settings")
    .select("organization_id, slack_webhook, slack_digest_enabled, slack_digest_cadence, company_name")
    .eq("slack_digest_enabled", true);

  if (!settings?.length) return NextResponse.json({ sent: 0 });

  let sent = 0;
  for (const org of settings) {
    if (!org.slack_webhook) continue;
    // daily → every run; weekly → Mondays only; monthly → 1st of month only
    if (org.slack_digest_cadence === "weekly" && !isMonday) continue;
    if (org.slack_digest_cadence === "monthly" && !isFirstOfMonth) continue;

    // Load objectives + goals for this org
    const [{ data: objectives }, { data: goals }] = await Promise.all([
      supabase.from("company_objectives").select("*").eq("organization_id", org.organization_id),
      supabase.from("business_goals").select("*").eq("organization_id", org.organization_id),
    ]);

    const blocks = buildDigestBlocks(
      org.company_name || "Your team",
      org.slack_digest_cadence,
      objectives ?? [],
      goals ?? []
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
function buildDigestBlocks(companyName: string, cadence: string, objectives: any[], goals: any[]) {
  const label = cadence === "daily" ? "Daily" : cadence === "monthly" ? "Monthly" : "Weekly";
  const blocks: object[] = [];

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: `🎯 ${label} Goal Digest — ${companyName}`, emoji: true },
  });
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `*${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}*` }],
  });
  blocks.push({ type: "divider" });

  if (!objectives?.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "⚠️ No Business Goals set yet. Head to Metrik → Goals to get started." } });
    return blocks;
  }

  for (const obj of objectives) {
    const linked = goals?.filter((g: { objective_id?: string }) => g.objective_id === obj.id) ?? [];
    const statusLine = linked.length
      ? `${linked.length} product goal${linked.length !== 1 ? "s" : ""} linked`
      : "No product goals linked yet";

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${obj.title}*\n${obj.target ? `Target: ${obj.target}` : "No target set"} · ${obj.timeframe || "No timeframe"}\n_${statusLine}_`,
      },
    });

    for (const goal of linked.slice(0, 3)) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `  › *${goal.title}* — ${goal.status ?? "active"}` },
      });
    }
    if (linked.length > 3) {
      blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `  … and ${linked.length - 3} more` }] });
    }
    blocks.push({ type: "divider" });
  }

  // Nudge toward incomplete items
  const nudges: string[] = [];
  if (!objectives.some((o: { target?: string }) => o.target)) nudges.push("• Set a measurable target on your Business Goal");
  if (!goals?.length) nudges.push("• Add at least one Product Goal");
  if (nudges.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*What's next:*\n${nudges.join("\n")}` } });
  }

  return blocks;
}
