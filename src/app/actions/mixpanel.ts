"use server";

import { createAdminClient } from "@/lib/supabase/server";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MixpanelSettings = {
  username: string;       // Service Account username
  api_secret: string;     // Service Account secret (or legacy API Secret)
  project_id: string;
  data_region: "US" | "EU";
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Query API URL — for segmentation queries (Service Account) or Data Export (Legacy).
 * Service Accounts use mixpanel.com/api/query; Legacy uses data.mixpanel.com/api/2.0.
 */
function baseUrl(settings: MixpanelSettings) {
  if (settings.username) {
    return settings.data_region === "EU"
      ? "https://eu.mixpanel.com/api/query"
      : "https://mixpanel.com/api/query";
  }
  return settings.data_region === "EU"
    ? "https://eu.mixpanel.com/api/2.0"
    : "https://data.mixpanel.com/api/2.0";
}

/**
 * Data Export API URL — always uses data.mixpanel.com/api/2.0.
 * The /events/names endpoint ONLY exists on the Data Export API, not the Query API.
 * Both Service Account and Legacy credentials work here via Basic auth.
 */
function dataExportUrl(settings: MixpanelSettings) {
  return settings.data_region === "EU"
    ? "https://eu.mixpanel.com/api/2.0"
    : "https://data.mixpanel.com/api/2.0";
}

function authHeader(settings: MixpanelSettings) {
  const credential = settings.username
    ? `${settings.username}:${settings.api_secret}`   // Service Account
    : `${settings.api_secret}:`;                       // Legacy API Secret
  return `Basic ${Buffer.from(credential).toString("base64")}`;
}

function dateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

// ─── Get stored Mixpanel settings ────────────────────────────────────────────

export async function getMixpanelSettings(
  orgId: string
): Promise<{ settings?: MixpanelSettings; connected: boolean; lastSyncedAt?: string | null }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("brand_settings")
    .select("mixpanel_username, mixpanel_api_secret, mixpanel_project_id, mixpanel_data_region, mixpanel_raw_synced_until")
    .eq("organization_id", orgId)
    .single();

  if (!data?.mixpanel_api_secret) return { connected: false };

  return {
    connected: true,
    // Surfaced so the UI can explain what picking a given sync window will
    // actually do — e.g. "never synced, pick a wide window to backfill"
    // vs. "synced 2 days ago, a short window is enough to catch up."
    lastSyncedAt: data.mixpanel_raw_synced_until ?? null,
    settings: {
      username:    data.mixpanel_username    ?? "",
      api_secret:  data.mixpanel_api_secret,
      project_id:  data.mixpanel_project_id  ?? "",
      data_region: (data.mixpanel_data_region ?? "US") as "US" | "EU",
    },
  };
}

// ─── Save Mixpanel settings ───────────────────────────────────────────────────

export async function saveMixpanelSettings(
  orgId: string,
  settings: Partial<MixpanelSettings>
): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("brand_settings")
    .upsert(
      {
        organization_id:      orgId,
        mixpanel_username:    settings.username?.trim()    ?? null,
        mixpanel_api_secret:  settings.api_secret?.trim()  ?? null,
        mixpanel_project_id:  settings.project_id?.trim()  ?? null,
        mixpanel_data_region: settings.data_region         ?? "US",
      },
      { onConflict: "organization_id" }
    );
  if (error) return { error: error.message };
  return {};
}

// ─── Test connection ──────────────────────────────────────────────────────────

export async function testMixpanelConnection(
  orgId: string
): Promise<{ ok: boolean; error?: string }> {
  const { settings, connected } = await getMixpanelSettings(orgId);
  if (!connected || !settings) return { ok: false, error: "No credentials saved. Did you run the latest migration in Supabase?" };

  const today   = dateStr(new Date());
  const weekAgo = dateStr(new Date(Date.now() - 7 * 864e5));

  // Service Accounts require a project_id
  if (settings.username && !settings.project_id) {
    return { ok: false, error: "Service Account auth requires a Project ID. Add it in the Project ID field." };
  }

  try {
    // baseUrl() picks the right host: mixpanel.com/api/query for Service Accounts,
    // data.mixpanel.com/api/2.0 for Legacy API Secret.
    const url = new URL(`${baseUrl(settings)}/segmentation`);
    url.searchParams.set("event",     "__bios_ping__");
    url.searchParams.set("from_date", weekAgo);
    url.searchParams.set("to_date",   today);
    url.searchParams.set("unit",      "day");
    url.searchParams.set("type",      "general");
    if (settings.project_id) url.searchParams.set("project_id", settings.project_id);

    const res = await fetch(url.toString(), {
      headers: { Authorization: authHeader(settings) },
    });

    if (!res.ok) {
      const txt = await res.text();
      if (res.status === 401) {
        const hint = settings.username
          ? "Authentication failed. Check that the Service Account Username and Secret are correct and the account has access to this project."
          : "Authentication failed. Check that your API Secret is the project secret (not the project token).";
        return { ok: false, error: hint };
      }
      return { ok: false, error: `Mixpanel ${res.status}: ${txt.slice(0, 400)}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Fetch event counts for the last N days ───────────────────────────────────

export async function fetchMixpanelEventCounts(
  orgId: string,
  eventNames: string[],
  days = 30
): Promise<{ counts?: Record<string, number>; error?: string }> {
  if (!eventNames.length) return { counts: {} };

  const { settings, connected } = await getMixpanelSettings(orgId);
  if (!connected || !settings) {
    return { error: "Mixpanel not connected. Add your credentials in Settings." };
  }

  if (settings.username && !settings.project_id) {
    return { error: "Service Account auth requires a Project ID — add it in Settings." };
  }

  const today    = dateStr(new Date());
  const fromDate = dateStr(new Date(Date.now() - days * 864e5));

  try {
    const results = await Promise.all(
      eventNames.map(async (eventName) => {
        // baseUrl() picks the right host for the credential type
        const url = new URL(`${baseUrl(settings)}/segmentation`);
        url.searchParams.set("event",     eventName);
        url.searchParams.set("from_date", fromDate);
        url.searchParams.set("to_date",   today);
        url.searchParams.set("unit",      "day");
        url.searchParams.set("type",      "general");
        if (settings.project_id) url.searchParams.set("project_id", settings.project_id);

        const res = await fetch(url.toString(), {
          headers: { Authorization: authHeader(settings) },
        });

        if (!res.ok) return { eventName, count: 0, error: await res.text() };

        const json = await res.json() as {
          data?: { values?: Record<string, Record<string, number>> };
          error?: string;
        };

        if (json.error) return { eventName, count: 0, error: json.error };

        const values = json.data?.values?.[eventName] ?? {};
        const count  = Object.values(values).reduce((sum, n) => sum + (n ?? 0), 0);
        return { eventName, count };
      })
    );

    const counts: Record<string, number> = {};
    for (const r of results) counts[r.eventName] = r.count;
    return { counts };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// ─── Sync Mixpanel event names → events table ─────────────────────────────────

export async function syncMixpanelEventNames(
  orgId: string
): Promise<{ synced: number; total: number; error?: string }> {
  const { settings, connected } = await getMixpanelSettings(orgId);
  if (!connected || !settings) {
    return { synced: 0, total: 0, error: "Mixpanel not connected. Add credentials in Settings." };
  }
  if (settings.username && !settings.project_id) {
    return { synced: 0, total: 0, error: "Service Account auth requires a Project ID — add it in Settings." };
  }

  try {
    // /events/names ("Top Events") is a Query API endpoint — confirmed against
    // Mixpanel's published OpenAPI spec, which puts it under
    // https://{region}.mixpanel.com/api/query, the same host baseUrl() already
    // uses for /segmentation. It does NOT live on the Data Export host, and
    // it does not take from_date/to_date at all (only type/limit/project_id) —
    // it always looks at the last 31 days. The previous version of this code
    // moved it to dataExportUrl() based on a wrong assumption, which is why
    // Service Accounts that pass Test Connection (also baseUrl) were getting
    // rejected here specifically — they were hitting a host this endpoint
    // doesn't live on, not a real permissions gap.
    const url = new URL(`${baseUrl(settings)}/events/names`);
    url.searchParams.set("type",  "general");
    url.searchParams.set("limit", "255");
    if (settings.project_id) url.searchParams.set("project_id", settings.project_id);

    const res = await fetch(url.toString(), {
      headers: { Authorization: authHeader(settings) },
    });

    if (!res.ok) {
      const txt = await res.text();
      if (res.status === 401) {
        const hint = settings.username
          ? "Mixpanel 401: Service Account authentication failed. Verify the Username and Secret in Settings, and confirm the account has access to this project."
          : "Mixpanel 401: Authentication failed. Make sure you entered the API Secret (not the Project Token) in Settings.";
        return { synced: 0, total: 0, error: hint };
      }
      return { synced: 0, total: 0, error: `Mixpanel ${res.status}: ${txt.slice(0, 300)}` };
    }

    // Per Mixpanel's spec, a successful response here is a bare JSON array of
    // names — NOT wrapped in { data: [...] }. (That wrapped shape is what
    // /export and some other endpoints use, which is where this likely got
    // copied from.) Reading json.data on a bare array returns undefined, so
    // this was silently treating a real, populated response as empty.
    const json = await res.json() as string[] | { data?: string[]; error?: string };
    if (!Array.isArray(json) && json.error) return { synced: 0, total: 0, error: json.error };

    const eventNames: string[] = Array.isArray(json) ? json : Array.isArray(json.data) ? json.data : [];
    if (!eventNames.length) return { synced: 0, total: 0 };

    // Only skip names that already have a mixpanel-sourced row — don't block on CSV/SDK rows with the same name
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("events")
      .select("name")
      .eq("organization_id", orgId)
      .filter("properties->>source", "eq", "mixpanel")
      .in("name", eventNames);

    const existingNames = new Set((existing ?? []).map(r => r.name as string));
    const toInsert = eventNames.filter(n => !existingNames.has(n));

    if (toInsert.length > 0) {
      const now = new Date().toISOString();
      // is_placeholder marks this as a name-only stub with no real occurrence —
      // there's no real timestamp or user behind it, it exists purely so the
      // name shows up in autocomplete lists. Every KPI/goal/insight count query
      // filters these out specifically (see is_placeholder checks elsewhere) so
      // they don't get counted as real activity. syncMixpanelRawEvents below
      // also tags rows source: "mixpanel" but leaves is_placeholder unset,
      // since those rows ARE real occurrences and should count.
      const rows = toInsert.map(name => ({
        organization_id: orgId,
        name,
        properties: { source: "mixpanel", is_placeholder: true } as Record<string, unknown>,
        timestamp: now,
        user_id:    null as string | null,
        session_id: null as string | null,
      }));
      const { error: insertErr } = await admin.from("events").insert(rows);
      if (insertErr) return { synced: 0, total: eventNames.length, error: insertErr.message };
    }

    return { synced: toInsert.length, total: eventNames.length };
  } catch (err) {
    return { synced: 0, total: 0, error: (err as Error).message };
  }
}

// ─── Sync raw, per-occurrence events for specific tracked event names ───────
//
// syncMixpanelEventNames above only checks WHICH event names exist — it inserts
// one placeholder row per name, with no real timestamp or user. That's enough
// for "is this firing at all" checklists, but Feature Impact (trend-break,
// adopter-vs-non-adopter comparison) needs real per-occurrence data: a
// timestamp and a distinct_id per event. This pulls that from Mixpanel's raw
// Export API, scoped to only the event names passed in (not the org's entire
// Mixpanel history) and capped at 90 days, to keep volume and API cost bounded.
//
// Uses a high-water mark (brand_settings.mixpanel_raw_synced_until) so repeat
// syncs only fetch what's new since the last successful run, rather than
// re-pulling the whole window every time.

export async function syncMixpanelRawEvents(
  orgId: string,
  eventNames: string[],
  days = 60
): Promise<{ synced: number; error?: string }> {
  if (!eventNames.length) return { synced: 0 };

  const { settings, connected } = await getMixpanelSettings(orgId);
  if (!connected || !settings) {
    return { synced: 0, error: "Mixpanel not connected. Add credentials in Settings." };
  }
  if (settings.username && !settings.project_id) {
    return { synced: 0, error: "Service Account auth requires a Project ID — add it in Settings." };
  }

  const admin = createAdminClient();
  const { data: brand } = await admin
    .from("brand_settings")
    .select("mixpanel_raw_synced_until")
    .eq("organization_id", orgId)
    .single();

  const cappedDays = Math.min(days, 90);
  const earliestAllowedMs = Date.now() - cappedDays * 864e5;
  const lastSyncMs = brand?.mixpanel_raw_synced_until ? new Date(brand.mixpanel_raw_synced_until).getTime() : null;
  const fromMs = lastSyncMs && lastSyncMs > earliestAllowedMs ? lastSyncMs : earliestAllowedMs;
  const toMs = Date.now();

  try {
    // Raw export always lives on the Data Export API host, for both credential types.
    const url = new URL(`${dataExportUrl(settings)}/export`);
    url.searchParams.set("from_date", dateStr(new Date(fromMs)));
    url.searchParams.set("to_date", dateStr(new Date(toMs)));
    url.searchParams.set("event", JSON.stringify(eventNames));
    if (settings.project_id) url.searchParams.set("project_id", settings.project_id);

    const res = await fetch(url.toString(), {
      headers: { Authorization: authHeader(settings) },
    });

    if (!res.ok) {
      const txt = await res.text();
      if (res.status === 402 || res.status === 403) {
        return { synced: 0, error: "Mixpanel raw export isn't available on this plan or project — aggregate event-count sync still works." };
      }
      if (res.status === 401) {
        return { synced: 0, error: "Mixpanel authentication failed for raw export. Check your credentials in Settings." };
      }
      return { synced: 0, error: `Mixpanel ${res.status}: ${txt.slice(0, 300)}` };
    }

    // Raw export returns newline-delimited JSON, not a single JSON array.
    const text = await res.text();
    const lines = text.split("\n").filter(l => l.trim());

    type RawMixpanelEvent = {
      event: string;
      properties: Record<string, unknown> & { distinct_id?: string; time?: number };
    };

    const rows: {
      organization_id: string;
      name: string;
      properties: Record<string, unknown>;
      user_id: string | null;
      session_id: string | null;
      timestamp: string;
    }[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as RawMixpanelEvent;
        if (!parsed.event || !eventNames.includes(parsed.event)) continue;
        const props = parsed.properties ?? {};
        const timeSec = typeof props.time === "number" ? props.time : Math.floor(Date.now() / 1000);
        rows.push({
          organization_id: orgId,
          name: parsed.event,
          properties: { ...props, source: "mixpanel" },
          user_id: typeof props.distinct_id === "string" ? props.distinct_id : null,
          session_id: null,
          timestamp: new Date(timeSec * 1000).toISOString(),
        });
      } catch {
        // Skip malformed lines — raw export is best-effort
      }
    }

    if (!rows.length) {
      await admin.from("brand_settings").update({ mixpanel_raw_synced_until: new Date(toMs).toISOString() }).eq("organization_id", orgId);
      return { synced: 0 };
    }

    // Batch insert to keep individual payloads reasonable.
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await admin.from("events").insert(chunk);
      if (error) return { synced: inserted, error: error.message };
      inserted += chunk.length;
    }

    await admin.from("brand_settings").update({ mixpanel_raw_synced_until: new Date(toMs).toISOString() }).eq("organization_id", orgId);
    return { synced: inserted };
  } catch (err) {
    return { synced: 0, error: (err as Error).message };
  }
}
