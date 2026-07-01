import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { evaluateAllRules } from "@/app/actions/alert-rules";

// Called by Vercel Cron every hour.
// Fetches every org that has enabled alert rules and evaluates them all.
export async function GET(request: Request) {
  // Verify the request is from Vercel Cron (not a random visitor).
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Find all distinct orgs that have at least one enabled rule.
  const { data: orgs } = await admin
    .from("alert_rules")
    .select("organization_id")
    .eq("enabled", true);

  if (!orgs || orgs.length === 0) {
    return NextResponse.json({ ok: true, message: "No enabled rules found" });
  }

  const uniqueOrgIds = [...new Set(orgs.map((r) => r.organization_id))];

  const results = await Promise.allSettled(
    uniqueOrgIds.map((orgId) => evaluateAllRules(orgId))
  );

  const summary = results.map((r, i) => ({
    orgId: uniqueOrgIds[i],
    status: r.status,
    fired: r.status === "fulfilled" ? r.value.filter((x) => x.result.fired).length : 0,
    error: r.status === "rejected" ? String(r.reason) : null,
  }));

  return NextResponse.json({ ok: true, summary });
}
