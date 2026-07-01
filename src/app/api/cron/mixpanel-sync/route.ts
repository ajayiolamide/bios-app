import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { syncMixpanelRawEvents } from "@/app/actions/mixpanel";
import type { AlertRule } from "@/types/database";

// Called by Vercel Cron at 8am daily — BEFORE the 9am alerts cron.
// Syncs only the event names that are actually referenced by enabled alert
// rules, so the 9am evaluation always runs against fresh data without
// requiring a manual sync from Sources.
export async function GET(request: Request) {
  // Verify the request is from Vercel Cron (not a random visitor).
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Find all distinct orgs with at least one enabled alert rule.
  const { data: rules } = await admin
    .from("alert_rules")
    .select("organization_id, numerator_event, denominator_event")
    .eq("enabled", true);

  if (!rules || rules.length === 0) {
    return NextResponse.json({ ok: true, message: "No enabled alert rules — nothing to sync" });
  }

  // Group event names by org — only sync what's actually needed.
  const byOrg = new Map<string, Set<string>>();
  for (const rule of rules as Pick<AlertRule, "organization_id" | "numerator_event" | "denominator_event">[]) {
    if (!byOrg.has(rule.organization_id)) byOrg.set(rule.organization_id, new Set());
    const set = byOrg.get(rule.organization_id)!;
    if (rule.numerator_event) set.add(rule.numerator_event);
    if (rule.denominator_event) set.add(rule.denominator_event);
  }

  // Sync each org — 7 days is enough for alert rules (lookback_days default is 7).
  const results = await Promise.allSettled(
    [...byOrg.entries()].map(async ([orgId, eventSet]) => {
      const eventNames = [...eventSet];
      const result = await syncMixpanelRawEvents(orgId, eventNames, 7);
      return { orgId, eventNames, ...result };
    })
  );

  const summary = results.map((r) =>
    r.status === "fulfilled"
      ? { ...r.value, status: "ok" }
      : { status: "error", error: String(r.reason) }
  );

  return NextResponse.json({ ok: true, summary });
}
