import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendWeeklyFeatureDigest } from "@/app/actions/feature-metrics";

// Vercel Cron — runs every Monday at 9am UTC
// vercel.json: { "crons": [{ "path": "/api/cron/feature-digest", "schedule": "0 9 * * 1" }] }

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Get all orgs that have a Slack webhook configured
  const { data: orgs } = await admin
    .from("brand_settings")
    .select("organization_id, slack_webhook")
    .not("slack_webhook", "is", null);

  if (!orgs?.length) {
    return NextResponse.json({ message: "No orgs with Slack configured" });
  }

  const results: { orgId: string; ok: boolean }[] = [];
  for (const org of orgs) {
    try {
      await sendWeeklyFeatureDigest(org.organization_id);
      results.push({ orgId: org.organization_id, ok: true });
    } catch {
      results.push({ orgId: org.organization_id, ok: false });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
