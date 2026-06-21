"use server";

import { parse } from "csv-parse/sync";
import { createServerClient, createAdminClient } from "@/lib/supabase/server";
import type { Event } from "@/types/database";

// ─── Fetch events (paginated) ─────────────────────────────────────────────────

export async function getDistinctEventNames(orgId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("events")
    .select("name")
    .eq("organization_id", orgId)
    .order("name");
  if (!data) return [];
  // Deduplicate
  return [...new Set(data.map((r) => r.name as string))].sort();
}

// Returns distinct event names with their source (csv | mixpanel | sdk | null)
export type EventNameWithSource = {
  name: string;
  source: "csv" | "mixpanel" | "sdk" | null;
};

export async function getEventNamesWithSource(orgId: string): Promise<EventNameWithSource[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("events")
    .select("name, properties")
    .eq("organization_id", orgId)
    .order("name");

  if (!data) return [];

  // Deduplicate by name.
  // Priority: mixpanel > csv > sdk > null — so Mixpanel badge wins when the same
  // event name exists across multiple sources.
  const SOURCE_RANK: Record<string, number> = { mixpanel: 3, sdk: 2, csv: 1 };
  const seen = new Map<string, EventNameWithSource>();
  for (const row of data) {
    const props = row.properties as Record<string, unknown> | null;
    const src = (props?.source as string | undefined) ?? null;
    const source: EventNameWithSource["source"] =
      src === "csv" ? "csv"
      : src === "mixpanel" ? "mixpanel"
      : src ? "sdk"
      : null;

    const existing = seen.get(row.name);
    const newRank = SOURCE_RANK[source ?? ""] ?? 0;
    const oldRank = SOURCE_RANK[existing?.source ?? ""] ?? 0;
    if (!existing || newRank > oldRank) {
      seen.set(row.name, { name: row.name, source });
    }
  }

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getEvents(
  orgId: string,
  { search = "", offset = 0, limit = 50, source }: { search?: string; offset?: number; limit?: number; source?: "csv" | "mixpanel" | "all" } = {}
): Promise<{ events: Event[]; total: number }> {
  const admin = createAdminClient();
  let query = admin
    .from("events")
    .select("*", { count: "exact" })
    .eq("organization_id", orgId)
    .order("timestamp", { ascending: false })
    .range(offset, offset + limit - 1);

  if (search.trim()) query = query.ilike("name", `%${search.trim()}%`);
  if (source === "csv")      query = query.filter("properties->>source", "eq", "csv");
  if (source === "mixpanel") query = query.filter("properties->>source", "eq", "mixpanel");

  const { data, count } = await query;
  return { events: (data ?? []) as Event[], total: count ?? 0 };
}

export async function deleteEventsBySource(
  orgId: string,
  source: "csv" | "mixpanel"
): Promise<{ deleted: number; error?: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { deleted: 0, error: "Not authenticated" };

  const admin = createAdminClient();

  // Use count:"exact" on the delete itself — avoids a race between the pre-count and delete
  const { count, error } = await admin
    .from("events")
    .delete({ count: "exact" })
    .eq("organization_id", orgId)
    .filter("properties->>source", "eq", source);

  if (error) return { deleted: 0, error: error.message };
  return { deleted: count ?? 0 };
}

// Column aliases recognised as each field
const NAME_COLS = ["name", "event", "event_name", "eventname", "type", "event_type", "event name"];
const TS_COLS = ["timestamp", "time", "date", "created_at", "event_time", "occurred_at"];
const USER_COLS = ["user_id", "userid", "user", "distinct_id", "distinctid", "actor", "distinct id"];
const SESSION_COLS = ["session_id", "sessionid", "session"];

function findCol(headers: string[], aliases: string[]): string | undefined {
  return headers.find((h) => aliases.includes(h.toLowerCase()));
}

export type ImportResult = {
  imported: number;
  skipped: number;
  errors: string[];
};

export async function importEventsFromCSV(
  orgId: string,
  csvText: string
): Promise<ImportResult> {
  // Verify auth
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { imported: 0, skipped: 0, errors: ["Not authenticated"] };

  // Verify membership
  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return { imported: 0, skipped: 0, errors: ["You are not a member of this organization"] };
  }

  // Parse CSV
  let records: Record<string, string>[];
  try {
    records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      relax_column_count: true,
    });
  } catch (err) {
    return { imported: 0, skipped: 0, errors: [`CSV parse error: ${(err as Error).message}`] };
  }

  if (records.length === 0) {
    return { imported: 0, skipped: 0, errors: ["CSV has no data rows"] };
  }

  const headers = Object.keys(records[0]);
  const nameCol = findCol(headers, NAME_COLS);
  const tsCol = findCol(headers, TS_COLS);
  const userCol = findCol(headers, USER_COLS);
  const sessionCol = findCol(headers, SESSION_COLS);

  if (!nameCol) {
    return {
      imported: 0,
      skipped: 0,
      errors: [
        `No event name column found. Rename one of your columns to: ${NAME_COLS.join(", ")}`,
      ],
    };
  }

  const knownCols = new Set(
    [nameCol, tsCol, userCol, sessionCol].filter(Boolean) as string[]
  );

  // Map rows → events
  const rows = records
    .map((r, i) => {
      const name = r[nameCol]?.trim();
      if (!name) return null;

      // Build properties from all non-reserved columns
      const properties: Record<string, string> = { source: "csv" };
      for (const [k, v] of Object.entries(r)) {
        if (!knownCols.has(k) && v !== "") properties[k] = v;
      }

      // Parse timestamp — fall back to now if missing/invalid
      // Handles ISO strings, Unix seconds (Mixpanel), and Unix milliseconds
      let timestamp: string | undefined;
      if (tsCol && r[tsCol]) {
        const raw = r[tsCol].trim();
        const num = Number(raw);
        let d: Date;
        if (!isNaN(num) && num > 0) {
          // Unix timestamp — if < 1e12 it's in seconds, otherwise milliseconds
          d = new Date(num < 1e12 ? num * 1000 : num);
        } else {
          d = new Date(raw);
        }
        timestamp = isNaN(d.getTime()) ? undefined : d.toISOString();
      }

      return {
        organization_id: orgId,
        name,
        properties,
        user_id: (userCol && r[userCol]?.trim()) || null,
        session_id: (sessionCol && r[sessionCol]?.trim()) || null,
        ...(timestamp ? { timestamp } : {}),
      };
    })
    .filter(Boolean) as object[];

  const skipped = records.length - rows.length;
  const errors: string[] = [];
  let imported = 0;

  // Batch insert — 500 rows at a time
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await admin.from("events").insert(batch);
    if (error) {
      errors.push(`Batch ${Math.floor(i / BATCH) + 1} failed: ${error.message}`);
    } else {
      imported += batch.length;
    }
  }

  return { imported, skipped, errors };
}

// ─── Delete events ────────────────────────────────────────────────────────────

export async function deleteEventsByIds(
  orgId: string,
  ids: string[]
): Promise<{ deleted: number; error?: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { deleted: 0, error: "Not authenticated" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("events")
    .delete()
    .eq("organization_id", orgId)
    .in("id", ids);

  if (error) return { deleted: 0, error: error.message };
  return { deleted: ids.length };
}

export async function deleteAllEvents(
  orgId: string
): Promise<{ deleted: number; error?: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { deleted: 0, error: "Not authenticated" };

  const admin = createAdminClient();
  const { count, error } = await admin
    .from("events")
    .delete({ count: "exact" })
    .eq("organization_id", orgId);

  if (error) return { deleted: 0, error: error.message };
  return { deleted: count ?? 0 };
}

export async function deleteEventsByName(
  orgId: string,
  eventName: string
): Promise<{ deleted: number; error?: string }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { deleted: 0, error: "Not authenticated" };

  const admin = createAdminClient();
  const { count, error } = await admin
    .from("events")
    .delete({ count: "exact" })
    .eq("organization_id", orgId)
    .eq("name", eventName);

  if (error) return { deleted: 0, error: error.message };
  return { deleted: count ?? 0 };
}
