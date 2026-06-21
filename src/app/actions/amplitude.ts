"use server";

import { createAdminClient } from "@/lib/supabase/server";
import zlib from "zlib";
// Amplitude's Export API returns a ZIP archive of gzipped NDJSON files (not
// a flat JSON response like Mixpanel's raw export) — JSZip reads that
// container format. (Previously used "unzipper", which statically requires
// @aws-sdk/client-s3 for an S3 source option we never use — that's a
// transitive dependency this app never installs, which broke the Next.js
// build. JSZip has no such optional cloud-SDK dependency.)
import JSZip from "jszip";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AmplitudeSettings = {
  api_key: string;
  secret_key: string;
  data_region: "US" | "EU";
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Dashboard REST API (segmentation) and Taxonomy API share this host.
function apiBase(settings: AmplitudeSettings) {
  return settings.data_region === "EU"
    ? "https://analytics.eu.amplitude.com/api/2"
    : "https://amplitude.com/api/2";
}

// Export API lives on the same host for both regions, per Amplitude's docs.
function exportUrl(settings: AmplitudeSettings) {
  return `${apiBase(settings)}/export`;
}

function authHeader(settings: AmplitudeSettings) {
  return `Basic ${Buffer.from(`${settings.api_key}:${settings.secret_key}`).toString("base64")}`;
}

// Amplitude's date params come in two different formats depending on the
// endpoint: segmentation wants YYYYMMDD, export wants YYYYMMDDTHH.
function dateStr(d: Date) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}
function dateHourStr(d: Date) {
  return `${dateStr(d)}T${String(d.getUTCHours()).padStart(2, "0")}`;
}

// ─── Get stored Amplitude settings ───────────────────────────────────────────

export async function getAmplitudeSettings(
  orgId: string
): Promise<{ settings?: AmplitudeSettings; connected: boolean }> {
  const admin = createAdminClient();
  const { data: rawData } = await admin
    .from("brand_settings")
    .select("amplitude_api_key, amplitude_secret_key, amplitude_data_region")
    .eq("organization_id", orgId)
    .single();

  // Same Supabase generated-type `never` inference issue as elsewhere in
  // this codebase — explicit shape matches exactly what .select() returns.
  type AmplitudeRow = { amplitude_api_key: string | null; amplitude_secret_key: string | null; amplitude_data_region: string | null };
  const data = rawData as AmplitudeRow | null;

  if (!data?.amplitude_api_key || !data?.amplitude_secret_key) return { connected: false };

  return {
    connected: true,
    settings: {
      api_key: data.amplitude_api_key,
      secret_key: data.amplitude_secret_key,
      data_region: (data.amplitude_data_region ?? "US") as "US" | "EU",
    },
  };
}

// ─── Save Amplitude settings ──────────────────────────────────────────────────

export async function saveAmplitudeSettings(
  orgId: string,
  settings: Partial<AmplitudeSettings>
): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("brand_settings")
    .upsert(
      {
        organization_id: orgId,
        amplitude_api_key: settings.api_key?.trim() ?? null,
        amplitude_secret_key: settings.secret_key?.trim() ?? null,
        amplitude_data_region: settings.data_region ?? "US",
      },
      { onConflict: "organization_id" }
    );
  if (error) return { error: error.message };
  return {};
}

// ─── Test connection ──────────────────────────────────────────────────────────
// Uses the Event Segmentation endpoint with a bogus event name instead of the
// Taxonomy API — Taxonomy access has to be separately enabled by Amplitude
// support per-account, so gating "is this connected at all" on it would fail
// for plenty of valid credentials. Segmentation just returns zeros for an
// event that doesn't exist, which is enough to prove the key/secret pair is
// real without depending on a feature that may not be turned on.

export async function testAmplitudeConnection(
  orgId: string
): Promise<{ ok: boolean; error?: string }> {
  const { settings, connected } = await getAmplitudeSettings(orgId);
  if (!connected || !settings) return { ok: false, error: "No credentials saved. Did you run migration 023 in Supabase?" };

  const today = new Date();
  const weekAgo = new Date(Date.now() - 7 * 864e5);

  try {
    const url = new URL(`${apiBase(settings)}/events/segmentation`);
    url.searchParams.set("e", JSON.stringify({ event_type: "__bios_ping__" }));
    url.searchParams.set("start", dateStr(weekAgo));
    url.searchParams.set("end", dateStr(today));

    const res = await fetch(url.toString(), { headers: { Authorization: authHeader(settings) } });

    if (!res.ok) {
      const txt = await res.text();
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "Authentication failed. Check that the API Key and Secret Key match the same project (Org Settings → Projects in Amplitude)." };
      }
      return { ok: false, error: `Amplitude ${res.status}: ${txt.slice(0, 400)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Fetch event counts for the last N days ──────────────────────────────────

export async function fetchAmplitudeEventCounts(
  orgId: string,
  eventNames: string[],
  days = 30
): Promise<{ counts?: Record<string, number>; error?: string }> {
  if (!eventNames.length) return { counts: {} };

  const { settings, connected } = await getAmplitudeSettings(orgId);
  if (!connected || !settings) return { error: "Amplitude not connected. Add your credentials in Settings." };

  const today = new Date();
  const fromDate = new Date(Date.now() - days * 864e5);

  try {
    const results = await Promise.all(
      eventNames.map(async (eventName) => {
        const url = new URL(`${apiBase(settings)}/events/segmentation`);
        url.searchParams.set("e", JSON.stringify({ event_type: eventName }));
        url.searchParams.set("start", dateStr(fromDate));
        url.searchParams.set("end", dateStr(today));

        const res = await fetch(url.toString(), { headers: { Authorization: authHeader(settings) } });
        if (!res.ok) return { eventName, count: 0, error: await res.text() };

        // Response shape per Amplitude's Dashboard REST API docs: data.series
        // is an array of per-segment arrays of numbers, one per date in
        // data.xValues. With no grouping there's normally just one inner
        // array, but sum across all of them defensively in case a project
        // has a default group-by configured.
        const json = await res.json() as { data?: { series?: number[][] }; error?: string };
        if (json.error) return { eventName, count: 0, error: json.error };

        const series = json.data?.series ?? [];
        const count = series.flat().reduce((sum, n) => sum + (n ?? 0), 0);
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

// ─── Sync Amplitude event names → events table ───────────────────────────────
// Uses the Taxonomy API, which is metadata-only (no usage cost) but — unlike
// everything else in this file — isn't on by default for every Amplitude
// plan; Amplitude's own docs say access has to be requested through your
// Customer Success Manager or support. That's surfaced as a specific error
// below rather than a generic failure, since "it's disabled for your plan"
// and "your credentials are wrong" need different fixes.

export async function syncAmplitudeEventNames(
  orgId: string
): Promise<{ synced: number; total: number; error?: string }> {
  const { settings, connected } = await getAmplitudeSettings(orgId);
  if (!connected || !settings) return { synced: 0, total: 0, error: "Amplitude not connected. Add credentials in Settings." };

  try {
    const url = new URL(`${apiBase(settings)}/taxonomy/event`);
    url.searchParams.set("limit", "1000");

    const res = await fetch(url.toString(), { headers: { Authorization: authHeader(settings) } });

    if (!res.ok) {
      const txt = await res.text();
      if (res.status === 401) {
        return { synced: 0, total: 0, error: "Amplitude 401: authentication failed. Check the API Key and Secret Key in Settings." };
      }
      if (res.status === 403 || res.status === 404) {
        return {
          synced: 0,
          total: 0,
          error: "The Taxonomy API isn't enabled for this Amplitude plan/project yet — ask Amplitude support or your CSM to turn it on. In the meantime, \"Sync raw events\" still works once you have real event volume.",
        };
      }
      return { synced: 0, total: 0, error: `Amplitude ${res.status}: ${txt.slice(0, 300)}` };
    }

    // The exact response shape for /taxonomy/event isn't fully nailed down in
    // public docs at the time this was written — parse defensively (bare
    // array, {data: [...]}, or {events: [...]}) rather than assuming one
    // shape and silently treating a real response as empty, which is exactly
    // the bug that hit the Mixpanel /events/names integration earlier.
    const json = await res.json() as
      | { event_type?: string; eventType?: string; name?: string }[]
      | { data?: { event_type?: string; eventType?: string; name?: string }[] }
      | { events?: { event_type?: string; eventType?: string; name?: string }[] }
      | { error?: string };

    if (!Array.isArray(json) && "error" in json && json.error) {
      return { synced: 0, total: 0, error: json.error };
    }

    const items = Array.isArray(json)
      ? json
      : "data" in json && Array.isArray(json.data)
      ? json.data
      : "events" in json && Array.isArray(json.events)
      ? json.events
      : [];

    const eventNames = items
      .map((i) => i.event_type ?? i.eventType ?? i.name)
      .filter((n): n is string => !!n);

    if (!eventNames.length) return { synced: 0, total: 0 };

    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("events")
      .select("name")
      .eq("organization_id", orgId)
      .filter("properties->>source", "eq", "amplitude")
      .in("name", eventNames);

    const existingNames = new Set((existing ?? []).map((r) => r.name as string));
    const toInsert = eventNames.filter((n) => !existingNames.has(n));

    if (toInsert.length > 0) {
      const now = new Date().toISOString();
      // Same is_placeholder convention as the Mixpanel connector — a
      // name-only stub with no real occurrence, excluded from every
      // KPI/goal/insight count query that filters on is_placeholder.
      const rows = toInsert.map((name) => ({
        organization_id: orgId,
        name,
        properties: { source: "amplitude", is_placeholder: true } as Record<string, unknown>,
        timestamp: now,
        user_id: null as string | null,
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
// Mirrors syncMixpanelRawEvents — pulls real per-occurrence rows (timestamp +
// user) for Feature Impact's trend-break and adopter/non-adopter comparisons,
// scoped to the event names passed in and capped at 90 days. Amplitude's
// Export API returns a ZIP of gzipped NDJSON files rather than Mixpanel's
// plain newline-delimited response, so there's an extra unzip+gunzip step.

export async function syncAmplitudeRawEvents(
  orgId: string,
  eventNames: string[],
  days = 60
): Promise<{ synced: number; error?: string }> {
  if (!eventNames.length) return { synced: 0 };

  const { settings, connected } = await getAmplitudeSettings(orgId);
  if (!connected || !settings) return { synced: 0, error: "Amplitude not connected. Add credentials in Settings." };

  const admin = createAdminClient();
  const { data: brand } = await admin
    .from("brand_settings")
    .select("amplitude_raw_synced_until")
    .eq("organization_id", orgId)
    .single();

  const cappedDays = Math.min(days, 90);
  const earliestAllowedMs = Date.now() - cappedDays * 864e5;
  const lastSyncMs = brand?.amplitude_raw_synced_until ? new Date(brand.amplitude_raw_synced_until).getTime() : null;
  const fromMs = lastSyncMs && lastSyncMs > earliestAllowedMs ? lastSyncMs : earliestAllowedMs;
  const toMs = Date.now();

  const wantedNames = new Set(eventNames);

  try {
    const url = new URL(exportUrl(settings));
    url.searchParams.set("start", dateHourStr(new Date(fromMs)));
    url.searchParams.set("end", dateHourStr(new Date(toMs)));

    const res = await fetch(url.toString(), { headers: { Authorization: authHeader(settings) } });

    if (!res.ok) {
      if (res.status === 404) {
        // Amplitude returns 404 for this endpoint when there's genuinely no
        // data in the requested window — not an error, just nothing to sync.
        await admin.from("brand_settings").update({ amplitude_raw_synced_until: new Date(toMs).toISOString() }).eq("organization_id", orgId);
        return { synced: 0 };
      }
      const txt = await res.text();
      if (res.status === 401 || res.status === 403) {
        return { synced: 0, error: "Amplitude authentication failed for raw export. Check your credentials in Settings." };
      }
      return { synced: 0, error: `Amplitude ${res.status}: ${txt.slice(0, 300)}` };
    }

    const zipBuffer = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(zipBuffer);

    type RawAmplitudeEvent = {
      event_type?: string;
      event_time?: string;
      user_id?: string | null;
      device_id?: string | null;
      [key: string]: unknown;
    };

    const rows: {
      organization_id: string;
      name: string;
      properties: Record<string, unknown>;
      user_id: string | null;
      session_id: string | null;
      timestamp: string;
    }[] = [];

    for (const file of Object.values(zip.files)) {
      if (file.dir) continue;
      // Each entry is itself gzip-compressed NDJSON — the ZIP layer only
      // wraps these, it doesn't decompress them.
      try {
        const gzipped = await file.async("nodebuffer");
        const text = zlib.gunzipSync(gzipped).toString("utf-8");
        const lines = text.split("\n").filter((l) => l.trim());

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as RawAmplitudeEvent;
            if (!parsed.event_type || !wantedNames.has(parsed.event_type)) continue;
            const timestamp = parsed.event_time ? new Date(parsed.event_time).toISOString() : new Date().toISOString();
            rows.push({
              organization_id: orgId,
              name: parsed.event_type,
              properties: { ...parsed, source: "amplitude" },
              user_id: parsed.user_id ?? parsed.device_id ?? null,
              session_id: null,
              timestamp,
            });
          } catch {
            // Skip malformed lines — best-effort, same as the Mixpanel sync.
          }
        }
      } catch {
        // Skip unreadable archive entries rather than failing the whole sync.
      }
    }

    if (!rows.length) {
      await admin.from("brand_settings").update({ amplitude_raw_synced_until: new Date(toMs).toISOString() }).eq("organization_id", orgId);
      return { synced: 0 };
    }

    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await admin.from("events").insert(chunk);
      if (error) return { synced: inserted, error: error.message };
      inserted += chunk.length;
    }

    await admin.from("brand_settings").update({ amplitude_raw_synced_until: new Date(toMs).toISOString() }).eq("organization_id", orgId);
    return { synced: inserted };
  } catch (err) {
    return { synced: 0, error: (err as Error).message };
  }
}
