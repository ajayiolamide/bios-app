"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient, createServerClient } from "@/lib/supabase/server";
import type { ReportSource, Report, BusinessGoal, CompanyObjective, FeatureMetric, Metric } from "@/types/database";
import { getFeatureImpactSummaries, type FeatureImpactResult } from "./feature-impact";
import { getFunnels, computeFunnel, type FunnelStepResult } from "./funnels";
import { getGoalProgress, type GoalProgress } from "./metrics";

// ─── Slide reference image upload ─────────────────────────────────────────────
//
// Lets a slide carry a reference image (e.g. a screenshot of a Mixpanel
// trend) purely as a visual attachment — image_url already existed on every
// slide type and was already rendered (slide-card.tsx), but nothing in the
// editor ever let a user actually set it. This does NOT analyze the image's
// content; the AI never sees it, it's just embedded into the slide the same
// way the company logo gets embedded.
export async function uploadSlideImage(
  orgId: string,
  formData: FormData
): Promise<{ url: string | null; error: string | null }> {
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { url: null, error: "No file provided" };

  const admin = createAdminClient();
  const ext = file.name.split(".").pop() || "png";
  // Unique filename per upload (not a fixed per-slide path) — same reasoning
  // as the logo fix: a reused path keeps the same public URL forever, which
  // a CDN can keep serving stale bytes for after a re-upload. A brand-new
  // URL every time sidesteps that with no cache-busting trick needed.
  const path = `${orgId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await admin.storage.from("slide-images").upload(path, file, {
    contentType: file.type || undefined,
  });
  if (error) {
    return {
      url: null,
      error: error.message?.toLowerCase().includes("bucket not found")
        ? "Upload storage isn't set up yet — run the latest database migration, then try again."
        : `Upload failed: ${error.message}`,
    };
  }

  const { data } = admin.storage.from("slide-images").getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

// ─── BIOS context types ───────────────────────────────────────────────────────

export type BiosSections = {
  goals?: boolean;
  features?: boolean;
  funnelsKpis?: boolean;
  // "User Journey" in the UI — the real Funnels table (sequential step
  // conversion), distinct from `funnelsKpis` above which (despite its name)
  // only ever pulled the `metrics` table, never actual funnels. Kept as a
  // separate flag rather than folding into funnelsKpis so existing reports
  // that already had that box checked don't suddenly start including a new
  // section they never asked for.
  funnels?: boolean;
};

export type FunnelSummary = {
  name: string;
  description: string | null;
  lookbackDays: number;
  steps: FunnelStepResult[];
};

export type BiosContext = {
  // Company Objectives — the top-level Business Goal (Objective layer above Product Goals).
  // Fetched alongside goals so the AI can reference the overarching objective even when
  // there are no Product Goals (business_goals rows) yet.
  objectives?: CompanyObjective[];
  goals?: BusinessGoal[];
  // Keyed by business_goals.id — same computation the Goals page and
  // Dashboard already use (getGoalProgress) to show each goal's real
  // actual-vs-target progress. Without this, the goals fetched above were
  // only ever passed to the AI as metadata (title/type/target text), with
  // no live number behind them — meaning a goal with no linked, measurable
  // KPI had absolutely nothing numeric anywhere in the entire prompt, and
  // the "every slide needs real numbers" design rule below gave the AI
  // every reason to quietly drop it rather than write a number-free slide.
  goalProgress?: Record<string, GoalProgress>;
  features?: FeatureMetric[];
  // Actual metrics rows linked to features (feature_metric_id IS NOT NULL).
  // Fetched alongside features so the AI gets real event names, aggregations,
  // and targets per feature — not just the feature name and success blurb.
  featureKpis?: Metric[];
  metrics?: Metric[];
  featureImpact?: FeatureImpactResult[];
  funnels?: FunnelSummary[];
};

export async function getBiosReportData(
  orgId: string,
  sections: BiosSections
): Promise<BiosContext> {
  const admin = createAdminClient();
  const result: BiosContext = {};

  const promises: Promise<void>[] = [];

  if (sections.goals) {
    // Fetch Company Objectives (top-level Business Goal tier) — report is valid
    // even when there are no Product Goals yet, as long as an Objective exists.
    promises.push(
      admin
        .from("company_objectives")
        .select("*")
        .eq("organization_id", orgId)
        .neq("status", "dropped")
        .order("created_at", { ascending: false })
        .then(({ data }) => { result.objectives = (data ?? []) as CompanyObjective[]; })
    );
    promises.push(
      admin
        .from("business_goals")
        .select("*")
        .eq("organization_id", orgId)
        // "dropped" is how a goal gets deleted in this app (soft-delete) — it
        // should never reappear in a generated report. Achieved/missed goals
        // are kept since their outcome is legitimate report context.
        .neq("status", "dropped")
        .order("created_at", { ascending: false })
        .then(({ data }) => { result.goals = (data ?? []) as BusinessGoal[]; })
    );
    // Same real actual-vs-target computation already powering the Goals
    // page and Dashboard — see the BiosContext.goalProgress comment above
    // for why this was missing before.
    promises.push(
      getGoalProgress(orgId)
        .then((progress) => { result.goalProgress = progress; })
        .catch(() => { result.goalProgress = {}; })
    );
  }

  if (sections.features) {
    promises.push(
      admin
        .from("feature_metrics")
        .select("*")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .then(({ data }) => { result.features = (data ?? []) as FeatureMetric[]; })
    );
    // Best-effort — real impact verdicts (not just nominal goal ties) for launched
    // features. Skipped silently if it errors; the deck still works without it.
    promises.push(
      getFeatureImpactSummaries(orgId)
        .then((summaries) => { result.featureImpact = summaries.filter(s => s.status === "computed"); })
        .catch(() => { result.featureImpact = []; })
    );
    // Fetch the actual metrics/KPI rows that are linked to specific features
    // (feature_metric_id IS NOT NULL). This is how the AI knows which events
    // to reference per feature — the suggestions JSONB has planned targets,
    // but these rows are the live tracking config (event name, aggregation,
    // target value, guardrails, etc.). Without this, "Feature Metrics" reports
    // only got feature names + a 80-char success blurb — nothing numeric.
    promises.push(
      admin
        .from("metrics")
        .select("*")
        .eq("organization_id", orgId)
        .not("feature_metric_id", "is", null)
        .then(({ data }) => { result.featureKpis = (data ?? []) as Metric[]; })
        .catch(() => { result.featureKpis = []; })
    );
  }

  if (sections.funnelsKpis) {
    promises.push(
      admin
        .from("metrics")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .then(({ data }) => { result.metrics = (data ?? []) as Metric[]; })
    );
  }

  if (sections.funnels) {
    // Real sequential-step funnels (the "User Journey" data) — distinct from
    // funnelsKpis above. Computed live, same as opening the Funnels page —
    // each funnel's current step-by-step conversion, not a stored snapshot.
    promises.push(
      getFunnels(orgId).then(async (funnels) => {
        const computed = await Promise.all(
          funnels.map(async (f) => {
            const steps = await computeFunnel(orgId, f.steps, f.lookback_days).catch(() => []);
            return { name: f.name, description: f.description, lookbackDays: f.lookback_days, steps };
          })
        );
        // Skip funnels that resolved to no data at all rather than padding
        // the report with empty step lists.
        result.funnels = computed.filter((f) => f.steps.length > 0);
      }).catch(() => { result.funnels = []; })
    );
  }

  await Promise.all(promises);
  return result;
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Lenient CSV parser ───────────────────────────────────────────────────────

function parseCSV(raw: string): Record<string, string>[] {
  const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n").filter(l => l.trim() !== "");
  if (lines.length < 2) return [];

  function parseLine(line: string): string[] {
    const cells: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuote = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') { inQuote = true; }
        else if (ch === ',') { cells.push(cur.trim()); cur = ""; }
        else { cur += ch; }
      }
    }
    cells.push(cur.trim());
    return cells;
  }

  const headers = parseLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] ?? ""; });
    rows.push(row);
  }
  return rows;
}

// ─── Sources ──────────────────────────────────────────────────────────────────

export async function getReportSources(orgId: string): Promise<ReportSource[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("report_sources")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function saveReportSource(
  orgId: string,
  name: string,
  sheetUrl: string
): Promise<{ id: string | null; error: string | null }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("report_sources")
    .insert({ organization_id: orgId, name: name.trim(), sheet_url: sheetUrl.trim() })
    .select("id")
    .single();
  return { id: data?.id ?? null, error: error?.message ?? null };
}

export async function deleteReportSource(sourceId: string): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const { error } = await admin.from("report_sources").delete().eq("id", sourceId);
  return { error: error?.message ?? null };
}

// ─── Parameter / insight configuration ───────────────────────────────────────

export type DataParameter = {
  id: string;
  name: string;           // "Claims Ratio"
  description: string;    // "% of claims approved out of total"
  column?: string;        // header column in the CSV
  aggregation: "sum" | "avg" | "count" | "min" | "max" | "ratio" | "custom";
  formula?: string;       // for ratio/custom: e.g. "approved / total * 100"
};

export async function updateReportSourceConfig(
  sourceId: string,
  config: {
    data_type?: string;
    parameters?: DataParameter[];
    expected_insights?: string[];
  }
): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("report_sources")
    .update({
      data_type: config.data_type ?? null,
      parameters: (config.parameters ?? []) as never,
      expected_insights: (config.expected_insights ?? []) as never,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sourceId);
  return { error: error?.message ?? null };
}

// ─── AI: suggest source config from the actual connected sheet ───────────────
// Until now, "Data Type" was a fixed list of insurance-flavored guesses
// (Claims, Insurance Policies, etc.) with zero relationship to what's
// actually in the sheet, and "Sheet column" was free text nobody validated
// against real headers. This reads the sheet's real column names and a
// handful of real sample rows and asks the model to propose a data type and
// a first draft of parameters that reference columns that genuinely exist —
// a starting point to edit, not something auto-applied.

export async function suggestSourceConfig(
  sheetName: string,
  headers: string[],
  sampleRows: Record<string, string>[]
): Promise<{
  dataType?: string;
  parameters?: DataParameter[];
  expectedInsights?: string[];
  error?: string;
}> {
  if (headers.length === 0) {
    return { error: "No columns found — sync the sheet first so there's real data to read." };
  }

  const sampleBlock = sampleRows.slice(0, 5)
    .map((r, i) => `Row ${i + 1}: ${headers.map(h => `${h}=${r[h] ?? ""}`).join(", ")}`)
    .join("\n");

  const prompt = `You're configuring an AI reporting tool to read a spreadsheet called "${sheetName}".

Real columns in this sheet: ${headers.join(", ")}

Real sample rows:
${sampleBlock || "(no rows available)"}

Your task: based ONLY on these actual columns and values (don't invent data that isn't there), propose:
1. "data_type": a short label for what kind of data this is (e.g. "Auto Insurance Claims", "SaaS Subscriptions") — specific to what you actually see, not generic.
2. "parameters": 2-5 metrics worth tracking from this real data. Each needs:
   - "name": short metric name
   - "description": 1 sentence on what it means and why it matters
   - "column": the EXACT column name from the list above that holds the raw value — null if it requires combining multiple columns
   - "aggregation": one of "sum","avg","count","min","max","ratio","custom"
   - "formula": only if aggregation is "ratio" or "custom" — e.g. "approved / total * 100", referencing real column names
3. "expected_insights": 2-3 business questions this data should be able to answer.

Respond with ONLY valid JSON, no markdown:
{
  "data_type": "string",
  "parameters": [{ "name": "string", "description": "string", "column": "string | null", "aggregation": "sum" | "avg" | "count" | "min" | "max" | "ratio" | "custom", "formula": "string | null" }],
  "expected_insights": ["string"]
}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = (msg.content[0] as { type: string; text: string }).text.trim();
    const json = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(json) as {
      data_type?: string;
      parameters?: { name: string; description: string; column: string | null; aggregation: DataParameter["aggregation"]; formula: string | null }[];
      expected_insights?: string[];
    };

    // Drop any suggested column that doesn't actually exist in the sheet —
    // better to leave it blank than silently point at a column that isn't
    // real, which is exactly the bug this feature exists to fix.
    const headerSet = new Set(headers);
    const parameters: DataParameter[] = (parsed.parameters ?? []).map((p) => ({
      id: crypto.randomUUID(),
      name: p.name,
      description: p.description,
      column: p.column && headerSet.has(p.column) ? p.column : undefined,
      aggregation: p.aggregation,
      formula: p.formula ?? undefined,
    }));

    return {
      dataType: parsed.data_type,
      parameters,
      expectedInsights: parsed.expected_insights ?? [],
    };
  } catch (err) {
    console.error("[suggestSourceConfig]", err);
    return { error: "Failed to generate suggestions from this sheet. Try again." };
  }
}

// ─── Fetch & cache ────────────────────────────────────────────────────────────

export async function fetchSheetData(
  sourceId: string
): Promise<{ rows: Record<string, string>[]; headers: string[]; error: string | null }> {
  const admin = createAdminClient();
  const { data: source } = await admin
    .from("report_sources")
    .select("*")
    .eq("id", sourceId)
    .single();
  if (!source) return { rows: [], headers: [], error: "Source not found" };
  try {
    const res = await fetch(source.sheet_url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentType = res.headers.get("content-type") ?? "";
    const text = await res.text();

    // The CSV parser is lenient by design (real spreadsheet exports are
    // messy), which means it will happily chop up a webpage or a JS bundle
    // into "rows" and "columns" if the URL doesn't actually point at a CSV —
    // e.g. an expired "publish to web" link that now redirects to a Google
    // sign-in page, or a regular (non-published) Sheets URL pasted by
    // mistake. That garbage then looks like real data everywhere downstream.
    // Catch it here, before it's cached or shown anywhere.
    const looksLikeHtml = /<!doctype html|<html[\s>]/i.test(text.slice(0, 500));
    if (contentType.includes("text/html") || looksLikeHtml) {
      throw new Error(
        "This URL returned a webpage, not CSV data — the published link may have expired, or this is a regular Sheets URL instead of the published CSV one. In Google Sheets: File → Share → Publish to web → choose CSV → use that link."
      );
    }

    const rows = parseCSV(text);
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    await admin
      .from("report_sources")
      .update({ cached_data: rows as never, last_fetched_at: new Date().toISOString() })
      .eq("id", sourceId);
    return { rows, headers, error: null };
  } catch (err) {
    return { rows: [], headers: [], error: (err as Error).message };
  }
}

export async function getCachedSheetData(
  sourceId: string
): Promise<{ rows: Record<string, string>[]; headers: string[]; error: string | null }> {
  const admin = createAdminClient();
  const { data: source } = await admin
    .from("report_sources")
    .select("cached_data, last_fetched_at")
    .eq("id", sourceId)
    .single();
  if (!source?.cached_data) return { rows: [], headers: [], error: null };
  const rows = source.cached_data as Record<string, string>[];
  return { rows, headers: rows.length > 0 ? Object.keys(rows[0]) : [], error: null };
}

// ─── Reports history ──────────────────────────────────────────────────────────

export async function getReports(orgId: string): Promise<Report[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("reports")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function deleteReport(reportId: string): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const { error } = await admin.from("reports").delete().eq("id", reportId);
  return { error: error?.message ?? null };
}

// ─── Slide types ──────────────────────────────────────────────────────────────

// Per-slide reference image position/size, as percentages (0-100) of the
// slide's box — independent x/y/w/h (not aspect-locked) so a screenshot can
// be freely placed and stretched. Optional: when unset, the slide-card
// renderer and buildPptx both fall back to their original fixed-position
// behavior, so any image attached before this feature existed still renders
// exactly as before.
type ImagePosition = { image_x?: number; image_y?: number; image_w?: number; image_h?: number; image_layout?: "overlay" | "right-panel" | "left-panel" | "bottom" };

export type SlideContent =
  | { type: "title"; headline: string; subtitle: string; image_url?: string }
  | ({ type: "big_stat"; label: string; value: string; change: string; change_direction: "up" | "down" | "flat"; context: string; narrative?: string; image_url?: string } & ImagePosition)
  | ({ type: "bar_chart"; title: string; subtitle: string; orientation: "vertical" | "horizontal"; series: { label: string; value: number; target?: number }[]; image_url?: string } & ImagePosition)
  | ({ type: "line_chart"; title: string; subtitle: string; series: { label: string; value: number }[]; image_url?: string } & ImagePosition)
  | ({ type: "pie_chart"; title: string; subtitle: string; style: "pie" | "donut"; segments: { label: string; value: number }[]; image_url?: string } & ImagePosition)
  | ({ type: "progress_bars"; title: string; items: { label: string; value: number; target: number; unit: string; status: "on_track" | "off_track" | "neutral" }[]; image_url?: string } & ImagePosition)
  | ({ type: "kpi_grid"; title: string; kpis: { label: string; value: string; target: string; status: "on_track" | "off_track" | "neutral" }[]; image_url?: string } & ImagePosition)
  | ({ type: "insight"; title: string; body: string; stat: string; stat_label: string; status: "positive" | "negative" | "neutral"; stat_width?: "narrow" | "balanced" | "wide"; image_url?: string } & ImagePosition)
  | ({ type: "stat_narrative"; title: string; stat: string; stat_label: string; change: string; change_direction: "up" | "down" | "flat"; narrative: string; status: "positive" | "negative" | "neutral"; image_url?: string } & ImagePosition)
  | ({ type: "bullet_list"; title: string; items: string[]; image_url?: string } & ImagePosition)
  | ({
      type: "action_plan";
      title: string;
      subtitle?: string;
      items: {
        department: string;       // e.g. "Product & Growth", "Marketing", "Design" — only depts actually implicated by the data
        recommendation: string;   // concrete next step, max ~14 words
        rationale: string;        // why this department, tied to a specific metric/insight from this deck, max ~18 words
        priority: "high" | "medium" | "low";
      }[];
      image_url?: string;
    } & ImagePosition)
  | { type: "closing"; headline: string; subtitle: string; image_url?: string };

export type SlidesDeck = { title: string; slides: SlideContent[] };

export type DesignTheme = "brand" | "midnight" | "clean";

// ─── Phase 1: Plan (AI → JSON only, cheap) ───────────────────────────────────

export type SourceConfig = {
  sourceId: string;
  sourceName: string;
  data_type?: string | null;
  parameters?: DataParameter[];
  expected_insights?: string[];
};

export type SlideGuide = {
  slideIndex: number;  // 1-based
  focus?: string;      // e.g. "Claims ratio trend"
  mustInclude?: string[];  // parameter/insight names that MUST appear
  chartType?: string;  // e.g. "bar", "line", "pie", "donut", "area", "table"
};

export async function planReport(
  orgId: string,
  templateId: string,
  filteredRows: Record<string, string>[],
  period: string,
  extraNotes?: string,
  biosSections?: BiosSections,
  sourceConfigs?: SourceConfig[],
  slideGuides?: SlideGuide[]
): Promise<{ deck: SlidesDeck | null; tokensUsed: number; model: string; error: string | null }> {
  try {
  const admin = createAdminClient();

  const { data: template } = await admin
    .from("report_templates")
    .select("*")
    .eq("id", templateId)
    .single();
  if (!template) return { deck: null, tokensUsed: 0, model: "", error: "Template not found" };

  const { data: brand } = await admin
    .from("brand_settings")
    .select("company_name")
    .eq("organization_id", orgId)
    .single();

  const companyName = brand?.company_name ?? "Company";
  const headers = filteredRows.length > 0 ? Object.keys(filteredRows[0]).join(" | ") : "";
  const csvPreview = filteredRows
    .slice(0, 60)
    .map(row => Object.values(row).join(" | "))
    .join("\n");

  // Fetch BIOS data server-side if sections are requested
  let biosContext: BiosContext | undefined;
  try {
    if (biosSections) biosContext = await getBiosReportData(orgId, biosSections);
  } catch (e) {
    console.error("[planReport] getBiosReportData failed:", e);
    // Non-fatal — continue without BIOS context
  }

  // ── Refuse to generate when there is nothing real to report on ────────────
  // The client only checks "is a BIOS section toggled or are there rows" —
  // it can't know whether that section actually resolved to any data (e.g.
  // the user disconnected Mixpanel and cleared events, but a goals/features
  // checkbox was still ticked). Without this check, the prompt below still
  // says "Generate exactly N slides," and an instruction-following model
  // will invent plausible-looking numbers to comply rather than refuse —
  // that's the hallucination the user is hitting. Checking here, against
  // what was actually fetched rather than what was requested, is the only
  // place that can catch it.
  const hasSheetData = filteredRows.length > 0;
  const hasBiosData = !!biosContext && (
    (biosContext.objectives?.length ?? 0) > 0 ||  // Company Objectives count as real data
    (biosContext.goals?.length ?? 0) > 0 ||
    (biosContext.features?.length ?? 0) > 0 ||
    (biosContext.metrics?.length ?? 0) > 0 ||
    (biosContext.featureImpact?.length ?? 0) > 0 ||
    (biosContext.funnels?.length ?? 0) > 0
  );
  if (!hasSheetData && !hasBiosData) {
    return {
      deck: null,
      tokensUsed: 0,
      model: "",
      error: "No data available to generate this report. Connect a data source, sync Mixpanel, or add Business Goals / Feature Metrics — there's nothing real to report on right now.",
    };
  }

  // Build scope restriction instruction — tells the AI exactly what sections it may use
  let scopeRestrictionBlock = "";
  // Hoisted so the sourceConfigBlock builder below can also check it —
  // sourceConfigs carries sheet parameter names + expected insights that
  // bleed into the prompt the same way filteredRows does.
  let isScopedMode = false;
  if (biosSections) {
    const included: string[] = [];
    const excluded: string[] = [];
    if (biosSections.goals) included.push("Business Goals"); else excluded.push("Business Goals");
    if (biosSections.features) included.push("Feature Metrics"); else excluded.push("Feature Metrics");
    if (biosSections.funnelsKpis) included.push("KPIs & Metrics"); else excluded.push("KPIs & Metrics");
    if (biosSections.funnels) included.push("User Journeys / Funnels"); else excluded.push("User Journeys / Funnels");
    const excl = excluded.length > 0 ? ` Do NOT generate any slides about: ${excluded.join(", ")}.` : "";
    scopeRestrictionBlock = `\nSCOPE RESTRICTION: This report covers ONLY: ${included.join(", ")}.${excl} Slides that reference excluded sections will be rejected — strictly omit them.\n`;

    // Detect single-section scoped modes — when only ONE section is active,
    // we add a FOCUS MODE instruction and strip the Excel sheet data entirely.
    // Sheet data is org-wide (NSM, business metrics) and bleeds into every
    // scoped report even when the scope instruction says not to use it.
    // The only time sheet data belongs in the prompt is for a Full Review
    // (all sections) or when there's no BIOS scope at all (sheet-only report).
    const goalsOnly    = biosSections.goals    && !biosSections.features && !biosSections.funnelsKpis && !biosSections.funnels;
    const featureOnly  = biosSections.features && !biosSections.goals    && !biosSections.funnelsKpis && !biosSections.funnels;
    const kpisOnly     = biosSections.funnelsKpis && !biosSections.goals && !biosSections.features    && !biosSections.funnels;
    const funnelsOnly  = biosSections.funnels  && !biosSections.goals    && !biosSections.features    && !biosSections.funnelsKpis;
    isScopedMode = goalsOnly || featureOnly || kpisOnly || funnelsOnly;

    if (goalsOnly) {
      scopeRestrictionBlock += `GOALS FOCUS MODE: Build EVERY slide around the Business Goals listed above — their KPIs, progress vs targets, and trends. Do NOT reference Feature Metrics, funnels, or generic sheet metrics. If a slide cannot be grounded in a specific goal or its KPIs, omit it.\n`;
    }
    if (featureOnly) {
      scopeRestrictionBlock += `FEATURE FOCUS MODE: Build EVERY slide around the specific features listed in FEATURE TRACKING PLANS above — their KPIs, events, launch status, and success/failure signals. Do NOT pad with generic product or business metrics that are not explicitly tied to one of these features. If a slide cannot be grounded in a specific feature from the list, omit it.\n`;
    }
    if (kpisOnly) {
      scopeRestrictionBlock += `KPI FOCUS MODE: Build EVERY slide around the KPIs & Metrics listed above — their actual values, targets, trends, and what the numbers mean for the business. Do NOT reference goals or feature-level tracking unless a KPI is explicitly linked to one. If a slide cannot be grounded in a specific KPI from the list, omit it.\n`;
    }
    if (funnelsOnly) {
      scopeRestrictionBlock += `USER JOURNEYS FOCUS MODE: Build EVERY slide around the funnels and user journey data listed above — conversion rates at each step, drop-off points, and where users lose momentum. Do NOT reference goals, features, or generic business metrics. Each slide must trace back to a specific funnel step or journey segment.\n`;
    }

    // Strip sheet data for any scoped (single-section) report. Sheet data is
    // org-wide and will always bleed into the AI output regardless of prompt
    // instructions — removing it physically from the prompt is the only reliable fix.
    if (isScopedMode) {
      filteredRows = [];
    }
  }

  // Per-section depth instructions — one slide minimum per entity in scoped modes
  let perFeatureBlock = "";
  // effectiveSlideHint may be bumped above the template default to fit the data
  let effectiveSlideHint = template.slide_hint;

  if (
    biosSections?.features &&
    !biosSections?.goals &&
    !biosSections?.funnelsKpis &&
    !biosSections?.funnels &&
    biosContext?.features?.length
  ) {
    const n = biosContext.features.length;
    // Ensure there's slide budget for each feature (plus title + action_plan + closing)
    effectiveSlideHint = Math.max(template.slide_hint, n + 3);
    perFeatureBlock = `\nFEATURE SLIDE ALLOCATION: You MUST generate at least one dedicated slide per feature (${n} feature${n === 1 ? "" : "s"} listed above = minimum ${n} feature slide${n === 1 ? "" : "s"} required).

For EACH feature slide you MUST include ALL FOUR of the following — no exceptions:

1. FEATURE NAME + STATUS — name exactly as it appears in the data, launch status in plain English (e.g. "In Progress", "Launched 14 Jan 2025", "Paused").

2. REAL PROGRESS NUMBER — read the ★ ACTUAL KPI RATE or ★ ACTUAL POST-LAUNCH line from FEATURE TRACKING PLANS above and cite it verbatim (e.g. "87% of claims paid within 48h", "+14.6% lift vs non-adopters", "+22% vs predicted trend"). If the ★ line says "NOT YET MEASURED", write exactly that — never invent a number.

3. VERDICT — exactly one of these four words, derived from the ★ VERDICT line for this feature (do NOT invent a verdict the data doesn't support):
   • "Moved" — use when ★ VERDICT says MOVED (positive)
   • "Didn't move" — use when ★ VERDICT says DIDN'T MOVE (negative)
   • "Inconclusive" — use when ★ VERDICT says INCONCLUSIVE
   • "Not yet measured" — use when ★ VERDICT says NOT YET MEASURED

4. ONE SPECIFIC INSIGHT OR NEXT STEP — concrete action for the team, tied directly to the numbers on this slide (e.g. "Adoption is at 23% — run a push notification campaign targeting users who've started but not completed a claim"). Do not write generic advice; tie it to a specific number from this feature's data.

SLIDE TYPE GUIDANCE per verdict:
- "Moved": prefer stat_narrative (big number + business story) or insight slide
- "Didn't move": prefer insight slide with negative status, or stat_narrative — explain what was expected vs what happened
- "Inconclusive": prefer insight or bullet_list — explain what's ambiguous and what to watch next
- "Not yet measured": prefer insight slide — state what's planned and what to track when it launches

Do NOT combine multiple features on a single slide unless they are direct A/B variants of each other (label such slides explicitly as a comparison). If you run out of slide budget, exceed the suggested count rather than omit a feature.\n`;
  }

  if (
    biosSections?.goals &&
    !biosSections?.features &&
    !biosSections?.funnelsKpis &&
    !biosSections?.funnels &&
    biosContext?.goals?.length
  ) {
    const n = biosContext.goals.length;
    effectiveSlideHint = Math.max(template.slide_hint, n + 3);
    perFeatureBlock += `\nGOALS SLIDE ALLOCATION: You MUST generate at least one dedicated slide per Business Goal (${n} goal${n === 1 ? "" : "s"} listed above = minimum ${n} goal slide${n === 1 ? "" : "s"} required). For EACH goal slide include ALL of:
1. Goal title + current status (active / at risk / off track / achieved)
2. Progress against target — use the actual % figure from the BUSINESS GOALS section above; if not measurable yet, say so explicitly
3. The KPI(s) driving this goal and their current trend (up / down / flat)
4. One concrete recommendation for what the team should do to close the gap (or sustain momentum if on track)
Do NOT combine unrelated goals on a single slide. If you run out of slide budget, exceed the suggested count rather than omit a goal.\n`;
  }

  if (
    biosSections?.funnelsKpis &&
    !biosSections?.goals &&
    !biosSections?.features &&
    !biosSections?.funnels &&
    biosContext?.metrics?.length
  ) {
    const n = biosContext.metrics.length;
    effectiveSlideHint = Math.max(template.slide_hint, Math.min(n, 8) + 3);
    perFeatureBlock += `\nKPI SLIDE ALLOCATION: You MUST give each key KPI its own focused slide or at least a prominent section within a combined slide. Prioritise KPIs that are off-target or trending down — these must each have their own slide. For EACH KPI include: current value + target, trend direction, and one concrete action or hypothesis. Do not aggregate KPIs into a single table slide if there are fewer than 5; give each the depth it deserves.\n`;
  }

  if (
    biosSections?.funnels &&
    !biosSections?.goals &&
    !biosSections?.features &&
    !biosSections?.funnelsKpis &&
    biosContext?.funnels?.length
  ) {
    const n = biosContext.funnels.length;
    effectiveSlideHint = Math.max(template.slide_hint, n + 3);
    perFeatureBlock += `\nFUNNEL SLIDE ALLOCATION: You MUST generate at least one dedicated slide per funnel (${n} funnel${n === 1 ? "" : "s"} = minimum ${n} slide${n === 1 ? "" : "s"} required). For EACH funnel slide include: funnel name, conversion rate at each step with the biggest drop-off clearly highlighted, the step that loses the most users, and one concrete recommendation to improve it. Use bar_chart or a step-by-step layout — never bury funnel data in a text-only slide.\n`;
  }

  // Build BIOS context block
  let biosBlock = "";
  if (biosContext) {
    const parts: string[] = [];

    if (biosContext.objectives && biosContext.objectives.length > 0) {
      parts.push(`COMPANY OBJECTIVES (top-level Business Goal${biosContext.objectives.length === 1 ? "" : "s"} — the big strategic bets this organisation is making. Every deck slide should ladder up to one of these):\n` +
        biosContext.objectives.map(o =>
          `- [OBJECTIVE] ${o.title}${o.description ? ` — ${o.description}` : ""}${o.target ? ` | Target: ${o.target}` : ""}${o.timeframe ? ` | Timeframe: ${o.timeframe}` : ""} | Status: ${o.status}`
        ).join("\n")
      );
    }

    if (biosContext.goals && biosContext.goals.length > 0) {
      parts.push(`PRODUCT GOALS (${biosContext.goals.length} — EVERY one of these MUST be mentioned somewhere in the deck, even briefly. A goal with no measurable KPI yet is still real content — say so plainly (e.g. group it with others into one kpi_grid/bullet_list slide titled something like "Goal tracking status") instead of silently leaving it out just because it has no chart-able number of its own):\n` +
        biosContext.goals.slice(0, 20).map(g => {
          const gp = biosContext.goalProgress?.[g.id];
          const progressStr = gp && gp.progressRatio != null
            ? `${Math.round(gp.progressRatio * 100)}% of target (avg across ${gp.measurableKpiCount} measurable KPI${gp.measurableKpiCount === 1 ? "" : "s"})`
            : gp && gp.totalKpiCount > 0
            ? `not yet measurable — ${gp.totalKpiCount} KPI${gp.totalKpiCount === 1 ? "" : "s"} attached but none has both a real event/value AND a numeric target set`
            : `not yet measurable — no KPI attached to this goal yet`;
          return `- [${(g.status ?? "active").toUpperCase()}] ${g.title} | Type: ${g.type} | Progress: ${progressStr} | Target: ${g.target ?? "not set"} | Timeframe: ${g.timeframe ?? "not set"}`;
        }).join("\n")
      );
    }

    if (biosContext.features && biosContext.features.length > 0) {
      // Build a lookup from feature_metric_id → metrics[] so we can attach
      // the real tracked KPIs/guardrails to each feature in the prompt.
      const featureKpiMap: Record<string, Metric[]> = {};
      (biosContext.featureKpis ?? []).forEach(m => {
        if (m.feature_metric_id) {
          featureKpiMap[m.feature_metric_id] = featureKpiMap[m.feature_metric_id] ?? [];
          featureKpiMap[m.feature_metric_id].push(m);
        }
      });

      // Build a lookup from feature name → impact result so we can inline
      // the computed verdict + actual rate directly into each feature's entry.
      // Matching by name (case-insensitive) because featureImpact doesn't carry
      // the feature_metric_id — it uses the name from the feature row.
      const impactByName = new Map(
        (biosContext.featureImpact ?? []).map(fi => [fi.featureName.toLowerCase(), fi])
      );

      const featureLines = biosContext.features.slice(0, 10).map(f => {
        const lines: string[] = [];
        const launchParts = [
          f.launch_status ? `status: ${f.launch_status.replace(/_/g, " ")}` : null,
          f.actual_launch_date ? `launched: ${f.actual_launch_date}` : f.planned_launch_date ? `planned launch: ${f.planned_launch_date}` : null,
        ].filter(Boolean);
        const launchStr = launchParts.length > 0 ? ` [${launchParts.join(", ")}]` : "";
        lines.push(`- ${f.feature_name} (${f.sector ?? "general"})${launchStr}`);
        if (f.success_definition) lines.push(`  Success: ${f.success_definition}`);
        if (f.failure_definition) lines.push(`  Failure signal: ${f.failure_definition}`);

        // Prefer linked actual metrics rows — these have real event names + targets
        const linkedMetrics = featureKpiMap[f.id] ?? [];
        if (linkedMetrics.length > 0) {
          const kpis     = linkedMetrics.filter(m => m.kind === "kpi");
          const metrics  = linkedMetrics.filter(m => m.kind === "metric");
          const guards   = linkedMetrics.filter(m => m.kind === "guardrail");
          const formatM  = (m: Metric) => {
            const parts: string[] = [`[${m.kind?.toUpperCase() ?? "KPI"}] ${m.name}`];
            if (m.event_name) parts.push(`event: ${m.event_name}`);
            if (m.denominator_event_name) parts.push(`÷ ${m.denominator_event_name}`);
            if (m.target) parts.push(`target: ${m.target}`);
            if (m.target_value != null) parts.push(`target value: ${m.target_value}`);
            return `    ${parts.join(" | ")}`;
          };
          if (kpis.length > 0) {
            lines.push(`  KPIs (${kpis.length}):`);
            kpis.forEach(m => lines.push(formatM(m)));
          }
          if (metrics.length > 0) {
            lines.push(`  Metrics (${metrics.length}):`);
            metrics.forEach(m => lines.push(formatM(m)));
          }
          if (guards.length > 0) {
            lines.push(`  Guardrails (${guards.length}):`);
            guards.forEach(m => lines.push(formatM(m)));
          }
        } else if (f.suggestions && f.suggestions.length > 0) {
          // Fall back to AI-suggested planned metrics from feature setup wizard
          const kpis    = f.suggestions.filter(s => s.type === "kpi");
          const metrics = f.suggestions.filter(s => s.type === "metric");
          const guards  = f.suggestions.filter(s => s.type === "guardrail");
          const formatS = (s: { name: string; event_name: string | null; target: string | null; type: string }) =>
            `    [${s.type.toUpperCase()}] ${s.name}${s.event_name ? ` | event: ${s.event_name}` : ""}${s.target ? ` | target: ${s.target}` : ""}`;
          if (kpis.length > 0) {
            lines.push(`  Planned KPIs (${kpis.length}) — not yet linked to live tracking:`);
            kpis.slice(0, 5).forEach(s => lines.push(formatS(s)));
          }
          if (metrics.length > 0) {
            lines.push(`  Planned metrics (${metrics.length}):`);
            metrics.slice(0, 4).forEach(s => lines.push(formatS(s)));
          }
          if (guards.length > 0) {
            lines.push(`  Planned guardrails: ${guards.map(g => g.name + (g.event_name ? ` (${g.event_name})` : "")).join(", ")}`);
          }
        }

        // Inline the computed impact verdict + actual numbers directly under each
        // feature so the AI gets verdict + real figure in one place, not spread
        // across two separate prompt sections it has to mentally join.
        const impact = impactByName.get(f.feature_name.toLowerCase());
        if (impact?.verdict) {
          const verdictLabel =
            impact.verdict === "likely_positive"  ? "MOVED (positive)" :
            impact.verdict === "likely_negative"  ? "DIDN'T MOVE (negative)" :
            impact.verdict === "inconclusive"     ? "INCONCLUSIVE" : impact.verdict;
          lines.push(`  ★ VERDICT: ${verdictLabel}`);
          if (impact.cohort) {
            lines.push(`  ★ ACTUAL KPI RATE: adopters = ${impact.cohort.adopterKpiRate}% vs non-adopters = ${impact.cohort.nonAdopterKpiRate}% → ${impact.cohort.liftPct >= 0 ? "+" : ""}${impact.cohort.liftPct}% lift`);
            if (impact.cohort.guardrailRegressed) {
              lines.push(`  ★ GUARDRAIL CONCERN: ${impact.cohort.guardrailEventName} fires more often among adopters — flag this.`);
            }
          } else if (impact.trend) {
            lines.push(`  ★ ACTUAL POST-LAUNCH: ${impact.trend.actualPostDailyAvg}/day vs ${impact.trend.predictedPostDailyAvg}/day predicted (${impact.trend.deltaPct >= 0 ? "+" : ""}${impact.trend.deltaPct}% vs trend)`);
          }
        } else {
          lines.push(`  ★ VERDICT: NOT YET MEASURED — feature may not have launched, or no KPI event is wired up yet`);
        }

        return lines.join("\n");
      });

      parts.push(`FEATURE TRACKING PLANS (${biosContext.features.length}):\n${featureLines.join("\n\n")}`);
    }

    // featureImpact is now inlined per-feature above. Keep a compact reference
    // block here only for guardrail details and edge cases the per-feature
    // section may not have space for — action_plan slides can still cite it.
    if (biosContext.featureImpact && biosContext.featureImpact.length > 0) {
      const computed = biosContext.featureImpact.filter(fi => fi.verdict);
      if (computed.length > 0) {
        parts.push(`FEATURE IMPACT REFERENCE (already inlined above — cite the ★ lines in feature slides, not this section):\n` +
          computed.slice(0, 10).map(fi => {
            const lines: string[] = [`- ${fi.featureName}: ${fi.verdict}`];
            if (fi.cohort?.guardrailRegressed) lines.push(`  Guardrail: ${fi.cohort.guardrailEventName} regressed`);
            return lines.join("\n");
          }).join("\n")
        );
      }
    }

    if (biosContext.metrics && biosContext.metrics.length > 0) {
      parts.push(`GOALS & KPIs (${biosContext.metrics.length}):\n` +
        biosContext.metrics.slice(0, 20).map(m =>
          `- ${m.name} | Event: ${m.event_name ?? "n/a"} | Aggregation: ${m.aggregation}`
        ).join("\n")
      );
    }

    if (biosContext.funnels && biosContext.funnels.length > 0) {
      parts.push(`USER JOURNEY / FUNNELS (${biosContext.funnels.length}) — real step-by-step conversion, current data:\n` +
        biosContext.funnels.slice(0, 8).map(f => {
          const lines: string[] = [`- ${f.name}${f.description ? ` — ${f.description}` : ""} (last ${f.lookbackDays} days):`];
          f.steps.forEach(s => {
            lines.push(`    Step ${s.step} (${s.event_name}): ${s.users} users | ${s.conversion_from_prev}% vs previous step | ${s.conversion_from_first}% vs step 1`);
          });
          return lines.join("\n");
        }).join("\n")
      );
    }

    if (parts.length > 0) {
      biosBlock = `\nINTERNAL METRIK DATA:\n${parts.join("\n\n")}\n`;
    }
  }

  // Build source config context block — omitted in scoped single-section
  // reports for the same reason filteredRows is stripped above: the source's
  // parameter names and expected_insights describe sheet data, and including
  // them tells the AI those sheet metrics "must appear" even when the report
  // is explicitly scoped to Goals / Features / KPIs / Funnels only.
  let sourceConfigBlock = "";
  if (sourceConfigs && sourceConfigs.length > 0 && !isScopedMode) {
    const configParts: string[] = [];
    for (const cfg of sourceConfigs) {
      const lines: string[] = [`SOURCE: "${cfg.sourceName}"${cfg.data_type ? ` (${cfg.data_type})` : ""}`];
      if (cfg.parameters && cfg.parameters.length > 0) {
        lines.push("  TRACKED PARAMETERS (calculate and display these):");
        for (const p of cfg.parameters) {
          let line = `    - ${p.name}: ${p.description} [${p.aggregation}]`;
          if (p.column) line += ` · column: "${p.column}"`;
          if (p.formula) line += ` · formula: ${p.formula}`;
          lines.push(line);
        }
      }
      if (cfg.expected_insights && cfg.expected_insights.length > 0) {
        lines.push("  EXPECTED INSIGHTS (these MUST appear in the deck):");
        cfg.expected_insights.forEach((ins, i) => lines.push(`    ${i + 1}. ${ins}`));
      }
      configParts.push(lines.join("\n"));
    }
    sourceConfigBlock = `\nDATA SOURCE CONFIGURATION (follow these business parameters strictly):\n${configParts.join("\n\n")}\n`;
  }

  // ── Biggest movers: auto-detect largest % changes across numeric columns ──────
  let biggestMoversBlock = "";
  if (filteredRows.length >= 4) {
    try {
      const numericCols = headers
        .split(" | ")
        .filter(h => {
          const vals = filteredRows.map(r => parseFloat(r[h])).filter(n => !isNaN(n));
          return vals.length >= Math.floor(filteredRows.length * 0.5);
        });

      if (numericCols.length > 0) {
        type Mover = { col: string; first: number; last: number; change: number; pct: number; dir: "up" | "down" };
        const movers: Mover[] = numericCols.flatMap(col => {
          const vals = filteredRows.map(r => parseFloat(r[col])).filter(n => !isNaN(n));
          if (vals.length < 2) return [];
          const first = vals[0];
          const last = vals[vals.length - 1];
          if (first === 0) return [];
          const pct = ((last - first) / Math.abs(first)) * 100;
          return [{ col, first, last, change: last - first, pct, dir: pct >= 0 ? "up" : "down" }];
        });

        movers.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
        const top = movers.slice(0, 3);

        if (top.length > 0) {
          const lines = top.map(m =>
            `- ${m.col}: ${m.first.toLocaleString()} → ${m.last.toLocaleString()} (${m.pct >= 0 ? "+" : ""}${m.pct.toFixed(1)}% ${m.dir === "up" ? "▲" : "▼"})`
          );
          biggestMoversBlock = `\nBIGGEST MOVERS (auto-detected — these MUST be highlighted in the deck, ideally as big_stat or insight slides):\n${lines.join("\n")}\n`;
        }
      }
    } catch {
      // Non-fatal — skip if computation fails
    }
  }

  // Build per-slide guide block
  let slideGuidesBlock = "";
  if (slideGuides && slideGuides.some(g => g.focus || (g.mustInclude && g.mustInclude.length > 0) || g.chartType)) {
    const slideCount = effectiveSlideHint;
    const lines: string[] = [`\nPER-SLIDE GUIDE (hard constraints — map each position to the correct slide):`];
    lines.push(`- Slide 1: title (cover slide — always)`);
    for (let i = 2; i <= slideCount - 1; i++) {
      const guide = slideGuides.find(g => g.slideIndex === i);
      if (guide?.focus || guide?.mustInclude?.length || guide?.chartType) {
        let line = `- Slide ${i}:`;
        if (guide.focus) line += ` Focus → "${guide.focus}"`;
        if (guide.mustInclude?.length) line += ` | Must include: ${guide.mustInclude.join(", ")}`;
        if (guide.chartType && guide.chartType !== "auto") {
          const chartTypeMap: Record<string, string> = {
            bar: 'MUST use slide type "bar_chart"',
            line: 'MUST use slide type "line_chart"',
            area: 'MUST use slide type "line_chart"',
            pie: 'MUST use slide type "pie_chart" with "style": "pie"',
            donut: 'MUST use slide type "pie_chart" with "style": "donut"',
            table: 'MUST use slide type "kpi_grid"',
          };
          line += ` | ${chartTypeMap[guide.chartType] ?? `MUST use chart type: ${guide.chartType}`}`;
        }
        lines.push(line);
      } else if (i === slideCount - 1) {
        lines.push(`- Slide ${i}: (no specific guidance — default to "action_plan", see action_plan guidance above, unless the data genuinely doesn't warrant departmental follow-up)`);
      } else {
        lines.push(`- Slide ${i}: (no specific guidance — choose the best slide type for the data)`);
      }
    }
    lines.push(`- Slide ${slideCount}: closing (final slide — always)`);
    lines.push(`\nFor slides with "Must include" items: those exact metrics/insights MUST appear as numbers or chart data on that slide.`);
    lines.push(`For slides with a "Chart type": you MUST use that chart type for the primary visualization on that slide.`);
    slideGuidesBlock = lines.join("\n") + "\n";
  }

  // Use haiku for planning — 10x cheaper than sonnet, plenty capable for JSON structuring
  const model = "claude-haiku-4-5-20251001";

  const prompt = `You are a data-driven presentation designer creating a clean, visual business report.

COMPANY: ${companyName}
REPORT: ${template.name}
PERIOD: ${period}
SLIDES: ${effectiveSlideHint}
AUDIENCE: ${template.instructions}
STRICT PERIOD RULE: This report is explicitly for ${period} — not today's date, not the most recent date in any data below.
Never name, imply, or compute a stat for any month/quarter/date other than ${period} anywhere in the deck (titles, narration, chart labels, captions).
The data below was not necessarily pre-filtered to ${period} and may include other dates — if so, silently treat it as the closest available stand-in for ${period} rather than calling out the month it actually came from.
${scopeRestrictionBlock}${perFeatureBlock}${biosBlock}${sourceConfigBlock}${biggestMoversBlock}${slideGuidesBlock}
SHEET DATA (${filteredRows.length} rows)${filteredRows.length === 0 ? " — no sheet data provided, use internal Metrik data above" : ""}:
${filteredRows.length > 0 ? `Headers: ${headers}\n---\n${csvPreview}\n---` : "(none)"}

${slideGuidesBlock
  ? `Generate exactly ${effectiveSlideHint} slides as JSON — a per-slide guide above specifies what goes in each position.`
  : `Generate up to ${effectiveSlideHint} slides as JSON — that number is a ceiling, not a quota. Only include a slide if it presents a genuinely distinct fact, metric, or recommendation that no earlier slide already covers. Restating the same headline number or finding again in a different chart type just to reach ${effectiveSlideHint} slides is a real failure mode here — if there isn't enough distinct content for all ${effectiveSlideHint}, generate fewer instead of padding. The mandatory title (slide 1) and closing (last slide) don't count toward what needs to be "distinct."`
}

DESIGN PHILOSOPHY — follow strictly:
- Data first. Every slide must show numbers, not paragraphs.
- Use bar_chart for comparisons across categories or multiple metrics side by side.
- Use line_chart for time-series data or trends across sequential periods (months, weeks, quarters).
- Use pie_chart for part-of-whole breakdowns (3-7 categories). Use "donut" style when a central metric matters.
- Use big_stat for the single most important headline number — always include a narrative (2-3 sentences explaining why it matters, what drove it).
- Use stat_narrative when a key number needs both visual punch AND a business story alongside it — big number left, 2-3 sentence explanation right. Use this instead of big_stat when the number alone needs more context.
- CRITICAL: NEVER use big_stat or stat_narrative when the metric has no real measured value. If a KPI has no actual number (e.g. "Target not yet confirmed", "Data not yet available", "Not tracked"), use an "insight" slide instead that briefly names the gap and what to track next. The "stat" field of big_stat/stat_narrative must ALWAYS be a real number or percentage — never a placeholder sentence.
- Use progress_bars when tracking metrics vs targets.
- Use kpi_grid only for a summary grid of 4-6 KPIs.
- insight slides: 2 sentences max + one headline stat (no long paragraphs).
- bullet_list: use ONLY for non-numeric slides (agenda, simple list). Max 5 bullets, each under 10 words.
- NO slide should be text-only if data is available — always pair text with a number or chart.
- action_plan (second-to-last slide, right before closing — REQUIRED if ${effectiveSlideHint} >= 4 slides): based on what this specific deck actually shows (which metrics are down, which funnel steps are leaking, which KPI is off track, which insight is negative), decide which departments/roles are realistically responsible for fixing it, and write one concrete recommendation per department. Be selective — only include a department if the data in THIS deck actually implicates it. Do not pad with departments that have no basis in the data. 2-4 items max. Examples of how to reason about it (do not copy literally, derive from the actual numbers above): a funnel/activation drop-off → "Product & Growth"; a feature with low adoption after launch → "Product Design"; a channel/campaign underperforming → "Marketing"; a metric trending well and needs scaling → "Leadership/Stakeholders" (only if genuinely warranted). If nothing in the data is concerning enough to need departmental follow-up, it is fine to have only 1-2 items, or to skip action_plan and use bullet_list instead.
  If a FEATURE IMPACT block is present above, prioritize it over speculation: a "likely_negative" or "inconclusive" verdict on a feature that was supposed to move a goal is a much stronger, more specific basis for a recommendation than inferring from sheet data alone — cite the actual lift/trend numbers in the rationale. A "likely_positive" verdict can justify a "scale this up" recommendation rather than a fix-it one.

SLIDE TYPE SCHEMAS:
{
  "type": "title", "headline": "string", "subtitle": "string"
}
{
  "type": "big_stat",
  "label": "Metric name",
  "value": "47.2K",
  "change": "+12% vs last month",
  "change_direction": "up" | "down" | "flat",
  "context": "One short line of context (max 12 words)",
  "narrative": "2-3 sentences that turn this number into a business story — why it matters, what it implies, what drove it"
}
{
  "type": "stat_narrative",
  "title": "string",
  "stat": "84%",
  "stat_label": "claim approval rate",
  "change": "+6pp vs last quarter",
  "change_direction": "up" | "down" | "flat",
  "narrative": "2-3 sentences explaining what this number means for the business — the cause, the implication, what to watch next",
  "status": "positive" | "negative" | "neutral"
}
{
  "type": "bar_chart",
  "title": "string",
  "subtitle": "One line subtitle",
  "orientation": "vertical" | "horizontal",
  "series": [{ "label": "string", "value": 123.4, "target": 150.0 }]
}
{
  "type": "line_chart",
  "title": "string",
  "subtitle": "One line subtitle",
  "series": [{ "label": "Jan", "value": 123.4 }]
}
{
  "type": "pie_chart",
  "title": "string",
  "subtitle": "One line subtitle",
  "style": "pie" | "donut",
  "segments": [{ "label": "Category A", "value": 42.5 }]
}
{
  "type": "progress_bars",
  "title": "string",
  "items": [{ "label": "string", "value": 85, "target": 100, "unit": "%", "status": "on_track" | "off_track" | "neutral" }]
}
{
  "type": "kpi_grid",
  "title": "string",
  "kpis": [{ "label": "string", "value": "string", "target": "string", "status": "on_track" | "off_track" | "neutral" }]
}
{
  "type": "insight",
  "title": "string",
  "stat": "84%",
  "stat_label": "retention rate",
  "body": "Max 2 sentences. Be specific with numbers.",
  "status": "positive" | "negative" | "neutral"
}
{
  "type": "bullet_list", "title": "string", "items": ["string"]
}
{
  "type": "action_plan",
  "title": "string (e.g. \"Recommended Next Steps\")",
  "subtitle": "One line framing why these actions matter now",
  "items": [
    {
      "department": "string — only a real department/role implicated by this deck's data (e.g. \"Product & Growth\", \"Marketing\", \"Product Design\", \"Leadership\")",
      "recommendation": "concrete next step, max 14 words",
      "rationale": "tie directly to a specific metric/insight from this deck, max 18 words",
      "priority": "high" | "medium" | "low"
    }
  ]
}
{
  "type": "closing", "headline": "string", "subtitle": "string"
}

RULES:
- First slide: "title". Last slide: "closing".
- Second-to-last slide should be "action_plan" when there are 4+ slides total — see action_plan guidance above. Selectivity matters more than coverage: a sharp 2-item plan beats a padded 5-item one.
- For bar_chart series values: use ACTUAL numbers from the sheet (not strings).
- Use "horizontal" orientation when there are 6+ categories.
- For line_chart: labels should be sequential (months, weeks, dates). Use ACTUAL values from the sheet.
- For pie_chart: segments values must be real numbers. They represent parts of a whole.
- For progress_bars: value and target must be real numbers from the sheet.
- Prefer 1-2 big_stat slides for the most critical headline metrics.
- Return ONLY valid JSON. No markdown. No explanation.${extraNotes ? `

EXTRA INSTRUCTIONS FROM THE PRESENTER — fold these in ADDITIONALLY, they do not replace or deprioritize anything mandatory above (every Business Goal still needs a mention, the period rule still applies, etc.):
${extraNotes}` : ""}`;

  try {
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const tokensUsed = msg.usage.input_tokens + msg.usage.output_tokens;
    const raw = msg.content[0].type === "text" ? msg.content[0].text : "{}";
    // Strip markdown code fences if present
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    // Find the first { or [ to skip any leading text
    const firstBrace = cleaned.indexOf("{");
    const firstBracket = cleaned.indexOf("[");
    const startIdx = firstBrace === -1 ? firstBracket
      : firstBracket === -1 ? firstBrace
      : Math.min(firstBrace, firstBracket);
    let jsonStr = startIdx >= 0 ? cleaned.slice(startIdx) : cleaned;

    // If response was truncated (stop_reason === "max_tokens"), salvage complete slides
    if (msg.stop_reason === "max_tokens") {
      // Find the last complete slide object — look for the last "}," or "}" before truncation
      const lastCompleteObj = jsonStr.lastIndexOf("},");
      if (lastCompleteObj !== -1) {
        // Close the array/object after the last complete slide
        jsonStr = jsonStr.slice(0, lastCompleteObj + 1) + "]";
        // Wrap in slides object if it started as an array
        if (jsonStr.trimStart().startsWith("[")) {
          // already an array — fine
        }
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Last resort: try to extract individual slide objects with a regex
      const slideMatches = jsonStr.match(/\{[^{}]*"type"\s*:\s*"[^"]+[^{}]*\}/g) ?? [];
      if (slideMatches.length === 0) throw new Error("Could not parse AI response as JSON");
      parsed = slideMatches.map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
    }

    // Normalise: AI may return {title, slides:[]} or just [slide, slide, ...]
    let deck: SlidesDeck;
    if (Array.isArray(parsed)) {
      deck = { title: template.name, slides: parsed as SlideContent[] };
    } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).slides)) {
      const p = parsed as Record<string, unknown>;
      deck = { title: (p.title as string) ?? template.name, slides: p.slides as SlideContent[] };
    } else {
      const p = parsed as Record<string, unknown>;
      const slidesKey = Object.keys(p).find(k => Array.isArray(p[k]));
      const slides = slidesKey ? (p[slidesKey] as SlideContent[]) : [];
      deck = { title: (p.title as string) ?? template.name, slides };
    }

    // ── Sanitise slides: remove placeholder stats the AI generated despite being told not to ──
    // The AI occasionally puts "Data unavailable", "No measurement data", garbage sentences,
    // or truncated text into stat/value fields of big_stat and insight slides. Detect these
    // and either convert the slide type or blank the offending field so the render doesn't show junk.
    const looksLikePlaceholder = (s: string) => {
      if (!s || s.trim() === "" || s.trim() === "—" || s.trim() === "-") return false;
      const lower = s.toLowerCase().trim();
      // Real values: numbers, percentages, currency amounts, short labels like "N/A"
      if (/^[\d,.\s%$€£+\-kKmMbB]+$/.test(s.trim())) return false;
      if (s.trim().length <= 6) return false; // short codes are likely legit (e.g. "N/A", "TBD")
      // Sentences, placeholder phrases, or suspiciously long non-numeric strings
      return (
        lower.includes("no data") ||
        lower.includes("unavailable") ||
        lower.includes("not available") ||
        lower.includes("not measured") ||
        lower.includes("not tracked") ||
        lower.includes("no measurement") ||
        lower.includes("no kpi") ||
        lower.includes("baseline") ||
        lower.includes("not yet") ||
        lower.includes("pending") ||
        lower.includes("tbd") ||
        // More than 30 chars and not a number = almost certainly a sentence
        (s.trim().length > 30)
      );
    };

    deck.slides = deck.slides.map(slide => {
      if (slide.type === "big_stat" || slide.type === "stat_narrative") {
        if (looksLikePlaceholder(slide.value ?? "")) {
          // Demote to insight slide
          return {
            type: "insight" as const,
            title: (slide as { label?: string }).label ?? "Data Gap",
            body: slide.type === "stat_narrative"
              ? (slide as { narrative?: string }).narrative ?? "No data available for this metric yet."
              : (slide as { narrative?: string }).narrative ?? "No data available for this metric yet.",
            stat: "—",
            stat_label: "Not yet measured",
            status: "neutral" as const,
          };
        }
      }
      if (slide.type === "insight") {
        if (looksLikePlaceholder((slide as { stat?: string }).stat ?? "")) {
          return { ...slide, stat: "—", stat_label: (slide as { stat_label?: string }).stat_label ?? "Not yet measured" };
        }
      }
      return slide;
    });

    // ── Guarantee every Business Goal is visible, regardless of the model ──────
    // Telling the planning model "every goal must be mentioned" in the prompt
    // is a request, not a guarantee — under a tight slide budget, or with
    // competing custom briefing notes, a cheap/fast planning model (Haiku)
    // can still leave one out even when explicitly told not to. For a
    // stakeholder-facing report, "is my goal actually in there" can't depend
    // on model compliance, so this builds the goal-tracking slide directly
    // from real data and inserts it — no AI involved, can't be skipped.
    const hasGoals = (biosContext?.goals?.length ?? 0) > 0;
    const hasObjectives = (biosContext?.objectives?.length ?? 0) > 0;
    if (biosContext && (hasGoals || hasObjectives)) {
      // Build kpi_grid rows from product goals (with progress), or fall back
      // to objectives if no product goals exist yet.
      const goalKpis = hasGoals
        ? biosContext.goals!.slice(0, 12).map((g) => {
            const gp = biosContext.goalProgress?.[g.id];
            const pct = gp?.progressRatio != null ? Math.round(gp.progressRatio * 100) : null;
            const status: "on_track" | "off_track" | "neutral" =
              pct == null ? "neutral" : pct >= 100 ? "on_track" : pct >= 60 ? "neutral" : "off_track";
            return {
              label: g.title,
              value: pct != null ? `${pct}%` : "Not yet measurable",
              // kpi_grid's renderer hides the "Target: ..." line entirely when
              // target is exactly "-" — used here so a goal with no measurable
              // KPI doesn't show a meaningless "Target: -" row.
              target: pct != null ? "100%" : "-",
              status,
            };
          })
        : biosContext.objectives!.slice(0, 6).map((o) => ({
            label: o.title,
            value: o.status === "achieved" ? "Achieved ✓" : o.status === "missed" ? "Missed ✗" : "In progress",
            target: o.target ?? "-",
            status: (o.status === "achieved" ? "on_track" : o.status === "missed" ? "off_track" : "neutral") as "on_track" | "off_track" | "neutral",
          }));
      const goalSlide: SlideContent = { type: "kpi_grid", title: "Business Goals — Tracking Status", kpis: goalKpis };
      // Right after the title slide when there is one (always slide 1 per
      // the prompt's own rule), otherwise lead with it.
      const insertAt = deck.slides[0]?.type === "title" ? 1 : 0;
      deck.slides = [...deck.slides.slice(0, insertAt), goalSlide, ...deck.slides.slice(insertAt)];
    }

    return { deck, tokensUsed, model, error: null };
  } catch (err) {
    return { deck: null, tokensUsed: 0, model, error: (err as Error).message };
  }
  } catch (outerErr) {
    console.error("[planReport] outer error:", outerErr);
    return { deck: null, tokensUsed: 0, model: "", error: `Server error: ${(outerErr as Error).message}` };
  }
}

// ─── Phase 2: Build PPTX from pre-planned JSON (no AI) ───────────────────────

export async function buildReportFromPlan(
  orgId: string,
  templateId: string,
  templateName: string,
  period: string,
  deck: SlidesDeck,
  theme: DesignTheme,
  tokensUsed = 0
): Promise<{ fileUrl: string | null; reportId: string | null; tokensUsed: number; error: string | null }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { fileUrl: null, reportId: null, tokensUsed: 0, error: "Not authenticated" };

  const admin = createAdminClient();
  const { data: brand } = await admin
    .from("brand_settings")
    .select("*")
    .eq("organization_id", orgId)
    .single();

  const primaryColor = brand?.primary_color ?? "#6366f1";
  const secondaryColor = brand?.secondary_color ?? "#a5b4fc";
  const logoUrl = brand?.logo_url ?? null;

  const slidesCount = deck.slides?.length ?? 0;

  const { data: reportRow, error: insertErr } = await admin
    .from("reports")
    .insert({
      organization_id: orgId,
      template_id: templateId || null,   // empty string → null (uuid column rejects "")
      template_name: templateName,
      period,
      status: "generating",
      tokens_used: tokensUsed,
      slides_count: slidesCount,
      ai_model: "claude-haiku-4-5-20251001",
      created_by: user.id,
      deck_json: deck as unknown,
    })
    .select("id")
    .single();

  if (insertErr) {
    // Most likely cause: migration 006 hasn't been run (missing tokens_used / slides_count / ai_model columns)
    return {
      fileUrl: null, reportId: null, tokensUsed,
      error: `DB insert failed: ${insertErr.message}. Make sure migration 006_report_credits.sql has been run in Supabase.`,
    };
  }

  try {
    const buffer = await buildPptx(deck, period, primaryColor, secondaryColor, logoUrl, theme);
    const fileName = `${period.replace(/\s+/g, "-")}-${templateName.replace(/\s+/g, "-")}-${Date.now()}.pptx`;
    const { url: fileUrl, error: uploadError } = await uploadPptx(orgId, fileName, buffer);

    if (uploadError) {
      if (reportRow) {
        await admin.from("reports").update({ status: "failed", error: uploadError }).eq("id", reportRow.id);
      }
      return { fileUrl: null, reportId: null, tokensUsed, error: uploadError };
    }

    if (reportRow) {
      await admin.from("reports").update({ status: "done", file_url: fileUrl }).eq("id", reportRow.id);
    }
    return { fileUrl, reportId: reportRow?.id ?? null, tokensUsed, error: null };
  } catch (err) {
    if (reportRow) {
      await admin.from("reports").update({ status: "failed", error: (err as Error).message }).eq("id", reportRow.id);
    }
    return { fileUrl: null, reportId: null, tokensUsed, error: (err as Error).message };
  }
}

// ─── Premium PPTX builder ─────────────────────────────────────────────────────

async function buildPptx(
  deck: SlidesDeck,
  period: string,
  primaryColor: string,
  secondaryColor: string,
  logoUrl: string | null,
  theme: DesignTheme = "brand"
): Promise<Buffer> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9";
  pres.title = deck.title;

  // Settings page appends a cache-busting "?t=<timestamp>" to the logo URL so
  // the browser preview refreshes after a re-upload. pptxgenjs determines an
  // embedded image's type by reading the extension off the END of the path
  // string — with a trailing query string it can no longer see ".png"/".jpg"
  // there, so addImage silently fails (caught below) even though the logo
  // uploaded fine and renders fine everywhere else. Strip query/fragment
  // before handing the URL to pptxgenjs.
  const cleanLogoUrl = logoUrl ? logoUrl.split("?")[0].split("#")[0] : null;

  // ── Color palette based on theme ────────────────────────────────────────────
  const strip = (c: string) => c.replace("#", "");

  let bgColor: string;    // cover bg
  let accentColor: string; // text accent
  let coverText: string;  // text on cover
  let cardBg: string;
  let bodyBg: string;

  if (theme === "midnight") {
    bgColor = "0F172A";
    accentColor = strip(primaryColor);
    coverText = "FFFFFF";
    cardBg = "1E293B";
    bodyBg = "0F172A";
  } else if (theme === "clean") {
    bgColor = "FFFFFF";
    accentColor = strip(primaryColor);
    coverText = strip(primaryColor);
    cardBg = "FFFFFF";
    bodyBg = "FFFFFF";
  } else {
    // "brand" — primary color cover, white content pages
    bgColor = strip(primaryColor);
    accentColor = strip(primaryColor);
    coverText = "FFFFFF";
    cardBg = "FFFFFF";
    bodyBg = "FFFFFF";
  }

  const white = "FFFFFF";
  const textDark = theme === "midnight" ? "F1F5F9" : "1E293B";
  const textMid = theme === "midnight" ? "94A3B8" : "64748B";
  const textLight = theme === "midnight" ? "64748B" : "94A3B8";
  const borderColor = theme === "midnight" ? "334155" : "E2E8F0";
  const green = "16A34A";
  const red = "DC2626";
  const amber = "D97706";

  const totalSlides = deck.slides.length;

  // ── Helper: branded footer (dot + deck title + slide number) ─────────────────
  function addFooter(s: ReturnType<typeof pres.addSlide>, slideNum: number, isCoverSlide = false) {
    const footerColor = isCoverSlide ? coverText : textLight;
    const dotColor = isCoverSlide ? white : accentColor;
    // Dot
    s.addShape("ellipse" as never, {
      x: 0.5, y: 5.37, w: 0.1, h: 0.1,
      fill: { color: dotColor, transparency: isCoverSlide ? 30 : 0 },
      line: { type: "none" },
    });
    // Deck name
    s.addText(deck.title.toUpperCase(), {
      x: 0.67, y: 5.33, w: 7, h: 0.22,
      fontSize: 7, color: footerColor, transparency: isCoverSlide ? 40 : 0,
      fontFace: "Calibri", charSpacing: 1.5,
    });
    // Slide number (right side)
    if (!isCoverSlide) {
      s.addText(`${slideNum} / ${totalSlides}`, {
        x: 8.8, y: 5.33, w: 0.7, h: 0.22,
        fontSize: 7, color: textLight, align: "right",
      });
    }
  }

  // ── Helper: content slide title + accent line ────────────────────────────────
  function addSlideTitle(
    s: ReturnType<typeof pres.addSlide>,
    title: string,
    subtitle?: string,
    slideNum = 0
  ) {
    s.background = { color: bodyBg };
    // Thin top header bar
    s.addShape("rect" as never, {
      x: 0, y: 0, w: 10, h: 0.08,
      fill: { color: accentColor },
      line: { type: "none" },
    });
    s.addText(title, {
      x: 0.5, y: 0.18, w: 8.5, h: 0.55,
      fontSize: 20, bold: true, color: textDark, fontFace: "Calibri",
    });
    if (subtitle) {
      s.addText(subtitle, {
        x: 0.5, y: 0.75, w: 8.5, h: 0.3,
        fontSize: 10, color: textMid,
      });
    }
    // Separator line
    s.addShape("rect" as never, {
      x: 0, y: 1.05, w: 10, h: 0.012,
      fill: { color: borderColor },
      line: { type: "none" },
    });
    addFooter(s, slideNum);
  }

  for (const slide of deck.slides) {
    const s = pres.addSlide();
    const slideNum = deck.slides.indexOf(slide) + 1;
    try {

    // ── Per-slide image overlay (all types) ──────────────────────────────────
    const imgUrl = (slide as { image_url?: string }).image_url;

    // ── Title slide ──────────────────────────────────────────────────────────
    if (slide.type === "title") {
      s.background = { color: bgColor };

      // Decorative diagonal accent band (top-right)
      s.addShape("rect" as never, {
        x: 7.5, y: 0, w: 2.5, h: 5.625,
        fill: { color: strip(secondaryColor), transparency: theme === "midnight" ? 75 : 85 },
        line: { type: "none" },
      });

      // Bottom footer strip
      s.addShape("rect" as never, {
        x: 0, y: 5.25, w: 10, h: 0.375,
        fill: { color: strip(secondaryColor), transparency: theme === "midnight" ? 55 : 40 },
        line: { type: "none" },
      });

      // Company name top-left
      s.addText(deck.title.toUpperCase(), {
        x: 0.55, y: 0.32, w: 6.5, h: 0.32,
        fontSize: 9, color: coverText, transparency: 40, charSpacing: 2,
      });

      // Period label
      s.addText(period, {
        x: 0.55, y: 0.65, w: 6.5, h: 0.28,
        fontSize: 9, color: coverText, transparency: 50,
      });

      // Thin horizontal rule
      s.addShape("rect" as never, {
        x: 0.55, y: 1.0, w: 1.5, h: 0.035,
        fill: { color: coverText, transparency: 55 },
        line: { type: "none" },
      });

      // Main headline
      s.addText(slide.headline, {
        x: 0.55, y: 1.2, w: 7.5, h: 2.4,
        fontSize: 40, bold: true, color: coverText,
        fontFace: "Calibri", valign: "middle",
      });

      // Subtitle
      s.addText(slide.subtitle, {
        x: 0.55, y: 3.7, w: 7, h: 0.7,
        fontSize: 15, color: coverText, transparency: 25,
      });

      // Logo
      if (cleanLogoUrl) {
        try {
          s.addImage({ path: cleanLogoUrl, x: 8.2, y: 0.2, w: 1.5, h: 0.75, sizing: { type: "contain", w: 1.5, h: 0.75 } });
        } catch { /* skip if logo fails */ }
      }

      addFooter(s, slideNum, true);

      // Per-slide image — render as right-side accent panel on title/closing
      if (imgUrl) {
        try {
          s.addImage({ path: imgUrl, x: 5.5, y: 0, w: 4.5, h: 5.625, sizing: { type: "cover", w: 4.5, h: 5.625 } });
          // subtle gradient overlay so text stays readable
          s.addShape("rect" as never, {
            x: 5.5, y: 0, w: 4.5, h: 5.625,
            fill: { type: "solid", color: bgColor, transparency: 25 }, line: { type: "none" },
          });
        } catch { /* skip if image unreachable */ }
      }

    // ── Big stat ─────────────────────────────────────────────────────────────
    } else if (slide.type === "big_stat") {
      s.background = { color: bodyBg };
      const changeColor = slide.change_direction === "up" ? green : slide.change_direction === "down" ? red : textMid;
      const arrow = slide.change_direction === "up" ? "▲" : slide.change_direction === "down" ? "▼" : "—";

      // Top accent bar (matches all other content slides)
      s.addShape("rect" as never, { x: 0, y: 0, w: 10, h: 0.08, fill: { color: accentColor }, line: { type: "none" } });

      if (slide.narrative) {
        // Compact layout: number on left half, narrative on right half
        // Re-position label + number to left column
        s.addText(slide.label.toUpperCase(), {
          x: 0.5, y: 0.85, w: 4.5, h: 0.4,
          fontSize: 10, color: textMid, align: "center", charSpacing: 2,
        });
        s.addText(slide.value, {
          x: 0.5, y: 1.2, w: 4.5, h: 2.2,
          fontSize: 72, bold: true, color: accentColor, align: "center", fontFace: "Calibri",
        });
        s.addShape("rect" as never, {
          x: 1.3, y: 3.5, w: 2.0, h: 0.42,
          fill: { color: changeColor, transparency: 88 },
          line: { color: changeColor, width: 0.5, transparency: 60 },
        });
        s.addText(`${arrow}  ${slide.change}`, {
          x: 1.3, y: 3.5, w: 2.0, h: 0.42,
          fontSize: 12, bold: true, color: changeColor, align: "center", valign: "middle",
        });
        s.addText(slide.context, {
          x: 0.5, y: 4.05, w: 4.5, h: 0.55,
          fontSize: 10, color: textLight, align: "center",
        });
        // Divider
        s.addShape("line" as never, {
          x: 5.2, y: 0.9, w: 0, h: 3.8,
          line: { color: "E5E7EB", width: 1 },
        });
        // Narrative on right
        s.addText(slide.narrative, {
          x: 5.4, y: 1.1, w: 4.3, h: 3.6,
          fontSize: 13, color: textDark, lineSpacingMultiple: 1.35, valign: "middle",
        });
      } else {
        // Original centered layout
        s.addText(slide.label.toUpperCase(), {
          x: 0.6, y: 0.85, w: 8.8, h: 0.4,
          fontSize: 10, color: textMid, align: "center", charSpacing: 2,
        });
        s.addText(slide.value, {
          x: 0.6, y: 1.25, w: 8.8, h: 2.4,
          fontSize: 88, bold: true, color: accentColor, align: "center", fontFace: "Calibri",
        });
        s.addShape("rect" as never, {
          x: 3.8, y: 3.75, w: 2.4, h: 0.48,
          fill: { color: changeColor, transparency: 88 },
          line: { color: changeColor, width: 0.5, transparency: 60 },
        });
        s.addText(`${arrow}  ${slide.change}`, {
          x: 3.8, y: 3.75, w: 2.4, h: 0.48,
          fontSize: 14, bold: true, color: changeColor, align: "center", valign: "middle",
        });
        s.addText(slide.context, {
          x: 1.5, y: 4.35, w: 7, h: 0.55,
          fontSize: 11, color: textLight, align: "center",
        });
      }

      addFooter(s, slideNum);

    // ── Stat narrative (new: big number left + story right) ───────────────────
    } else if (slide.type === "stat_narrative") {
      s.background = { color: bodyBg };
      const snColor = slide.status === "positive" ? green : slide.status === "negative" ? red : accentColor;
      const snChangeColor = slide.change_direction === "up" ? green : slide.change_direction === "down" ? red : textMid;
      const snArrow = slide.change_direction === "up" ? "▲" : slide.change_direction === "down" ? "▼" : "—";

      s.addShape("rect" as never, { x: 0, y: 0, w: 10, h: 0.08, fill: { color: snColor }, line: { type: "none" } });
      addSlideTitle(s, slide.title, undefined, slideNum);

      // Left panel background
      s.addShape("rect" as never, {
        x: 0, y: 1.1, w: 4.0, h: 4.0,
        fill: { color: snColor, transparency: 94 },
        line: { color: snColor, transparency: 75, width: 0.5 },
      });
      // Stat label
      s.addText(slide.stat_label.toUpperCase(), {
        x: 0.3, y: 1.4, w: 3.4, h: 0.4,
        fontSize: 9, color: textMid, align: "center", charSpacing: 2,
      });
      // Big number
      s.addText(slide.stat, {
        x: 0.3, y: 1.75, w: 3.4, h: 1.9,
        fontSize: 68, bold: true, color: snColor, align: "center", fontFace: "Calibri",
      });
      // Change
      s.addShape("rect" as never, {
        x: 0.8, y: 3.75, w: 2.4, h: 0.38,
        fill: { color: snChangeColor, transparency: 88 },
        line: { color: snChangeColor, width: 0.5, transparency: 60 },
      });
      s.addText(`${snArrow}  ${slide.change}`, {
        x: 0.8, y: 3.75, w: 2.4, h: 0.38,
        fontSize: 11, bold: true, color: snChangeColor, align: "center", valign: "middle",
      });

      // Divider
      s.addShape("line" as never, {
        x: 4.2, y: 1.2, w: 0, h: 3.7,
        line: { color: "E5E7EB", width: 1 },
      });

      // Narrative text on right
      s.addText(slide.narrative, {
        x: 4.4, y: 1.3, w: 5.3, h: 3.6,
        fontSize: 14, color: textDark, lineSpacingMultiple: 1.4, valign: "middle",
      });

      addFooter(s, slideNum);

    // ── Bar chart — drawn with shapes (no native chart object) ───────────────
    } else if (slide.type === "bar_chart") {
      addSlideTitle(s, slide.title, slide.subtitle, slideNum);

      const series = slide.series.slice(0, 10);
      const maxVal = Math.max(...series.map(s2 => Math.max(s2.value, s2.target ?? 0)), 1);
      const isHorizontal = slide.orientation === "horizontal" || series.length > 6;
      const startY = slide.subtitle ? 1.45 : 1.2;
      const areaH = 3.85; // content height before footer

      if (isHorizontal) {
        // ── Horizontal bars — matches web preview exactly ─────────────────────
        const rowH = areaH / series.length;
        series.forEach((item, i) => {
          const y = startY + i * rowH;
          const pct = item.value / maxVal;
          const barH = Math.min(rowH * 0.32, 0.22);
          const barY = y + rowH * 0.42;

          // Label (left)
          s.addText(item.label, {
            x: 0.5, y: y + 0.03, w: 6.5, h: rowH * 0.38,
            fontSize: Math.max(8, Math.min(11, 130 / series.length)),
            color: textDark, fontFace: "Calibri",
          });
          // Value (right, accent)
          s.addText(item.value.toLocaleString(), {
            x: 8.6, y: y + 0.03, w: 0.9, h: rowH * 0.38,
            fontSize: Math.max(8, Math.min(11, 130 / series.length)),
            color: accentColor, bold: true, align: "right",
          });
          // Track (gray background bar)
          s.addShape("rect" as never, {
            x: 0.5, y: barY, w: 9, h: barH,
            fill: { color: borderColor }, line: { type: "none" },
          });
          // Fill (colored bar)
          s.addShape("rect" as never, {
            x: 0.5, y: barY, w: Math.max(0.06, 9 * pct), h: barH,
            fill: { color: accentColor }, line: { type: "none" },
          });
          // Target line (red hairline)
          if (item.target) {
            const tPct = item.target / maxVal;
            s.addShape("rect" as never, {
              x: 0.5 + 9 * tPct - 0.025, y: barY - 0.04, w: 0.05, h: barH + 0.08,
              fill: { color: red }, line: { type: "none" },
            });
          }
        });
        // Legend for target line
        if (series.some(s2 => s2.target)) {
          s.addShape("rect" as never, { x: 8.0, y: startY - 0.02, w: 0.25, h: 0.06, fill: { color: red }, line: { type: "none" } });
          s.addText("Target", { x: 8.28, y: startY - 0.06, w: 1.2, h: 0.2, fontSize: 8, color: textMid });
        }

      } else {
        // ── Vertical columns — matches web preview ────────────────────────────
        const totalW = 9;
        const colW = totalW / series.length;
        const barW = Math.min(colW * 0.7, 0.9);
        const barAreaH = areaH - 0.45;

        series.forEach((item, i) => {
          const cx = 0.5 + i * colW + colW / 2; // center x
          const x = cx - barW / 2;
          const pct = item.value / maxVal;
          const barH = Math.max(0.05, barAreaH * pct);
          const barY = startY + barAreaH - barH;

          // Bar
          s.addShape("rect" as never, {
            x, y: barY, w: barW, h: barH,
            fill: { color: accentColor }, line: { type: "none" },
          });
          // Value above bar
          s.addText(item.value.toLocaleString(), {
            x: x - 0.1, y: barY - 0.26, w: barW + 0.2, h: 0.24,
            fontSize: Math.max(7, Math.min(10, 90 / series.length)),
            color: accentColor, bold: true, align: "center",
          });
          // Target line
          if (item.target) {
            const tPct = item.target / maxVal;
            s.addShape("rect" as never, {
              x: x - 0.04, y: startY + barAreaH - barAreaH * tPct, w: barW + 0.08, h: 0.04,
              fill: { color: red }, line: { type: "none" },
            });
          }
          // Category label below
          s.addText(item.label, {
            x: x - 0.1, y: startY + barAreaH + 0.05, w: barW + 0.2, h: 0.32,
            fontSize: Math.max(6, Math.min(9, 80 / series.length)),
            color: textMid, align: "center",
          });
        });
        // Baseline
        s.addShape("rect" as never, {
          x: 0.5, y: startY + barAreaH, w: 9, h: 0.015,
          fill: { color: borderColor }, line: { type: "none" },
        });
        if (series.some(s2 => s2.target)) {
          s.addShape("rect" as never, { x: 8.2, y: startY - 0.02, w: 0.25, h: 0.06, fill: { color: red }, line: { type: "none" } });
          s.addText("Target", { x: 8.48, y: startY - 0.06, w: 1.0, h: 0.2, fontSize: 8, color: textMid });
        }
      }

    // ── Line chart (native addChart) ──────────────────────────────────────────
    } else if (slide.type === "line_chart") {
      addSlideTitle(s, slide.title, slide.subtitle, slideNum);
      const pts = (slide.series ?? []).slice(0, 12);
      if (pts.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s as any).addChart(
          "line",
          [{ name: slide.title, labels: pts.map(p => p.label), values: pts.map(p => p.value) }],
          {
            x: 0.5, y: 1.3, w: 9, h: 4.0,
            chartColors: [accentColor],
            lineDataSymbol: "circle",
            lineDataSymbolSize: 6,
            showLegend: false,
            showValue: true,
            dataLabelFontSize: 9,
            dataLabelColor: accentColor,
            dataLabelFormatCode: "#,##0",
            catAxisLabelFontSize: 9,
            valAxisLabelFontSize: 8,
            valAxisLabelFormatCode: "#,##0",
            valAxisLineShow: false,
            catAxisLineShow: true,
            lineSmooth: false,
          }
        );
      }

    // ── Pie / Donut chart ─────────────────────────────────────────────────────
    } else if (slide.type === "pie_chart") {
      addSlideTitle(s, slide.title, slide.subtitle, slideNum);
      const segs = slide.segments.slice(0, 7);
      const total = segs.reduce((sum, seg) => sum + seg.value, 0) || 1;
      const pieColors = [accentColor, "6366F1", "10B981", "F59E0B", "EF4444", "8B5CF6", "EC4899"];
      const isDonut = slide.style === "donut";

      // Center and radius (in inches, chart area left half)
      const cx = 2.8;
      const cy = 3.0;
      const rOuter = 1.6;
      const rInner = isDonut ? 0.7 : 0;

      // Use pptxgenjs native pie/doughnut chart
      const chartData = [
        {
          name: "Values",
          labels: segs.map(seg => seg.label),
          values: segs.map(seg => seg.value),
        },
      ];

      const pieChartOpts: Record<string, unknown> = {
        x: 0.3, y: 1.2, w: 5.2, h: 4.1,
        chartColors: pieColors,
        showLegend: false,
        showLabel: true,
        showPercent: true,
        dataLabelFontSize: 10,
        dataLabelColor: "FFFFFF",
      };
      if (isDonut) pieChartOpts.holeSize = 50;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s as any).addChart(
        isDonut ? "doughnut" : "pie", chartData, pieChartOpts
      );

      // Legend (right side)
      const legendStartY = 1.5;
      const legendRowH = Math.min(0.5, (3.8) / segs.length);
      segs.forEach((seg, i) => {
        const lyY = legendStartY + i * legendRowH;
        const pct = Math.round((seg.value / total) * 100);
        s.addShape("rect" as never, {
          x: 5.8, y: lyY + 0.06, w: 0.18, h: 0.18,
          fill: { color: pieColors[i % pieColors.length] }, line: { type: "none" },
        });
        s.addText(seg.label, {
          x: 6.05, y: lyY, w: 3.0, h: 0.3,
          fontSize: 10, color: textDark,
        });
        s.addText(`${pct}% · ${seg.value.toLocaleString()}`, {
          x: 6.05, y: lyY + 0.3, w: 3.0, h: 0.22,
          fontSize: 8, color: textMid,
        });
      });

      // Donut center label
      if (isDonut) {
        s.addText(`${Math.round(total).toLocaleString()}`, {
          x: cx - 0.9, y: cy - 0.35, w: 1.8, h: 0.5,
          fontSize: 18, bold: true, color: accentColor, align: "center",
        });
        s.addText("total", {
          x: cx - 0.9, y: cy + 0.12, w: 1.8, h: 0.3,
          fontSize: 9, color: textMid, align: "center",
        });
      }

    // ── Progress bars ─────────────────────────────────────────────────────────
    } else if (slide.type === "progress_bars") {
      addSlideTitle(s, slide.title, undefined, slideNum);
      const items = slide.items.slice(0, 7);
      const rowH = (3.85) / items.length;

      items.forEach((item, i) => {
        const y = 1.18 + i * rowH;
        const pct = Math.min(1, item.target > 0 ? item.value / item.target : 0);
        const barColor = item.status === "on_track" ? green : item.status === "off_track" ? red : amber;
        const pctLabel = `${Math.round(pct * 100)}%`;

        // Label
        s.addText(item.label, { x: 0.5, y, w: 5.5, h: 0.3, fontSize: 11, color: textDark });
        // Value / target (right-aligned)
        s.addText(`${item.value.toLocaleString()}${item.unit} / ${item.target.toLocaleString()}${item.unit}`, {
          x: 6.5, y, w: 3, h: 0.3, fontSize: 10, color: accentColor, bold: true, align: "right",
        });
        // Track
        s.addShape("rect" as never, {
          x: 0.5, y: y + 0.33, w: 9, h: 0.18,
          fill: { color: borderColor }, line: { type: "none" },
        });
        // Fill
        if (pct > 0) {
          s.addShape("rect" as never, {
            x: 0.5, y: y + 0.33, w: Math.max(0.05, 9 * pct), h: 0.18,
            fill: { color: barColor }, line: { type: "none" },
          });
        }
        // Pct label
        s.addText(pctLabel, { x: 0.5, y: y + 0.54, w: 2, h: 0.2, fontSize: 8, color: textLight });
      });

    // ── KPI grid ─────────────────────────────────────────────────────────────
    } else if (slide.type === "kpi_grid") {
      addSlideTitle(s, slide.title, undefined, slideNum);
      const kpis = slide.kpis.slice(0, 6);
      const cols = kpis.length <= 2 ? 2 : kpis.length <= 4 ? 2 : 3;
      const rowCount = Math.ceil(kpis.length / cols);
      const cardW = (9.0 / cols) - 0.12;
      const cardH = rowCount === 1 ? 3.0 : 1.75;
      const startY = 1.18;
      const gapX = 0.12;

      kpis.forEach((kpi, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = 0.5 + col * (cardW + gapX);
        const y = startY + row * (cardH + 0.15);
        const statusColor = kpi.status === "on_track" ? green : kpi.status === "off_track" ? red : amber;

        // Card background
        s.addShape("rect" as never, {
          x, y, w: cardW, h: cardH,
          fill: { color: cardBg },
          line: { color: borderColor, width: 0.75 },
        });

        // Status left bar (thin, elegant — not a header)
        s.addShape("rect" as never, {
          x, y, w: 0.05, h: cardH,
          fill: { color: statusColor },
          line: { type: "none" },
        });

        const innerX = x + 0.2;
        const innerW = cardW - 0.35;

        // Metric label
        s.addText(kpi.label, {
          x: innerX, y: y + 0.2, w: innerW, h: 0.3,
          fontSize: 10, color: textMid, fontFace: "Calibri",
        });

        // Value — big number
        const valueFontSize = cardH >= 2.5 ? 36 : 26;
        s.addText(kpi.value, {
          x: innerX, y: y + 0.52, w: innerW, h: cardH >= 2.5 ? 1.5 : 0.9,
          fontSize: valueFontSize, bold: true, color: accentColor, fontFace: "Calibri",
        });

        // Target
        if (kpi.target && kpi.target !== "-" && kpi.target !== "") {
          s.addText(`vs target: ${kpi.target}`, {
            x: innerX, y: y + cardH - 0.45, w: innerW, h: 0.3,
            fontSize: 9, color: textLight,
          });
        }

        // Status dot top-right
        s.addShape("ellipse" as never, {
          x: x + cardW - 0.28, y: y + 0.18, w: 0.18, h: 0.18,
          fill: { color: statusColor },
          line: { type: "none" },
        });
      });

    // ── Insight slide ─────────────────────────────────────────────────────────
    } else if (slide.type === "insight") {
      addSlideTitle(s, slide.title, undefined, slideNum);
      const accentBorderColor = slide.status === "positive" ? green : slide.status === "negative" ? red : accentColor;

      // How wide the coloured stat panel is, relative to the body text panel
      // beside it — mirrors the same "narrow / balanced / wide" choice made
      // in the editor (slide-card.tsx), so what gets downloaded as a .pptx
      // matches what was previewed instead of always using the old fixed
      // 3.0in width regardless of that setting.
      const STAT_WIDTH_IN: Record<string, number> = { narrow: 2.0, balanced: 3.0, wide: 4.2 };
      const leftW = STAT_WIDTH_IN[slide.stat_width ?? "balanced"] ?? 3.0;
      const gapIn = 0.15;
      const rightX = 0.5 + leftW + gapIn;
      const rightW = 9.0 - leftW - gapIn;

      // Left: big stat panel
      s.addShape("rect" as never, {
        x: 0.5, y: 1.18, w: leftW, h: 3.75,
        fill: { color: accentBorderColor }, line: { type: "none" },
      });
      s.addText(slide.stat || "", {
        x: 0.5, y: 1.85, w: leftW, h: 1.5,
        fontSize: 52, bold: true, color: white, align: "center", fontFace: "Calibri",
      });
      s.addText(slide.stat_label || "", {
        x: 0.5, y: 3.4, w: leftW, h: 0.4,
        fontSize: 10, color: white, align: "center", transparency: 20,
      });

      // Right: body text panel
      s.addShape("rect" as never, {
        x: rightX, y: 1.18, w: rightW, h: 3.75,
        fill: { color: cardBg }, line: { color: borderColor, width: 0.75 },
      });
      const arrow2 = slide.status === "positive" ? "↑" : slide.status === "negative" ? "↓" : "→";
      s.addText(`${arrow2}  ${slide.status === "positive" ? "Positive signal" : slide.status === "negative" ? "Needs attention" : "Neutral observation"}`, {
        x: rightX + 0.2, y: 1.28, w: rightW - 0.4, h: 0.32,
        fontSize: 9, bold: true, color: accentBorderColor, charSpacing: 0.5,
      });
      s.addText(slide.body, {
        x: rightX + 0.2, y: 1.68, w: rightW - 0.4, h: 3.1,
        fontSize: 13, color: textDark, valign: "top",
        fontFace: "Calibri", lineSpacingMultiple: 1.4,
      });

    // ── Action plan (department-tagged recommendations) ──────────────────────
    // Plain numbered list, one accent color used only as text — no colored
    // pills or priority bars. Priority still determines order (highest first)
    // but isn't called out visually; that's what kept earlier versions of
    // this slide looking like a generic "AI slide."
    } else if (slide.type === "action_plan") {
      addSlideTitle(s, slide.title, slide.subtitle, slideNum);

      const apItems = slide.items.slice(0, 4);
      const rowGap = 0.12;
      const rowH = (3.85 - rowGap * (apItems.length - 1)) / Math.max(apItems.length, 1);
      const startY = 1.18;

      apItems.forEach((item, i) => {
        const y = startY + i * (rowH + rowGap);

        // Thin divider between items (not above the first)
        if (i > 0) {
          s.addShape("rect" as never, {
            x: 0.5, y: y - rowGap / 2, w: 8.95, h: 0.01,
            fill: { color: borderColor }, line: { type: "none" },
          });
        }

        // Index number
        s.addText(String(i + 1).padStart(2, "0"), {
          x: 0.5, y: y + 0.05, w: 0.55, h: 0.3,
          fontSize: 11, color: textLight, fontFace: "Calibri", valign: "top",
        });

        const textX = 1.15;
        const textW = 8.95 - (textX - 0.5) - 0.1;

        s.addText(item.department.toUpperCase(), {
          x: textX, y: y + 0.04, w: textW, h: 0.22,
          fontSize: 9, bold: true, color: accentColor, charSpacing: 0.8, fontFace: "Calibri",
        });
        s.addText(item.recommendation, {
          x: textX, y: y + 0.28, w: textW, h: 0.4,
          fontSize: 12, bold: true, color: textDark, fontFace: "Calibri", valign: "top",
        });
        s.addText(item.rationale, {
          x: textX, y: y + 0.70, w: textW, h: Math.max(0.18, rowH - 0.70),
          fontSize: 9.5, color: textMid, fontFace: "Calibri", valign: "top",
        });
      });

    // ── Bullet list ───────────────────────────────────────────────────────────
    } else if (slide.type === "bullet_list") {
      addSlideTitle(s, slide.title, undefined, slideNum);

      const bulletItems = slide.items.slice(0, 8).map((item, i) => ({
        text: item,
        options: {
          bullet: { indent: 15 },
          breakLine: i < slide.items.length - 1,
          fontSize: 14,
          color: textDark,
          paraSpaceBefore: 4,
          paraSpaceAfter: 4,
        },
      }));

      s.addText(bulletItems, {
        x: 0.55, y: 1.18, w: 8.9, h: 3.9,
        fontFace: "Calibri", valign: "top",
      });

    // ── Closing slide ─────────────────────────────────────────────────────────
    } else if (slide.type === "closing") {
      s.background = { color: bgColor };

      // Mirror the title slide's decorative band
      s.addShape("rect" as never, {
        x: 7.5, y: 0, w: 2.5, h: 5.625,
        fill: { color: strip(secondaryColor), transparency: theme === "midnight" ? 75 : 85 },
        line: { type: "none" },
      });

      s.addShape("rect" as never, {
        x: 0, y: 5.25, w: 10, h: 0.375,
        fill: { color: strip(secondaryColor), transparency: theme === "midnight" ? 55 : 40 },
        line: { type: "none" },
      });

      // Thin rule centered
      s.addShape("rect" as never, {
        x: 3.5, y: 1.3, w: 3, h: 0.035,
        fill: { color: coverText, transparency: 60 },
        line: { type: "none" },
      });

      s.addText(slide.headline, {
        x: 0.55, y: 1.5, w: 8.8, h: 1.8,
        fontSize: 38, bold: true, color: coverText,
        align: "center", fontFace: "Calibri",
      });
      s.addText(slide.subtitle, {
        x: 0.55, y: 3.4, w: 8.8, h: 0.6,
        fontSize: 15, color: coverText, align: "center", transparency: 25,
      });

      addFooter(s, slideNum, true);

      // Per-slide image for closing — same right-panel treatment
      if (imgUrl) {
        try {
          s.addImage({ path: imgUrl, x: 5.5, y: 0, w: 4.5, h: 5.625, sizing: { type: "cover", w: 4.5, h: 5.625 } });
          s.addShape("rect" as never, {
            x: 5.5, y: 0, w: 4.5, h: 5.625,
            fill: { type: "solid", color: bgColor, transparency: 25 }, line: { type: "none" },
          });
        } catch { /* skip */ }
      }
    } else if (imgUrl) {
      // Content slides — placed/sized per the editor's position controls
      // (percentages of the 10in x 5.625in slide), falling back to the
      // original fixed top-right inset for any image attached before this
      // feature existed (no image_x/y/w/h saved on it).
      const pos = slide as { image_x?: number; image_y?: number; image_w?: number; image_h?: number };
      const imgX = (pos.image_x ?? 70) / 100 * 10;
      const imgY = (pos.image_y ?? 6) / 100 * 5.625;
      const imgW = (pos.image_w ?? 26) / 100 * 10;
      const imgH = (pos.image_h ?? 20) / 100 * 5.625;
      try {
        s.addImage({ path: imgUrl, x: imgX, y: imgY, w: imgW, h: imgH, sizing: { type: "cover", w: imgW, h: imgH } });
      } catch { /* skip */ }
    }

    } catch (slideErr) {
      // A single bad slide should not abort the whole deck — skip it with a placeholder
      console.error(`[buildPptx] slide ${slideNum} (${slide.type}) error:`, slideErr);
      s.addText(`Slide ${slideNum} could not be rendered: ${(slideErr as Error).message}`, {
        x: 0.5, y: 2.5, w: 9, h: 0.5, fontSize: 11, color: "DC2626", align: "center",
      });
    }
  }

  return (await pres.write({ outputType: "nodebuffer" })) as unknown as Buffer;
}

// ─── Upload to Supabase Storage ───────────────────────────────────────────────

async function uploadPptx(orgId: string, fileName: string, buffer: Buffer): Promise<{ url: string | null; error: string | null }> {
  const admin = createAdminClient();
  const path = `${orgId}/${fileName}`;

  // Create bucket if it doesn't exist (ignore "already exists" errors)
  const { error: bucketErr } = await admin.storage.createBucket("reports", { public: true });
  if (bucketErr && !bucketErr.message.includes("already exists")) {
    console.error("[uploadPptx] bucket:", bucketErr.message);
  }

  const { error: uploadErr } = await admin.storage
    .from("reports")
    .upload(path, buffer, {
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      upsert: true,
    });

  if (uploadErr) {
    console.error("[uploadPptx] upload:", uploadErr.message);
    return { url: null, error: `Storage upload failed: ${uploadErr.message}` };
  }

  const url = admin.storage.from("reports").getPublicUrl(path).data.publicUrl;
  return { url, error: null };
}

// ─── Legacy bulk generate (kept for backwards compat) ────────────────────────

export async function generateReports(
  orgId: string,
  sourceId: string,
  period: string,
  templateIds: string[],
  filteredRows?: Record<string, string>[]
): Promise<{ generated: number; errors: string[] }> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { generated: 0, errors: ["Not authenticated"] };

  const admin = createAdminClient();
  let rows: Record<string, string>[];
  if (filteredRows && filteredRows.length > 0) {
    rows = filteredRows;
  } else {
    const { rows: fetched, error } = await fetchSheetData(sourceId);
    if (error) return { generated: 0, errors: [error] };
    rows = fetched;
  }

  const { data: templates } = await admin.from("report_templates").select("*").in("id", templateIds);
  if (!templates?.length) return { generated: 0, errors: ["No templates found"] };

  const { data: brand } = await admin.from("brand_settings").select("*").eq("organization_id", orgId).single();
  const primaryColor = brand?.primary_color ?? "#6366f1";
  const secondaryColor = brand?.secondary_color ?? "#a5b4fc";
  const logoUrl = brand?.logo_url ?? null;

  let generated = 0;
  const errors: string[] = [];

  for (const template of templates) {
    const { data: reportRow } = await admin
      .from("reports")
      .insert({ organization_id: orgId, template_id: template.id, template_name: template.name, period, status: "generating", created_by: user.id })
      .select("id")
      .single();
    try {
      const { deck, error: planErr } = await planReport(orgId, template.id, rows, period);
      if (planErr || !deck) throw new Error(planErr ?? "Planning failed");
      const buffer = await buildPptx(deck, period, primaryColor, secondaryColor, logoUrl, "brand");
      const fileName = `${period.replace(/\s+/g, "-")}-${template.name.replace(/\s+/g, "-")}-${Date.now()}.pptx`;
      const { url: fileUrl, error: uploadErr } = await uploadPptx(orgId, fileName, buffer);
      if (uploadErr) throw new Error(uploadErr);
      if (reportRow) await admin.from("reports").update({ status: "done", file_url: fileUrl }).eq("id", reportRow.id);
      generated++;
    } catch (err) {
      errors.push(`${template.name}: ${(err as Error).message}`);
      if (reportRow) await admin.from("reports").update({ status: "failed", error: (err as Error).message }).eq("id", reportRow.id);
    }
  }
  return { generated, errors };
}

// ─── Slack notification ───────────────────────────────────────────────────────

/**
 * Build a Slack summary as a clean 2-column card grid — Slack's "fields"
 * layout — instead of one dense paragraph of bolded, icon-prefixed lines.
 * Each content slide becomes one short label/value card (label on top,
 * value below), laid out two per row with real spacing. Capped at 6 cards
 * (3 rows) so the message stays a glance, not a wall of text; anything
 * beyond that is a one-line footnote, not crammed in.
 */
function buildSlackSummaryBlocks(slides: SlideContent[]): object[] {
  const cards: { label: string; value: string }[] = [];

  for (const slide of slides) {
    if (slide.type === "title" || slide.type === "closing") continue;

    if (slide.type === "big_stat") {
      const arrow = slide.change_direction === "up" ? "↑" : slide.change_direction === "down" ? "↓" : "→";
      const icon = slide.change_direction === "up" ? "✅" : slide.change_direction === "down" ? "🔴" : "➡️";
      cards.push({ label: slide.label, value: `${icon} ${slide.value}  ${arrow} ${slide.change}` });

    } else if (slide.type === "kpi_grid") {
      const onTrack = slide.kpis.filter(k => k.status === "on_track").length;
      const offTrack = slide.kpis.filter(k => k.status === "off_track").length;
      const icon = offTrack === 0 ? "🎯" : "❌";
      cards.push({ label: slide.title, value: `${icon} ${onTrack}/${slide.kpis.length} on track` });

    } else if (slide.type === "progress_bars") {
      const onTrack = slide.items.filter(i => i.status === "on_track").length;
      const offTrack = slide.items.filter(i => i.status === "off_track").length;
      const icon = offTrack === 0 ? "📊" : "❌";
      cards.push({ label: slide.title, value: `${icon} ${onTrack}/${slide.items.length} on track` });

    } else if (slide.type === "insight") {
      const icon = slide.status === "positive" ? "✅" : slide.status === "negative" ? "🔴" : "💡";
      cards.push({ label: slide.title, value: `${icon} ${slide.stat} ${slide.stat_label}` });

    } else if (slide.type === "bar_chart" || slide.type === "line_chart") {
      const top = [...slide.series].sort((a, b) => b.value - a.value)[0];
      cards.push({ label: slide.title, value: top ? `📈 ${top.label} (${top.value})` : "📈 —" });

    } else if (slide.type === "pie_chart") {
      const lead = [...slide.segments].sort((a, b) => b.value - a.value)[0];
      cards.push({ label: slide.title, value: lead ? `🥧 ${lead.label} leads (${lead.value})` : "🥧 —" });

    } else if (slide.type === "bullet_list") {
      cards.push({ label: slide.title, value: `📋 ${slide.items[0] ?? "—"}` });

    } else if (slide.type === "action_plan") {
      const sorted = [...slide.items].sort((a, b) =>
        (a.priority === "high" ? 0 : a.priority === "medium" ? 1 : 2) - (b.priority === "high" ? 0 : b.priority === "medium" ? 1 : 2)
      );
      const top = sorted[0];
      cards.push({ label: slide.title, value: top ? `🧭 ${top.department} — ${top.recommendation}` : "🧭 —" });
    }
  }

  if (!cards.length) return [];

  const CAP = 6;
  const shown = cards.slice(0, CAP);
  const remaining = cards.length - shown.length;

  const blocks: object[] = [
    { type: "section", text: { type: "mrkdwn", text: " *Summary*" } },
    {
      type: "section",
      fields: shown.map((c) => ({ type: "mrkdwn", text: `*${c.label}*\n${c.value}` })),
    },
  ];

  if (remaining > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `+${remaining} more covered in the full report` }],
    });
  }

  return blocks;
}

export async function sendSlackNotification(
  webhookUrl: string,
  deckTitle: string,
  period: string,
  slidesCount: number,
  _fileUrl: string | null,   // kept for API compatibility — not sent to Slack
  message?: string,
  reviewUrl?: string,        // /review/{token} — the only CTA link
  slides?: SlideContent[]
): Promise<{ error?: string }> {
  if (!webhookUrl) return { error: "No webhook URL configured" };
  try {
    const blocks: object[] = [];

    // ── Personal message from sender ──────────────────────────────────────────
    if (message?.trim()) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `💬 ${message.trim()}` },
      });
      blocks.push({ type: "divider" });
    }

    // ── Report header ─────────────────────────────────────────────────────────
    blocks.push({
      type: "header",
      text: { type: "plain_text", text: `📊 ${deckTitle}`, emoji: true },
    });
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `Period: *${period}*  ·  ${slidesCount} slides` }],
    });
    blocks.push({ type: "divider" });

    // ── Deck content summary ──────────────────────────────────────────────────
    if (slides?.length) {
      const summaryBlocks = buildSlackSummaryBlocks(slides);
      blocks.push(...summaryBlocks);
      if (summaryBlocks.length) blocks.push({ type: "divider" });
    }

    // ── Single CTA — View Report (opens review page with slides + comments) ──
    if (reviewUrl) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "_Open the report to view all slides and leave feedback on individual slides._",
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "👁  View Report", emoji: true },
          url: reviewUrl,
          style: "primary",
        },
      });
    }

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });
    if (!res.ok) return { error: `Slack returned ${res.status}` };
    return {};
  } catch (err) {
    return { error: (err as Error).message };
  }
}
