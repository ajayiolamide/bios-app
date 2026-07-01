"use client";

import { useState, useEffect, useTransition } from "react";
import {
  Plus, Target, TrendingUp, Users, Settings, Package, Globe,
  Trash2, Loader2, Trophy, CheckCircle2, ChevronDown, Check,
  ChevronRight, Lightbulb, Zap, AlertCircle, Activity, RefreshCw,
  Calendar, ShieldAlert, Pencil, FileSpreadsheet, Sparkles, Circle, Bell,
} from "lucide-react";
import { useOrg } from "@/contexts/org-context";
import { cn } from "@/lib/utils";
import { EventCombobox } from "@/components/ui/event-combobox";
import { MetricsChart } from "@/components/metrics/metrics-chart";
import {
  getBusinessGoals,
  createBusinessGoal,
  updateGoalStatus,
  deleteBusinessGoal,
  permanentlyDeleteBusinessGoal,
  getGoalHealthData,
  updateGoalDates,
  proposeGoalFromDescription,
  proposeKpiFromDescription,
  type GoalHealthData,
  type FeatureHealthItem,
} from "@/app/actions/business-goals";
import { fetchMixpanelEventCounts, getMixpanelSettings, syncMixpanelRawEvents } from "@/app/actions/mixpanel";
import { getFeatureImpactSummaries, type FeatureImpactResult } from "@/app/actions/feature-impact";
import { addGuardrailToFeature } from "@/app/actions/feature-metrics";
import {
  getKpisByGoal, createGoalKpi, updateGoalKpi, deleteGoalKpi,
  getDistinctEventNames, attachEventToKpi, getKpiForRange,
  getGoalProgress, type MetricWithData, type GoalProgress,
} from "@/app/actions/metrics";
import type { MetricDataPoint } from "@/lib/metrics-engine";
import {
  getCompanyObjectives, createCompanyObjective, setGoalObjective,
  updateCompanyObjectiveStatus, deleteCompanyObjective,
  proposeObjectiveFromDescription,
} from "@/app/actions/company-objectives";
import { getReportSources, fetchSheetData } from "@/app/actions/reports";
import { getSheetRowOptions } from "@/app/actions/manual-kpi";
import type { BusinessGoal, FeatureSuggestion, Metric, CompanyObjective, ReportSource } from "@/types/database";
import { PageLoader } from "@/components/ui/page-loader";

// ─── Config ───────────────────────────────────────────────────────────────────

const GOAL_TYPES = [
  { value: "revenue",     label: "Revenue",     icon: TrendingUp, accent: "#10b981", light: "#ecfdf5", border: "#a7f3d0" },
  { value: "growth",      label: "Growth",      icon: Globe,      accent: "#6366f1", light: "#eef2ff", border: "#c7d2fe" },
  { value: "retention",   label: "Retention",   icon: Users,      accent: "#8b5cf6", light: "#f5f3ff", border: "#ddd6fe" },
  { value: "product",     label: "Product",     icon: Package,    accent: "#ec4899", light: "#fdf2f8", border: "#fbcfe8" },
  { value: "operational", label: "Operational", icon: Settings,   accent: "#f59e0b", light: "#fffbeb", border: "#fde68a" },
  { value: "market",      label: "Market",      icon: Target,     accent: "#0ea5e9", light: "#f0f9ff", border: "#bae6fd" },
] as const;

const TIMEFRAMES = [
  "Q1 2026","Q2 2026","Q3 2026","Q4 2026",
  "H1 2026","H2 2026","Annual 2026",
  "Q1 2027","Annual 2027",
];

const STATUS_OPTIONS: { value: BusinessGoal["status"]; label: string }[] = [
  { value: "active",   label: "Active" },
  { value: "achieved", label: "Achieved" },
  { value: "missed",   label: "Missed" },
  { value: "dropped",  label: "Dropped" },
];

function typeConfig(type: string) {
  return GOAL_TYPES.find((t) => t.value === type) ?? GOAL_TYPES[1];
}

// ─── Health helpers ───────────────────────────────────────────────────────────

function goalHealthStatus(features: FeatureHealthItem[], eventCounts: Record<string, number>) {
  if (!features.length) return "no-features" as const;
  // Only count launched features toward health
  const launchedFeatures = features.filter((f) => f.launch_status === "launched");
  if (!launchedFeatures.length) return "planned" as const;
  const trackableEvents = launchedFeatures.flatMap((f) =>
    f.suggestions.map((s) => s.event_name).filter(Boolean) as string[]
  );
  if (!trackableEvents.length) return "no-events" as const;
  const firing = trackableEvents.filter((e) => (eventCounts[e] ?? 0) > 0);
  if (firing.length === 0) return "not-started" as const;
  if (firing.length < trackableEvents.length) return "partial" as const;
  return "on-track" as const;
}

function HealthBadge({ status }: { status: ReturnType<typeof goalHealthStatus> }) {
  const map = {
    "no-features":  { label: "No features",       cls: "text-gray-400" },
    "planned":      { label: "Features planned",   cls: "text-blue-400" },
    "no-events":    { label: "No events defined",  cls: "text-gray-400" },
    "not-started":  { label: "Not tracking",       cls: "text-red-400" },
    "partial":      { label: "Partially tracking", cls: "text-amber-500" },
    "on-track":     { label: "Tracking active",    cls: "text-emerald-500" },
  };
  const { label, cls } = map[status];
  return (
    <span className={`text-[11px] font-medium ${cls}`}>{label}</span>
  );
}

// ─── Feature health row ───────────────────────────────────────────────────────

function ImpactBadge({ impact }: { impact?: FeatureImpactResult }) {
  if (!impact) return null;
  if (impact.status === "too_early") return <span className="text-[10px] font-medium text-gray-400">Impact: too early to tell</span>;
  if (impact.status === "insufficient_data" || impact.status === "no_kpi_defined") return <span className="text-[10px] font-medium text-gray-400">Impact: not enough data yet</span>;
  if (impact.status !== "computed" || !impact.verdict) return null;

  const map = {
    likely_positive: { label: "Likely positive impact", cls: "text-emerald-600 bg-emerald-50" },
    inconclusive:    { label: "Inconclusive",            cls: "text-amber-600 bg-amber-50" },
    likely_negative: { label: "Likely negative impact",  cls: "text-red-600 bg-red-50" },
  };
  const { label, cls } = map[impact.verdict];
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

function ImpactDetail({ impact }: { impact: FeatureImpactResult }) {
  const [open, setOpen] = useState(false);
  if (impact.status !== "computed" || (!impact.trend && !impact.cohort)) return null;
  return (
    <div className="px-3 py-2 bg-gray-50/60 border-t border-gray-50">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-[10px] font-medium text-gray-400 hover:text-gray-600">
        <ChevronRight size={9} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        Why this verdict?
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 text-[11px] text-gray-500 leading-relaxed">
          {impact.cohort && (
            <p>
              Among users active since launch: <strong className="text-gray-700">{impact.cohort.adopters}</strong> adopted{" "}
              <code className="text-indigo-500">{impact.cohort.adoptionEventName}</code>, <strong className="text-gray-700">{impact.cohort.nonAdopters}</strong> didn&apos;t.
              Adopters hit <code className="text-indigo-500">{impact.cohort.kpiEventName}</code> at <strong className="text-gray-700">{impact.cohort.adopterKpiRate}%</strong> vs{" "}
              <strong className="text-gray-700">{impact.cohort.nonAdopterKpiRate}%</strong> for non-adopters
              ({impact.cohort.liftPct >= 0 ? "+" : ""}{impact.cohort.liftPct}% lift).
              {impact.cohort.guardrailRegressed && (
                <span className="text-red-500"> Guardrail concern: adopters trip {impact.cohort.guardrailEventName} at {impact.cohort.adopterGuardrailRate}% vs {impact.cohort.nonAdopterGuardrailRate}% for non-adopters.</span>
              )}
            </p>
          )}
          {impact.trend && !impact.cohort && (
            <p>
              <code className="text-indigo-500">{impact.trend.kpiEventName}</code> averaged <strong className="text-gray-700">{impact.trend.preDailyAvg}/day</strong> in the {impact.trend.preDays} days before launch.
              Extrapolating that trend predicted <strong className="text-gray-700">{impact.trend.predictedPostDailyAvg}/day</strong> after launch — actual was{" "}
              <strong className="text-gray-700">{impact.trend.actualPostDailyAvg}/day</strong> ({impact.trend.deltaPct >= 0 ? "+" : ""}{impact.trend.deltaPct}% vs predicted).
            </p>
          )}
          <p className="text-gray-400 italic">{impact.caveat}</p>
        </div>
      )}
    </div>
  );
}

function AddGuardrailForm({ featureId, orgId, onDone, onCancel }: { featureId: string; orgId: string; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [eventName, setEventName] = useState("");
  // Optional — most guardrails are a standalone count (e.g. error_fired),
  // but some are really a rate (e.g. abandonment = start ÷ submit). Setting
  // this makes it a real computed ratio instead of a flat count.
  const [comparing, setComparing] = useState(false);
  const [comparedEventName, setComparedEventName] = useState("");
  const [eventNames, setEventNames] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { getDistinctEventNames(orgId).then(setEventNames); }, [orgId]);

  async function handleSave() {
    if (!name.trim() || !eventName.trim()) { setError("Name and event are required."); return; }
    if (comparing && !comparedEventName.trim()) { setError("Set the event to compare against, or turn that off."); return; }
    setSaving(true);
    setError("");
    const result = await addGuardrailToFeature(featureId, orgId, {
      name: name.trim(),
      description: `Guardrail — should not increase when this feature is adopted.`,
      eventName: eventName.trim(),
      comparedEventName: comparing ? comparedEventName.trim() : null,
    });
    setSaving(false);
    if (result.error) { setError(result.error); return; }
    onDone();
  }

  return (
    <div className="px-3 py-2.5 space-y-1.5 border-t border-gray-50">
      <input
        autoFocus
        type="text"
        placeholder="Guardrail name, e.g. Search failures"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full border border-gray-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-300"
      />
      <EventCombobox
        value={eventName}
        onChange={setEventName}
        options={eventNames}
        placeholder="event_name, e.g. hosp_search_failed"
        className="w-full"
      />
      {!comparing ? (
        <button type="button" onClick={() => setComparing(true)} className="text-[10px] font-medium text-indigo-500 hover:text-indigo-700">
          + Compare against another event (e.g. abandonment rate)
        </button>
      ) : (
        <div className="flex items-center gap-1.5">
          <EventCombobox
            value={comparedEventName}
            onChange={setComparedEventName}
            options={eventNames}
            placeholder="event to divide by, e.g. claim_start_clicked"
            className="flex-1"
          />
          <button type="button" onClick={() => { setComparing(false); setComparedEventName(""); }} className="text-[10px] text-gray-400 hover:text-red-500">
            Remove
          </button>
        </div>
      )}
      {error && <p className="text-[10px] text-red-500">{error}</p>}
      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-40">
          {saving ? "Saving…" : "Save guardrail"}
        </button>
        <button onClick={onCancel} className="text-[11px] text-gray-400 hover:text-gray-600">Cancel</button>
      </div>
    </div>
  );
}

function FeatureHealthRow({ feature, eventCounts, impact, kpiName, orgId, onGuardrailAdded }: { feature: FeatureHealthItem; eventCounts: Record<string, number>; impact?: FeatureImpactResult; kpiName?: string | null; orgId?: string; onGuardrailAdded?: () => void }) {
  const trackable = feature.suggestions.filter((s) => s.event_name) as (FeatureSuggestion & { event_name: string })[];
  const totalFiring = trackable.filter((s) => (eventCounts[s.event_name] ?? 0) > 0).length;
  const isLaunched = feature.launch_status === "launched";
  const [addingGuardrail, setAddingGuardrail] = useState(false);

  return (
    <div className={`border rounded-xl overflow-hidden ${isLaunched ? "border-gray-100" : "border-blue-100"}`}>
      {/* Feature header */}
      <div className={`flex items-center gap-2.5 px-3 py-2.5 ${isLaunched ? "bg-gray-50" : "bg-blue-50"}`}>
        <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${isLaunched ? "bg-indigo-100" : "bg-blue-100"}`}>
          <Lightbulb size={11} className={isLaunched ? "text-indigo-500" : "text-blue-400"} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-700 truncate">{feature.feature_name}</p>
          <p className="text-[10px] text-gray-400 truncate">
            {kpiName ? `Targets: ${kpiName}` : "No KPI selected"}
          </p>
        </div>
        {isLaunched ? (
          <span className="text-[11px] text-gray-400 flex-shrink-0">
            {totalFiring}/{trackable.length} firing
          </span>
        ) : (
          <span className="text-[11px] text-blue-400 flex-shrink-0">
            🗓 {feature.planned_launch_date ? `Launches ${feature.planned_launch_date}` : "Planned"}
          </span>
        )}
      </div>

      {/* Impact verdict — separate from "is it firing", answers "is it working" */}
      {isLaunched && impact && (
        <div className="px-3 py-2 border-t border-gray-50">
          <ImpactBadge impact={impact} />
        </div>
      )}

      {/* Tracking items */}
      {!isLaunched ? (
        <p className="text-[11px] text-blue-400 px-3 py-2.5 italic">
          Tracking will start counting once this feature launches.
        </p>
      ) : trackable.length === 0 ? (
        <p className="text-xs text-gray-400 px-3 py-2">No event names defined for this feature.</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {trackable.map((s) => {
            const count = eventCounts[s.event_name] ?? 0;
            const firing = count > 0;
            const isGuardrail = s.type === "guardrail";
            return (
              <div key={s.event_name} className="flex items-center gap-2.5 px-3 py-2">
                {isGuardrail
                  ? <ShieldAlert size={13} className={firing ? "text-amber-500 flex-shrink-0" : "text-gray-300 flex-shrink-0"} />
                  : firing
                  ? <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
                  : <AlertCircle size={13} className="text-gray-300 flex-shrink-0" />}
                <div className="flex-1 min-w-0 truncate">
                  {isGuardrail && <span className="text-[9px] font-semibold uppercase tracking-wide text-amber-500 mr-1.5">Guardrail</span>}
                  <code className="text-[11px] text-indigo-600 font-mono">{s.event_name}</code>
                  <span className="text-[11px] text-gray-400 ml-2">{s.name}</span>
                </div>
                <span className={`text-[11px] font-medium flex-shrink-0 whitespace-nowrap ${
                  isGuardrail ? (firing ? "text-amber-600" : "text-gray-300") : firing ? "text-emerald-600" : "text-gray-300"
                }`}>
                  {firing ? `${count.toLocaleString()} events` : "no events yet"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Add a guardrail after the fact — you often don't know what to watch
          for until the feature is live and people are actually using it. */}
      {orgId && !addingGuardrail && (
        <button
          onClick={() => setAddingGuardrail(true)}
          className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[11px] font-medium text-gray-400 hover:text-amber-600 border-t border-gray-50 transition-colors"
        >
          <ShieldAlert size={11} /> Add guardrail
        </button>
      )}
      {orgId && addingGuardrail && (
        <AddGuardrailForm
          featureId={feature.id}
          orgId={orgId}
          onDone={() => { setAddingGuardrail(false); onGuardrailAdded?.(); }}
          onCancel={() => setAddingGuardrail(false)}
        />
      )}

      {isLaunched && impact && <ImpactDetail impact={impact} />}
    </div>
  );
}

// ─── Goal-level KPIs ────────────────────────────────────────────────────────────
// A KPI is the measurable breakdown of the goal, defined once, independent of
// any feature. Features below pick which of these they're meant to move.

function WireEventForm({ kpi, orgId, onDone }: { kpi: MetricWithData; orgId: string; onDone: () => void }) {
  const [eventNames, setEventNames] = useState<string[]>([]);
  const [eventName, setEventName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { getDistinctEventNames(orgId).then(setEventNames); }, [orgId]);

  async function handleSave() {
    if (!eventName.trim()) return;
    setSaving(true);
    await attachEventToKpi(kpi.id, eventName.trim());
    setSaving(false);
    onDone();
  }

  return (
    <div className="flex items-center gap-1.5 py-1.5">
      <EventCombobox
        value={eventName}
        onChange={setEventName}
        options={eventNames}
        placeholder={eventNames.length > 0 ? "Search events…" : "event_name"}
        className="flex-1"
      />
      <button
        onClick={handleSave}
        disabled={saving || !eventName.trim()}
        className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-40 px-1.5"
      >
        {saving ? "Saving…" : "Wire up"}
      </button>
    </div>
  );
}

// Last 6 calendar months (current month-to-date, then 5 full months back) —
// used by the KPI row's range picker so a goal like "95% paid within 24h"
// can be checked month by month instead of only ever "the trailing 30 days
// as of right now."
function getMonthOptions(): { label: string; since: string; until: string }[] {
  const now = new Date();
  const opts: { label: string; since: string; until: string }[] = [];
  for (let i = 0; i < 6; i++) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    opts.push({
      label: monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
      since: monthStart.toISOString(),
      until: monthEnd.toISOString(),
    });
  }
  return opts;
}

// Quick rolling-window presets (last N full days, inclusive of today) — sit
// above the calendar-month list for the common case of "how are we doing
// this week / this quarter" without picking a specific month. "Last 30 days"
// is deliberately NOT in here: that one is the page's existing default
// (picked === null), computed server-side with an open-ended `until` so it
// always reads as of right now rather than as of the start of today.
function getQuickRanges(): { label: string; since: string; until: string }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const until = new Date(startOfToday);
  until.setDate(until.getDate() + 1); // exclusive upper bound, covers all of today
  const mk = (days: number, label: string) => {
    const since = new Date(startOfToday);
    since.setDate(since.getDate() - (days - 1));
    return { label, since: since.toISOString(), until: until.toISOString() };
  };
  return [mk(7, "Last 7 days"), mk(90, "Last 90 days")];
}

// Shared by both KpiRow variants below (the rate/count-with-reference-event
// one and the plain volume one) — lets either swap its "last 30 days"
// number for a specific calendar month on demand, without changing what
// anything else on the page sees by default.
function RangePicker({
  metricId, defaultTotal, defaultTrend, asPercentage, unit, onResult,
}: {
  metricId: string;
  defaultTotal: number;
  defaultTrend: MetricDataPoint[];
  asPercentage: boolean;
  unit: string;
  onResult?: (trend: MetricDataPoint[], label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{ label: string; since: string; until: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ total: number; trend: MetricDataPoint[] } | null>(null);

  async function pick(opt: { label: string; since: string; until: string } | null) {
    setOpen(false);
    setPicked(opt);
    if (!opt) { setResult(null); onResult?.(defaultTrend, "30d"); return; }
    setLoading(true);
    const res = await getKpiForRange(metricId, opt.since, opt.until);
    setLoading(false);
    if (!res.error) { setResult(res); onResult?.(res.trend, opt.label); }
  }

  const shownTotal = picked ? (result?.total ?? null) : defaultTotal;
  const shownLabel = picked ? picked.label : "30d";

  return (
    <div className="text-right flex-shrink-0 relative">
      <p className="text-sm font-bold text-gray-900 tabular-nums">
        {loading ? <Loader2 size={13} className="animate-spin inline text-gray-300" /> : shownTotal === null ? "—" : asPercentage ? `${shownTotal}%` : shownTotal.toLocaleString()}
      </p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-indigo-600 transition-colors ml-auto"
      >
        {picked ? shownLabel : `${unit} · ${shownLabel}`}
        <ChevronDown size={9} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-20 w-44 bg-white border border-gray-100 rounded-xl shadow-lg py-1">
            <button
              onClick={() => pick(null)}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors ${!picked ? "text-indigo-600 font-semibold" : "text-gray-600"}`}
            >
              Last 30 days
            </button>
            {getQuickRanges().map((opt) => (
              <button
                key={opt.label}
                onClick={() => pick(opt)}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors ${picked?.label === opt.label ? "text-indigo-600 font-semibold" : "text-gray-600"}`}
              >
                {opt.label}
              </button>
            ))}
            <div className="h-px bg-gray-100 my-1" />
            {getMonthOptions().map((opt) => (
              <button
                key={opt.label}
                onClick={() => pick(opt)}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors ${picked?.label === opt.label ? "text-indigo-600 font-semibold" : "text-gray-600"}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function KpiRow({ kpi, featureCount, orgId, onWired, onEdit, onDelete }: {
  kpi: MetricWithData; featureCount: number; orgId: string; onWired: () => void;
  onEdit: () => void; onDelete: () => void;
}) {
  const unit = kpi.aggregation === "count" ? "events" : kpi.aggregation === "unique_users" ? "users" : "sessions";
  const [wiring, setWiring] = useState(false);
  // Trend chart is collapsed by default — KPI Trends used to be a whole
  // separate page for this; now it's just a toggle on the row that already
  // has the number, so there's one place to look instead of two.
  const [showChart, setShowChart] = useState(false);
  // Follows whatever range the RangePicker (next to the number) is currently
  // showing, so toggling the chart open reflects the same window as the
  // number above it instead of always silently falling back to 30 days.
  const [chartTrend, setChartTrend] = useState<MetricDataPoint[]>(kpi.trend);
  const [chartLabel, setChartLabel] = useState("30-day trend");

  // A KPI's raw per-occurrence data (needed for time-window/match-key
  // matching) only ever lands in the events table via the "Pull Mixpanel
  // Data" sync up on the goal — but that sync's event list comes from
  // FEATURES linked to the goal, not from the KPI itself. A KPI with no
  // linked feature (very common right after creating it, or after a
  // backfill delete) had no way to get its own event_name/
  // denominator_event_name re-synced. This button fixes that by syncing
  // exactly this KPI's events directly, the same manual-sync pattern as the
  // Funnel cards.
  const [mpConnected, setMpConnected] = useState(false);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!kpi.event_name) return;
    getMixpanelSettings(orgId).then(({ connected }) => setMpConnected(connected));
  }, [orgId, kpi.event_name]);

  async function handleSyncMixpanel() {
    if (syncState === "syncing") return;
    const eventNames = [kpi.event_name, kpi.denominator_event_name].filter(Boolean) as string[];
    if (!eventNames.length) return;
    setSyncState("syncing");
    setSyncMsg(null);
    const result = await syncMixpanelRawEvents(orgId, eventNames, 90);
    if (result.error) {
      setSyncState("error");
      setSyncMsg(result.error);
    } else {
      setSyncState("done");
      setSyncMsg(result.synced > 0 ? `Pulled ${result.synced.toLocaleString()} new event${result.synced !== 1 ? "s" : ""}` : "Already up to date");
      onWired(); // refetch this KPI's totals/trend now that fresh rows may have landed
    }
  }

  // Shown on hover on every variant of this row — same actions regardless
  // of whether the KPI is wired, a rate, or a plain volume KPI. The trend
  // toggle only makes sense once there's an event actually producing data.
  const RowActions = (
    <span className="hidden group-hover:flex items-center gap-1.5 flex-shrink-0">
      {kpi.event_name && mpConnected && (
        <button
          onClick={handleSyncMixpanel}
          title="Pull this KPI's raw events from Mixpanel"
          disabled={syncState === "syncing"}
          className="text-gray-300 hover:text-indigo-600 transition-colors disabled:opacity-50"
        >
          {syncState === "syncing" ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
        </button>
      )}
      {kpi.event_name && (
        <button onClick={() => setShowChart(v => !v)} title={showChart ? "Hide trend" : "Show trend"} className={`transition-colors ${showChart ? "text-indigo-500" : "text-gray-300 hover:text-indigo-600"}`}>
          <TrendingUp size={11} />
        </button>
      )}
      <button onClick={onEdit} title="Edit KPI" className="text-gray-300 hover:text-indigo-600 transition-colors">
        <Pencil size={11} />
      </button>
      <button onClick={onDelete} title="Delete KPI" className="text-gray-300 hover:text-red-500 transition-colors">
        <Trash2 size={11} />
      </button>
    </span>
  );

  const chartPanel = showChart && kpi.event_name ? (
    <div className="pb-3 -mt-1">
      <MetricsChart metrics={[{ ...kpi, trend: chartTrend }]} title={`${kpi.name} — ${chartLabel}`} />
    </div>
  ) : null;

  // RowActions only shows on hover — without this, the result of a sync
  // click would vanish the instant the mouse leaves the row, before anyone
  // gets to read it.
  const syncMsgPanel = syncMsg ? (
    <p className={`text-[10px] pb-1.5 -mt-0.5 ${syncState === "error" ? "text-red-500" : "text-gray-400"}`}>{syncMsg}</p>
  ) : null;

  function handleRangeResult(trend: MetricDataPoint[], label: string) {
    setChartTrend(trend);
    setChartLabel(label === "30d" ? "30-day trend" : `${label} trend`);
  }

  // Manually sourced from a connected sheet row (migration 029) — no event,
  // but a real number, so it shouldn't fall into the "not yet measurable"
  // branch below just because event_name is empty.
  if (!kpi.event_name && kpi.source_report_id && kpi.source_row_value) {
    return (
      <div className="group py-2 border-b border-gray-50 last:border-0">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-700 truncate">{kpi.name}</p>
            <p className="flex items-center gap-1 text-[11px] text-gray-400 truncate">
              <FileSpreadsheet size={10} className="flex-shrink-0" />
              From sheet row &quot;{kpi.source_row_value}&quot;
              {kpi.target && <span> · Target: {kpi.target}</span>}
              {typeof kpi.target_value === "number" && <span> · Goal: {kpi.target_value.toLocaleString()}</span>}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-sm font-bold text-gray-900 tabular-nums">{kpi.total.toLocaleString()}</p>
            <p className="text-[10px] text-gray-400">latest month</p>
          </div>
          {RowActions}
          <span className="text-[10px] text-gray-400 flex-shrink-0 w-16 text-right">
            {featureCount} feature{featureCount !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
    );
  }

  if (!kpi.event_name) {
    return (
      <div className="group py-2 border-b border-gray-50 last:border-0">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-700 truncate">{kpi.name}</p>
            <p className="text-[11px] text-amber-500">
              Defined, not yet measurable — no event wired up{kpi.target ? ` · Target: ${kpi.target}` : ""}
            </p>
          </div>
          {!wiring && (
            <button onClick={() => setWiring(true)} className="text-[11px] font-medium text-indigo-500 hover:text-indigo-700 flex-shrink-0">
              Wire up event
            </button>
          )}
          {RowActions}
          <span className="text-[10px] text-gray-400 flex-shrink-0 w-16 text-right">
            {featureCount} feature{featureCount !== 1 ? "s" : ""}
          </span>
        </div>
        {wiring && <WireEventForm kpi={kpi} orgId={orgId} onDone={() => { setWiring(false); onWired(); }} />}
      </div>
    );
  }

  // KPI with a "reference event" property (migrations 024/026/027) — four
  // combinations depending on rate_as_percentage × within_hours. See
  // createGoalKpi's comment in metrics.ts for what each one computes.
  if (kpi.denominator_event_name) {
    const hasWindow = typeof kpi.within_hours === "number" && kpi.within_hours > 0;
    const asPercentage = kpi.rate_as_percentage !== false;

    const relation = hasWindow ? `within ${kpi.within_hours}h of` : "÷";
    // Migration 034 — when set, the wording should say so plainly: matching
    // is exact (same policy_id, or whatever property was named), not a
    // same-person-in-order guess.
    const matchedBy = kpi.match_key_property
      ? `matched by ${kpi.match_key_property} — exact, not guessed (occurrences missing this property are excluded, not guessed by person)`
      : "each occurrence checked on its own, so one fast match can't cover the rest of that same person's other claims";
    const caveat = hasWindow && asPercentage
      ? `% of individual ${kpi.denominator_event_name} occurrences whose own matching ${kpi.event_name} landed within ${kpi.within_hours}h — ${matchedBy}. Still-pending occurrences (no match yet, but within ${kpi.within_hours}h) aren't counted either way until their window runs out. A match under 1h is treated as implausible/test data and discarded rather than counted as a win.`
      : hasWindow && !asPercentage
      ? `Raw count of times the second event got a matching first event within ${kpi.within_hours}h — ${matchedBy}.`
      : `Plain ratio over this window — two separate headcounts, not a per-record check (it won't verify the two events belong to the same record unless you've added a time window above).`;

    return (
      <div className="group">
        <div className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-700 truncate">{kpi.name}</p>
            <p className="text-[11px] text-gray-400 truncate">
              <code className="text-indigo-500">{kpi.event_name}</code>
              {` ${relation} `}
              <code className="text-indigo-500">{kpi.denominator_event_name}</code>
              {kpi.target && <span> · Target: {kpi.target}</span>}
              {typeof kpi.target_value === "number" && (
                <span> · Goal: {asPercentage ? `${kpi.target_value}%` : kpi.target_value.toLocaleString()}</span>
              )}
            </p>
            <p className="text-[10px] text-gray-400 italic mt-0.5">{caveat}</p>
          </div>
          <RangePicker
            metricId={kpi.id}
            defaultTotal={kpi.total}
            defaultTrend={kpi.trend}
            asPercentage={asPercentage}
            unit={asPercentage ? "rate" : "matched"}
            onResult={handleRangeResult}
          />
          {RowActions}
          <span className="text-[10px] text-gray-400 flex-shrink-0 w-16 text-right">
            {featureCount} feature{featureCount !== 1 ? "s" : ""}
          </span>
        </div>
        {syncMsgPanel}
        {chartPanel}
      </div>
    );
  }

  return (
    <div className="group">
      <div className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-700 truncate">{kpi.name}</p>
          <p className="text-[11px] text-gray-400 truncate">
            <code className="text-indigo-500">{kpi.event_name}</code>
            {kpi.target && <span> · Target: {kpi.target}</span>}
            {typeof kpi.target_value === "number" && <span> · Goal: {kpi.target_value.toLocaleString()} {unit}</span>}
          </p>
        </div>
        <RangePicker
          metricId={kpi.id}
          defaultTotal={kpi.total}
          defaultTrend={kpi.trend}
          asPercentage={false}
          unit={unit}
          onResult={handleRangeResult}
        />
        {RowActions}
        <span className="text-[10px] text-gray-400 flex-shrink-0 w-16 text-right">
          {featureCount} feature{featureCount !== 1 ? "s" : ""}
        </span>
      </div>
      {syncMsgPanel}
      {chartPanel}
    </div>
  );
}

// Shared by both "Add KPI" and "Edit KPI" — pass `initial` (an existing
// Metric) to prefill everything and save via updateGoalKpi instead of
// createGoalKpi. Without it, this is a brand-new KPI on the goal.
function KpiForm({ orgId, goalId, initial, onSaved, onCancel }: { orgId: string; goalId: string; initial?: Metric; onSaved: () => void; onCancel: () => void }) {
  const [eventNames, setEventNames] = useState<string[]>([]);
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    event_name: initial?.event_name ?? "",
    aggregation: initial?.aggregation ?? "unique_users",
    target: initial?.target ?? "",
    target_value: typeof initial?.target_value === "number" ? String(initial.target_value) : "",
  });

  // How this KPI's number gets measured — a tracked event (Mixpanel/
  // Amplitude/app SDK), or a row in a connected sheet for operational
  // numbers nothing tracks (e.g. claims paid within 24hrs, from asking ops
  // and typing the answer into the sheet). See migration 029.
  const [sourceMode, setSourceMode] = useState<"event" | "manual">(
    initial?.source_report_id && initial?.source_row_value ? "manual" : "event"
  );
  const [sources, setSources] = useState<ReportSource[]>([]);
  const [sheetHeaders, setSheetHeaders] = useState<string[]>([]);
  const [rowOptions, setRowOptions] = useState<string[]>([]);
  const [manual, setManual] = useState({
    reportSourceId: initial?.source_report_id ?? "",
    labelColumn: initial?.source_label_column ?? "",
    rowValue: initial?.source_row_value ?? "",
  });
  const [loadingHeaders, setLoadingHeaders] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);

  useEffect(() => { getReportSources(orgId).then(setSources); }, [orgId]);

  // Re-fetch the sheet's real column headers whenever the picked source
  // changes — same "don't let the user type a column name that doesn't
  // exist" rule as the Sources page's parameter config.
  useEffect(() => {
    if (!manual.reportSourceId) { setSheetHeaders([]); return; }
    setLoadingHeaders(true);
    fetchSheetData(manual.reportSourceId).then(({ headers }) => {
      setSheetHeaders(headers);
      setLoadingHeaders(false);
    });
  }, [manual.reportSourceId]);

  // Re-fetch the real distinct values in the picked label column, so "which
  // row is this KPI" is a pick-from-what's-actually-there list, not free text.
  useEffect(() => {
    if (!manual.reportSourceId || !manual.labelColumn) { setRowOptions([]); return; }
    setLoadingRows(true);
    getSheetRowOptions(manual.reportSourceId, manual.labelColumn).then(({ options }) => {
      setRowOptions(options);
      setLoadingRows(false);
    });
  }, [manual.reportSourceId, manual.labelColumn]);
  // null = plain KPI on form.event_name alone. Set = the KPI is also
  // measured against a reference event — express it as a % of that event,
  // and/or only count it within so many hours of that event. Either
  // checkbox can be on alone, or both together; the four resulting
  // combinations are exactly the 4 display cases in KpiRow.
  const [property, setProperty] = useState<null | {
    referenceEvent: string;
    asPercentage: boolean;
    withinHoursEnabled: boolean;
    withinHours: string;
    // Migration 034 — name of a property both events share (e.g. "policy_id")
    // that ties one occurrence of each together exactly. Optional: blank
    // keeps the existing same-user-in-order matching.
    matchKeyProperty: string;
    // Migration 043 — configurable matching rules. Blank = use legacy defaults
    // (1h min gap when match key is set, 5min dedup window).
    minElapsedHours: string;
    dedupeMinutes: string;
  }>(
    initial?.denominator_event_name
      ? {
          referenceEvent: initial.denominator_event_name,
          asPercentage: initial.rate_as_percentage !== false,
          withinHoursEnabled: typeof initial.within_hours === "number" && initial.within_hours > 0,
          withinHours: typeof initial.within_hours === "number" ? String(initial.within_hours) : "",
          matchKeyProperty: initial.match_key_property ?? "",
          minElapsedHours: initial.min_elapsed_hours != null ? String(initial.min_elapsed_hours) : "",
          dedupeMinutes: initial.dedupe_minutes != null ? String(initial.dedupe_minutes) : "",
        }
      : null
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { getDistinctEventNames(orgId).then(setEventNames); }, [orgId]);

  async function handleSave() {
    if (!form.name.trim()) { setError("Name is required."); return; }
    if (sourceMode === "manual") {
      if (!manual.reportSourceId || !manual.labelColumn || !manual.rowValue) {
        setError("Pick a sheet, the column that names each row, and which row is this KPI.");
        return;
      }
    }
    if (sourceMode === "event" && property) {
      if (!form.event_name.trim() || !property.referenceEvent.trim()) {
        setError("A KPI with a property needs both events — the one being measured and the reference event.");
        return;
      }
      if (!property.asPercentage && !property.withinHoursEnabled) {
        setError("Turn on at least one of the two checkboxes, or remove the property.");
        return;
      }
      if (property.withinHoursEnabled && !property.withinHours.trim()) {
        setError("Set how many hours, or turn that checkbox off.");
        return;
      }
    }
    setSaving(true);
    setError("");
    const payload = {
      ...form,
      event_name: sourceMode === "event" ? form.event_name.trim() || null : null,
      denominator_event_name: sourceMode === "event" && property ? property.referenceEvent.trim() || null : null,
      within_hours: sourceMode === "event" && property?.withinHoursEnabled && property.withinHours.trim() ? Number(property.withinHours) : null,
      rate_as_percentage: sourceMode === "event" && property ? property.asPercentage : true,
      match_key_property: sourceMode === "event" && property?.withinHoursEnabled && property.matchKeyProperty.trim() ? property.matchKeyProperty.trim() : null,
      min_elapsed_hours: sourceMode === "event" && property?.withinHoursEnabled && property.minElapsedHours.trim() !== "" ? Number(property.minElapsedHours) : null,
      dedupe_minutes: sourceMode === "event" && property?.withinHoursEnabled && property.dedupeMinutes.trim() !== "" ? Number(property.dedupeMinutes) : null,
      target_value: form.target_value.trim() ? Number(form.target_value) : null,
      source_report_id: sourceMode === "manual" ? manual.reportSourceId : null,
      source_label_column: sourceMode === "manual" ? manual.labelColumn : null,
      source_row_value: sourceMode === "manual" ? manual.rowValue : null,
    };
    const result = initial
      ? await updateGoalKpi(initial.id, payload)
      : await createGoalKpi(orgId, goalId, payload);
    setSaving(false);
    if (result.error) { setError(result.error); return; }
    onSaved();
  }

  return (
    <div className="space-y-2 pt-1">
      <input
        autoFocus
        type="text"
        placeholder="KPI name, e.g. Claims completed within 48h"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
      />

      {/* How this KPI gets measured — a tracked event, or a row in a
          connected sheet for operational numbers nothing tracks. */}
      <div className="flex items-center gap-1.5 pt-0.5">
        {(["event", "manual"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setSourceMode(m)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
              sourceMode === m ? "bg-indigo-50 border-indigo-200 text-indigo-600" : "bg-white border-gray-200 text-gray-400 hover:text-gray-600"
            }`}
          >
            {m === "event" ? "Tracked event" : "Manual / from sheet"}
          </button>
        ))}
      </div>

      {sourceMode === "event" && (
        <>
          <p className="text-[10px] text-gray-400">
            Event is optional — define the KPI now, wire up the event that measures it whenever it&apos;s ready.
          </p>
          <div className="flex items-center gap-1.5">
            <EventCombobox
              value={form.event_name}
              onChange={(v) => setForm({ ...form, event_name: v })}
              options={eventNames}
              placeholder={eventNames.length > 0 ? "No event yet — search events…" : "event_name (optional)"}
              className="flex-1"
            />
            <select
              value={form.aggregation}
              onChange={(e) => setForm({ ...form, aggregation: e.target.value as "count" | "unique_users" | "unique_sessions" })}
              disabled={!!property?.withinHoursEnabled && property.asPercentage}
              title={property?.withinHoursEnabled && property.asPercentage ? "Ignored — time-matched rates always match by user" : undefined}
              className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300 disabled:opacity-40"
            >
              <option value="unique_users">Unique users</option>
              <option value="count">Event count</option>
              <option value="unique_sessions">Unique sessions</option>
            </select>
          </div>
        </>
      )}

      {sourceMode === "manual" && (
        <div className="border border-gray-200 rounded-lg p-2.5 space-y-2 bg-gray-50/60">
          <p className="text-[10px] text-gray-400">
            Pulls this KPI&apos;s number from a row in a sheet you&apos;ve already connected (Reports → Sources) — for numbers nothing tracks automatically, like asking ops how long claims took and typing the answer in.
          </p>
          {sources.length === 0 ? (
            <p className="text-[11px] text-amber-600">
              No sheet connected yet — add one on the Reports page first.
            </p>
          ) : (
            <>
              <select
                value={manual.reportSourceId}
                onChange={(e) => setManual({ reportSourceId: e.target.value, labelColumn: "", rowValue: "" })}
                className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300"
              >
                <option value="">Which sheet?</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {manual.reportSourceId && (
                <select
                  value={manual.labelColumn}
                  onChange={(e) => setManual({ ...manual, labelColumn: e.target.value, rowValue: "" })}
                  disabled={loadingHeaders}
                  className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300 disabled:opacity-50"
                >
                  <option value="">{loadingHeaders ? "Loading columns…" : "Which column names each row?"}</option>
                  {sheetHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              )}
              {manual.labelColumn && (
                <select
                  value={manual.rowValue}
                  onChange={(e) => setManual({ ...manual, rowValue: e.target.value })}
                  disabled={loadingRows}
                  className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300 disabled:opacity-50"
                >
                  <option value="">{loadingRows ? "Loading rows…" : "Which row is this KPI?"}</option>
                  {rowOptions.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              )}
              <p className="text-[10px] text-gray-400">
                Reads whichever month column (e.g. &quot;May - Value&quot;) is most recent at or before today.
              </p>
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <input
          type="number"
          placeholder={property?.asPercentage ? "Target %, e.g. 95" : "Numeric goal, e.g. 5000 (optional)"}
          value={form.target_value}
          onChange={(e) => setForm({ ...form, target_value: e.target.value })}
          className="flex-1 border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
        />
        <input
          type="text"
          placeholder="Note, e.g. by end of Q2 (optional)"
          value={form.target}
          onChange={(e) => setForm({ ...form, target: e.target.value })}
          className="flex-1 border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
        />
      </div>
      <p className="text-[10px] text-gray-400">
        {sourceMode === "manual"
          ? "Numeric goal is in the same unit as the sheet's value column — that's what lets this goal's progress actually compute."
          : property?.asPercentage
          ? "Target is a percentage — computed against the reference event below."
          : "Numeric goal is in the same unit as above (users/events/sessions) — that's what lets this goal's progress actually compute."}
      </p>

      {sourceMode === "event" && (
        property === null ? (
          <button
            type="button"
            onClick={() => setProperty({ referenceEvent: "", asPercentage: false, withinHoursEnabled: false, withinHours: "", matchKeyProperty: "", minElapsedHours: "", dedupeMinutes: "" })}
            className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
          >
            + Add property
          </button>
        ) : (
          <div className="border border-gray-200 rounded-lg p-2.5 space-y-2 bg-gray-50/60">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium text-gray-500">Reference event</p>
              <button
                type="button"
                onClick={() => setProperty(null)}
                className="text-[10px] text-gray-400 hover:text-red-500"
              >
                Remove
              </button>
            </div>
            <p className="text-[10px] text-gray-400">
              Some KPIs can&apos;t stand alone — they only mean something next to another event (e.g. claim_paid out of claim_start_clicked). Pick that event, then choose how it should be used below. Either box, or both.
            </p>
            <EventCombobox
              value={property.referenceEvent}
              onChange={(v) => setProperty({ ...property, referenceEvent: v })}
              options={eventNames}
              placeholder="Search events…"
              className="w-full"
            />
            <label className="flex items-start gap-1.5 text-[11px] text-gray-600">
              <input
                type="checkbox"
                checked={property.asPercentage}
                onChange={(e) => setProperty({ ...property, asPercentage: e.target.checked })}
                className="mt-0.5"
              />
              <span>Express as a percentage of the reference event (e.g. 95% of claim_start_clicked)</span>
            </label>
            <label className="flex items-start gap-1.5 text-[11px] text-gray-600">
              <input
                type="checkbox"
                checked={property.withinHoursEnabled}
                onChange={(e) => setProperty({ ...property, withinHoursEnabled: e.target.checked })}
                className="mt-0.5"
              />
              <span>Only count it within a number of hours of the reference event — matched per user, not as two separate headcounts</span>
            </label>
            {property.withinHoursEnabled && (
              <div className="pl-5 space-y-2">
                <input
                  type="number"
                  min={1}
                  placeholder="Hours, e.g. 24"
                  value={property.withinHours}
                  onChange={(e) => setProperty({ ...property, withinHours: e.target.value })}
                  className="w-32 border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
                />
                <div>
                  <input
                    type="text"
                    placeholder="Match by property (optional), e.g. policy_id"
                    value={property.matchKeyProperty}
                    onChange={(e) => setProperty({ ...property, matchKeyProperty: e.target.value })}
                    className="w-64 border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
                  />
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    If both events carry the same value for this property (e.g. both fire with the same policy_id), matching uses it directly instead of guessing by person and order. Leave blank to keep matching by same user.
                  </p>
                </div>
                <div className="border-t border-gray-100 pt-2 space-y-1.5">
                  <p className="text-[10px] font-medium text-gray-500">Matching rules <span className="font-normal text-gray-400">(leave blank for defaults)</span></p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        placeholder={property.matchKeyProperty.trim() ? "Min gap h (default 1)" : "Min gap h (default 0)"}
                        value={property.minElapsedHours}
                        onChange={(e) => setProperty({ ...property, minElapsedHours: e.target.value })}
                        className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
                      />
                      <p className="text-[10px] text-gray-400 mt-0.5">Min gap between start and outcome (hours). Set to 0 to disable.</p>
                    </div>
                    <div className="flex-1">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        placeholder="Dedup window min (default 5)"
                        value={property.dedupeMinutes}
                        onChange={(e) => setProperty({ ...property, dedupeMinutes: e.target.value })}
                        className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
                      />
                      <p className="text-[10px] text-gray-400 mt-0.5">Collapse duplicate fires within this window (minutes).</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      )}

      {error && <p className="text-[11px] text-red-500">{error}</p>}
      <div className="flex items-center gap-3 pt-0.5">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 size={11} className="animate-spin" />}
          {initial ? "Save changes" : "Save KPI"}
        </button>
        <button onClick={onCancel} className="text-[11px] text-gray-400 hover:text-gray-600">Cancel</button>
      </div>
    </div>
  );
}

// ─── Goal Card ────────────────────────────────────────────────────────────────

// A short, computed "how's this actually going" read — not just restating
// the raw percentage already shown in the bar below it, but translating it
// into the kind of plain-English judgment call a person would otherwise have
// to make themselves. Deliberately deterministic, not a per-card AI call —
// this page can render dozens of these at once, and the lesson from the
// reports/dashboard work earlier was that anything that has to always be
// right and always be fast shouldn't depend on a model call. It's still
// framed and shown as an intelligent read (see SignalChip), just computed
// from the real progress numbers rather than guessed.
function progressSignal(
  progressRatio: number | null,
  totalCount: number
): { label: string; tone: "good" | "warn" | "bad" | "neutral" } {
  if (totalCount === 0) return { label: "Just getting started", tone: "neutral" };
  if (progressRatio === null) return { label: "Not yet measurable", tone: "neutral" };
  const pct = progressRatio * 100;
  if (pct >= 100) return { label: "Exceeding target", tone: "good" };
  if (pct >= 70) return { label: "On track", tone: "good" };
  if (pct >= 40) return { label: "Needs attention", tone: "warn" };
  return { label: "Falling behind", tone: "bad" };
}

// Minimal status read: a single coloured dot + quiet text, no pill, no
// background, no border, no icon. The earlier version (coloured background +
// border + sparkle icon) read as a loud SaaS-template badge rather than
// something premium — a plain dot is how Linear/Vercel-style dashboards
// signal status without adding visual noise to every card.
function SignalChip({ signal, dark }: { signal: { label: string; tone: "good" | "warn" | "bad" | "neutral" }; dark?: boolean }) {
  const dot = {
    good: "#10b981", warn: "#d97706", bad: "#e11d48",
    neutral: dark ? "#64748b" : "#9ca3af",
  }[signal.tone];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium whitespace-nowrap ${dark ? "text-white/60" : "text-gray-500"}`}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: dot }} />
      {signal.label}
    </span>
  );
}

function GoalProgressBar({ progress }: { progress?: GoalProgress }) {
  if (!progress || progress.totalKpiCount === 0) return null;
  if (progress.progressRatio === null) {
    return (
      <p className="text-[11px] text-gray-400">
        Not yet measurable — {progress.totalKpiCount} KPI{progress.totalKpiCount !== 1 ? "s" : ""} defined, none with both an event and a numeric goal yet.
      </p>
    );
  }
  const pct = Math.round(progress.progressRatio * 100);
  const overshot = pct > 100;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        {/* Labeled "KPI target progress", not "Goal progress" — this is computed
            from the numeric target_value set on individual KPIs, which has no
            relationship to the goal's own free-text target shown above (e.g.
            "40% this year"). Calling it "Goal progress" implied it measured
            that text target, which it never did. */}
        <span className="text-[11px] font-medium text-gray-500">KPI target progress</span>
        <span className={`text-[11px] font-semibold ${overshot ? "text-emerald-600" : "text-gray-700"}`}>
          {pct.toLocaleString()}%{overshot ? " — exceeded" : ""}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${overshot ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <p className="text-[10px] text-gray-400 mt-1">
        Based on {progress.measurableKpiCount}/{progress.totalKpiCount} KPI{progress.totalKpiCount !== 1 ? "s" : ""} with a real event + numeric goal — not the same as the goal&apos;s own target text above.
      </p>
    </div>
  );
}

function GoalCard({
  goal,
  features,
  eventCounts,
  impactByFeature,
  kpis,
  goalProgress,
  objectives,
  orgId,
  onStatusChange,
  onDelete,
  onDatesUpdated,
  onKpiAdded,
  onObjectiveChanged,
}: {
  goal: BusinessGoal;
  features: FeatureHealthItem[];
  eventCounts: Record<string, number>;
  impactByFeature?: Record<string, FeatureImpactResult>;
  kpis?: MetricWithData[];
  goalProgress?: GoalProgress;
  objectives?: CompanyObjective[];
  orgId?: string;
  onStatusChange: (id: string, status: BusinessGoal["status"]) => void;
  onDelete: (id: string) => void;
  onDatesUpdated?: () => void;
  onKpiAdded?: () => void;
  onObjectiveChanged?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [objMenuOpen, setObjMenuOpen] = useState(false);
  const objectiveTitle = objectives?.find((o) => o.id === goal.company_objective_id)?.title ?? null;
  const [editingDates, setEditingDates] = useState(false);
  const [startDate, setStartDate] = useState(goal.start_date ?? "");
  const [endDate, setEndDate]     = useState(goal.end_date ?? "");
  const [savingDates, setSavingDates] = useState(false);

  async function handleSaveDates() {
    setSavingDates(true);
    await updateGoalDates(goal.id, startDate || null, endDate || null);
    setSavingDates(false);
    setEditingDates(false);
    onDatesUpdated?.();
  }
  const cfg = typeConfig(goal.type);
  const isMissed = goal.status === "missed";
  const health = goalHealthStatus(features, eventCounts);
  const signal = progressSignal(goalProgress?.progressRatio ?? null, goalProgress?.totalKpiCount ?? 0);

  // The date window is a commitment ("we're judging this goal over May"),
  // not just a label — nothing previously flagged when that window had
  // quietly closed while the goal sat at "Active" with no real verdict, or
  // when a linked feature shipped outside the window it was supposed to be
  // measured within. Both are computed here, not just on Feature Metrics,
  // since this is where goals are actually reviewed.
  const today = new Date().toISOString().slice(0, 10);
  const windowEnded = goal.status === "active" && !!goal.end_date && goal.end_date < today;
  const daysSinceWindowEnd = windowEnded && goal.end_date
    ? Math.floor((new Date(today).getTime() - new Date(goal.end_date).getTime()) / 86400000)
    : 0;
  const featuresOutsideWindow = goal.start_date && goal.end_date
    ? features.filter((f) => {
        const launchDate = f.actual_launch_date ?? f.planned_launch_date;
        return !!launchDate && (launchDate < goal.start_date! || launchDate > goal.end_date!);
      })
    : [];
  const [addingKpi, setAddingKpi] = useState(false);
  const [editingKpiId, setEditingKpiId] = useState<string | null>(null);
  const kpiList = kpis ?? [];
  const kpiById = Object.fromEntries(kpiList.map((k) => [k.id, k]));
  const featureCountByKpi: Record<string, number> = {};
  for (const f of features) {
    if (f.target_kpi_id) featureCountByKpi[f.target_kpi_id] = (featureCountByKpi[f.target_kpi_id] ?? 0) + 1;
  }

  return (
    <div
      className={cn(
        "group relative bg-white border border-gray-100 rounded-xl hover:border-gray-200 transition-colors",
        // Collapsed cards sit in the 2/3-column grid like everything else.
        // Expanded ones carry a full KPI list + inline forms + features —
        // cramming that into a single grid column looks broken (cut-off
        // inputs, a tall lonely card next to empty columns). Span the full
        // row instead so there's room to breathe.
        expanded && "sm:col-span-2 lg:col-span-3"
      )}
    >
      <div className="p-4">
        {/* Type + AI signal + status + delete row */}
        <div className="flex items-center justify-between mb-2.5 gap-2">
          <span className="text-[11px] font-medium text-gray-400">
            {cfg.label}
          </span>

          <div className="flex items-center gap-3 flex-shrink-0">
            <SignalChip signal={signal} />
            {/* Status dropdown */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-0.5 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
              >
                {STATUS_OPTIONS.find((s) => s.value === goal.status)?.label}
                <ChevronDown size={10} />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-5 z-20 w-36 rounded-lg border border-gray-200 bg-white shadow-md overflow-hidden">
                    {STATUS_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => { onStatusChange(goal.id, opt.value); setMenuOpen(false); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        {goal.status === opt.value
                          ? <Check size={11} className="text-indigo-500" />
                          : <span className="w-[11px]" />}
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Title */}
        <p className={`text-[15px] font-semibold leading-snug tracking-tight mb-1 ${isMissed ? "line-through text-gray-300" : "text-gray-900"}`}>
          {goal.title}
          {goal.status === "achieved" && <Trophy size={12} className="inline ml-1.5 text-yellow-500" />}
        </p>

        {goal.description && (
          <p className="text-xs text-gray-400 leading-relaxed mb-2">{goal.description}</p>
        )}

        {/* Meta — plain text */}
        <p className="text-xs text-gray-400 mt-1">
          {[goal.target, goal.timeframe].filter(Boolean).join(" · ")}
        </p>

        {/* Which business goal this Product Goal ladders up to — separate
            from the goal's own type tag above, which just categorizes it. */}
        {objectives && objectives.length > 0 && (
          <div className="relative mt-1.5 inline-block">
            <button
              onClick={() => setObjMenuOpen(!objMenuOpen)}
              className={`flex items-center gap-1 text-[11px] transition-colors ${
                objectiveTitle ? "text-indigo-500 hover:text-indigo-700" : "text-amber-600 hover:text-amber-700"
              }`}
            >
              {objectiveTitle ? `↳ ${objectiveTitle}` : "⚠ Not linked to a business goal"}
              <ChevronDown size={9} />
            </button>
            {objMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setObjMenuOpen(false)} />
                <div className="absolute left-0 top-5 z-20 w-56 rounded-lg border border-gray-200 bg-white shadow-md overflow-hidden">
                  <button
                    onClick={async () => { await setGoalObjective(goal.id, null); setObjMenuOpen(false); onObjectiveChanged?.(); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
                  >
                    {!goal.company_objective_id ? <Check size={11} className="text-indigo-500" /> : <span className="w-[11px]" />}
                    Not linked yet
                  </button>
                  {objectives.map((o) => (
                    <button
                      key={o.id}
                      onClick={async () => { await setGoalObjective(goal.id, o.id); setObjMenuOpen(false); onObjectiveChanged?.(); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 transition-colors text-left"
                    >
                      {goal.company_objective_id === o.id ? <Check size={11} className="text-indigo-500 flex-shrink-0" /> : <span className="w-[11px] flex-shrink-0" />}
                      {o.title}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Real, computed progress — only shown when at least one KPI has both an event and a numeric goal */}
        <div className="mt-2.5">
          <GoalProgressBar progress={goalProgress} />
        </div>

        {/* Date window */}
        {editingDates ? (
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300" />
              <span className="text-xs text-gray-400">→</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300" />
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={handleSaveDates} disabled={savingDates}
                className="text-[11px] bg-indigo-600 text-white px-2.5 py-1 rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
                {savingDates ? "Saving…" : "Save window"}
              </button>
              <button onClick={() => { setEditingDates(false); setStartDate(goal.start_date ?? ""); setEndDate(goal.end_date ?? ""); }}
                className="text-[11px] text-gray-400 hover:text-gray-600 px-2 py-1">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setEditingDates(true)}
            className="mt-1.5 flex items-center gap-1 text-[11px] text-gray-400 hover:text-indigo-500 transition-colors">
            <Calendar size={10} />
            {goal.start_date && goal.end_date
              ? `Goal window: ${goal.start_date} → ${goal.end_date}`
              : "Set goal date window"}
          </button>
        )}

        {windowEnded && (
          <p className="mt-1.5 flex items-start gap-1 text-[11px] text-amber-600">
            <AlertCircle size={10} className="flex-shrink-0 mt-0.5" />
            Window ended {daysSinceWindowEnd === 0 ? "today" : `${daysSinceWindowEnd} day${daysSinceWindowEnd === 1 ? "" : "s"} ago`} — still marked Active. Mark it Achieved or Missed above, or extend the window.
          </p>
        )}

        {featuresOutsideWindow.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {featuresOutsideWindow.map((f) => {
              const launchDate = f.actual_launch_date ?? f.planned_launch_date;
              const isActual = !!f.actual_launch_date;
              return (
                <p key={f.id} className="flex items-start gap-1 text-[11px] text-amber-600">
                  <AlertCircle size={10} className="flex-shrink-0 mt-0.5" />
                  &quot;{f.feature_name}&quot; {isActual ? "launched" : "is planned for"} {launchDate} — outside this goal&apos;s window, so it may not count toward it.
                </p>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
          <HealthBadge status={health} />
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700 transition-colors"
          >
            {features.length > 0 ? `${features.length} feature${features.length !== 1 ? "s" : ""}` : "No features"}
            <ChevronRight size={11} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
          </button>
        </div>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-4">
          {/* KPIs — the measurable breakdown of this goal, defined independent of any feature */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">KPIs</p>
              {!addingKpi && orgId && (
                <button onClick={() => setAddingKpi(true)} className="flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-700 transition-colors">
                  <Plus size={10} /> Add KPI
                </button>
              )}
            </div>
            {kpiList.length === 0 && !addingKpi && (
              <p className="text-xs text-gray-400">
                No KPI defined yet — this goal has no measurable breakdown for features to target.
              </p>
            )}
            {kpiList.map((k) =>
              editingKpiId === k.id && orgId ? (
                <div key={k.id} className="mt-1 mb-1">
                  <KpiForm
                    orgId={orgId}
                    goalId={goal.id}
                    initial={k}
                    onSaved={() => { setEditingKpiId(null); onKpiAdded?.(); }}
                    onCancel={() => setEditingKpiId(null)}
                  />
                </div>
              ) : (
                <KpiRow
                  key={k.id}
                  kpi={k}
                  featureCount={featureCountByKpi[k.id] ?? 0}
                  orgId={orgId ?? ""}
                  onWired={() => onKpiAdded?.()}
                  onEdit={() => setEditingKpiId(k.id)}
                  onDelete={async () => {
                    if (!confirm(`Delete the "${k.name}" KPI? This can't be undone.`)) return;
                    await deleteGoalKpi(k.id);
                    onKpiAdded?.();
                  }}
                />
              )
            )}
            {addingKpi && orgId && (
              <div className="mt-2">
                <KpiForm
                  orgId={orgId}
                  goalId={goal.id}
                  onSaved={() => { setAddingKpi(false); onKpiAdded?.(); }}
                  onCancel={() => setAddingKpi(false)}
                />
              </div>
            )}
          </div>

          {/* Features — what's been built to move those KPIs */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Features</p>
            {features.length === 0 ? (
              <p className="text-xs text-gray-400">
                No features linked yet.{" "}
                <a href="/feature-metrics" className="text-indigo-500 hover:underline">Log one →</a>
              </p>
            ) : (
              <div className="space-y-3">
                {features.map((f) => (
                  <FeatureHealthRow
                    key={f.id}
                    feature={f}
                    eventCounts={eventCounts}
                    impact={impactByFeature?.[f.id]}
                    kpiName={f.target_kpi_id ? kpiById[f.target_kpi_id]?.name ?? null : null}
                    orgId={orgId}
                    onGuardrailAdded={onKpiAdded}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Business Goals panel ──────────────────────────────────────────────────
// The real, company-wide objectives (one big thing for the quarter/year).
// Everything below this panel — what the rest of the page calls "goals" —
// is actually the narrower Product Goal layer that ladders up to one of
// these via the picker in GuidedGoalWizard/GoalCard.

// Same guided, AI-assisted pattern as GuidedGoalWizard (Product Goals) one
// level up, so the whole hierarchy is one consistent creation experience
// instead of a polished flow at one layer and a blank form at another.
// Reuses WizardShell — defined once, used everywhere in this hierarchy.
// Each step is one decision, full stop — the earlier "describe" then one
// big "confirm" screen crammed title + target + timeframe + context into a
// single dense card. Splitting it into single-decision steps plus a visible
// dot trail (StepTrail, defined below WizardShell) is the actual fix for
// "too much at once," not just bigger text on the same dense screen.
// "done" is deliberately NOT in OBJECTIVE_STEPS (the trail) — same as
// GuidedGoalWizard's "done" step, it's a terminal confirmation screen, not
// another decision to count toward "step X of Y."
type ObjectiveWizardStep = "describe" | "title" | "target" | "context" | "done";
const OBJECTIVE_STEPS: ObjectiveWizardStep[] = ["describe", "title", "target", "context"];

function GuidedObjectiveWizard({
  onSaved, onCancel, hasProductGoals = true, onCreateFirstGoal, onObjectiveSaved,
}: {
  onSaved: () => void; onCancel: () => void;
  // When false (no Product Goal exists anywhere yet), saving doesn't just
  // close the wizard and drop you back on the page — it shows one more
  // beat offering to keep going straight into creating the first one. This
  // is the fix for "the moment I finish, guide me to what's next, don't
  // just drop me." When true, saving behaves exactly as before.
  hasProductGoals?: boolean;
  onCreateFirstGoal?: () => void;
  // Called immediately when the objective is saved to DB, without closing
  // the wizard — triggers a background reload so that by the time the user
  // clicks the "done" step's next button, the page state is already fresh
  // and there's no flash of a stale first-run state.
  onObjectiveSaved?: () => void;
}) {
  const { currentOrg } = useOrg();
  const [step, setStep] = useState<ObjectiveWizardStep>("describe");
  const [description, setDescription] = useState("");
  const [proposing, setProposing] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", target: "", timeframe: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const stepIndex = OBJECTIVE_STEPS.indexOf(step);

  async function handlePropose() {
    if (!description.trim()) { setError("Describe the one big thing you're trying to achieve first."); return; }
    setError("");
    setProposing(true);
    const res = await proposeObjectiveFromDescription(description);
    setProposing(false);
    if (res.error || !res.title) {
      setForm({ title: description.trim().slice(0, 90), description: "", target: "", timeframe: TIMEFRAMES[0] });
      if (res.error) setError(res.error);
    } else {
      setForm({ title: res.title, description: res.description || "", target: res.target || "", timeframe: res.timeframe || TIMEFRAMES[0] });
    }
    setStep("title");
  }

  async function handleSave() {
    if (!currentOrg || !form.title.trim()) { setError("Title is required."); return; }
    setSaving(true);
    setError("");
    const result = await createCompanyObjective(currentOrg.id, form);
    setSaving(false);
    if (result.error) { setError(result.error); return; }
    // If there's already at least one Product Goal, this is just "another
    // business goal" — close out exactly as before. If this was the first
    // Business Goal and there's nothing underneath it yet, that's the exact
    // moment someone's most likely to be left wondering what to do next.
    if (hasProductGoals) { onSaved(); return; }
    // Trigger a background page reload immediately so the objectives array
    // is up-to-date by the time the user clicks either button on the "done"
    // step — eliminates the flash of the first-run state that appeared while
    // load() was still in-flight after they clicked "Add my first Product Goal."
    onObjectiveSaved?.();
    setStep("done");
  }

  if (step === "describe") return (
    <WizardShell label="New business goal" onCancel={onCancel} error={error} step={stepIndex} totalSteps={OBJECTIVE_STEPS.length}>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5">
          The one big thing — what is the company trying to achieve? Describe it in your own words.
        </label>
        <textarea
          autoFocus
          rows={3}
          placeholder="e.g. We need to grow policy activations and keep more customers renewing this quarter — too many sign up and never finish onboarding."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
        />
        <SuggestionChips
          examples={["Grow activations & retention this quarter", "Hit £2M ARR by year end", "Cut customer churn in half"]}
          onPick={setDescription}
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handlePropose}
          disabled={proposing}
          className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50"
        >
          {proposing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {proposing ? "Thinking…" : "Suggest a business goal"}
        </button>
        <button
          onClick={() => { setForm({ title: "", description: "", target: "", timeframe: TIMEFRAMES[0] }); setStep("title"); }}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Skip — I&apos;ll fill it in myself
        </button>
      </div>
    </WizardShell>
  );

  if (step === "title") return (
    <WizardShell label="What's it called?" onCancel={onCancel} error={error} step={stepIndex} totalSteps={OBJECTIVE_STEPS.length}>
      <p className="text-xs text-gray-400">Here&apos;s what we put together — change it if it&apos;s not quite right.</p>
      <input
        autoFocus
        type="text"
        placeholder="Name this business goal"
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        className="w-full border-0 border-b border-gray-200 px-0 py-1.5 text-lg font-semibold text-gray-900 placeholder:text-gray-300 placeholder:font-normal focus:outline-none focus:border-indigo-400 transition-colors"
      />
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => {
            if (!form.title.trim()) { setError("Title is required."); return; }
            setError("");
            setStep("target");
          }}
          className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
        >
          Continue
        </button>
        <button onClick={() => setStep("describe")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Back</button>
      </div>
    </WizardShell>
  );

  if (step === "target") return (
    <WizardShell label="What does success look like?" onCancel={onCancel} error={error} step={stepIndex} totalSteps={OBJECTIVE_STEPS.length}>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Target</label>
          <input
            autoFocus
            type="text"
            placeholder="e.g. 98% activation, NPS 58+"
            value={form.target}
            onChange={(e) => setForm({ ...form, target: e.target.value })}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Timeframe</label>
          <select
            value={form.timeframe}
            onChange={(e) => setForm({ ...form, timeframe: e.target.value })}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
          >
            <option value="">Select…</option>
            {TIMEFRAMES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => setStep("context")}
          className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
        >
          Continue
        </button>
        <button onClick={() => setStep("title")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Back</button>
      </div>
    </WizardShell>
  );

  if (step === "context") return (
    <WizardShell label="Anything else worth noting?" onCancel={onCancel} error={error} step={stepIndex} totalSteps={OBJECTIVE_STEPS.length}>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5">Context <span className="text-gray-400 font-normal">(optional)</span></label>
        <textarea
          autoFocus
          rows={3}
          placeholder="Why this matters to the business right now — totally optional."
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
        />
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 size={13} className="animate-spin" />}
          Save business goal
        </button>
        <button onClick={() => setStep("target")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Back</button>
      </div>
    </WizardShell>
  );

  // step === "done" — only reached when there were zero Product Goals
  // before this Business Goal existed. Saving used to just close the
  // wizard silently and drop you back on a now-busier page (sync controls,
  // filters, an empty state below) with no sense of what to do with what
  // you just created. This keeps the same conversational thread going
  // instead of going quiet right when it matters most.
  return (
    <WizardShell label="Business goal created" onCancel={onCancel} error={error}>
      <div className="flex items-center gap-2 text-emerald-600">
        <CheckCircle2 size={16} />
        <p className="text-sm font-medium">&quot;{form.title}&quot; is set.</p>
      </div>
      <p className="text-sm text-gray-400">
        Next, break it down into a Product Goal — the narrower thing your team will actually build toward.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={() => { onCreateFirstGoal?.(); onSaved(); }}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-10 py-3 rounded-xl transition-colors"
        >
          Add my first Product Goal
        </button>
        <button onClick={onSaved} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
          I&apos;ll do this later
        </button>
      </div>
    </WizardShell>
  );
}

// Aggregates the linked Product Goals' own KPI progress into one number for
// the Business Goal — a plain average of each linked goal's progressRatio
// (same "uncapped, real-over/under-target" philosophy as GoalProgressBar).
// Goals with no measurable KPI yet are excluded from the average rather than
// counted as 0%, since "not yet measurable" and "measured at zero" are
// different things.
function objectiveProgress(objectiveId: string, goals: BusinessGoal[], goalProgress: Record<string, GoalProgress>) {
  const linked = goals.filter((g) => g.company_objective_id === objectiveId);
  const ratios = linked
    .map((g) => goalProgress[g.id]?.progressRatio)
    .filter((r): r is number => typeof r === "number");
  return {
    goalCount: linked.length,
    measurableGoalCount: ratios.length,
    progressRatio: ratios.length > 0 ? ratios.reduce((s, r) => s + r, 0) / ratios.length : null,
  };
}

function ObjectiveCard({
  objective, goals, goalProgress, selected, onSelect, onStatusChange, onDelete, label, labelPlural,
}: {
  objective: CompanyObjective;
  goals: BusinessGoal[];
  goalProgress: Record<string, GoalProgress>;
  selected: boolean;
  onSelect: () => void;
  onStatusChange: (status: CompanyObjective["status"]) => void;
  onDelete: () => void;
  label: string;
  labelPlural: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { goalCount, measurableGoalCount, progressRatio } = objectiveProgress(objective.id, goals, goalProgress);
  const pct = progressRatio !== null ? Math.round(progressRatio * 100) : null;
  const overshot = pct !== null && pct > 100;
  const isMissed = objective.status === "missed";
  const signal = progressSignal(progressRatio, goalCount);
  void measurableGoalCount;

  const palette = {
    good:    { bg: "#f3f4ff", border: "rgba(99,102,241,0.28)",  glow: "rgba(99,102,241,0.14)", accent: "#6366f1", gradFrom: "#818cf8", gradTo: "#a78bfa" },
    warn:    { bg: "#fffbf0", border: "rgba(217,119,6,0.25)",   glow: "rgba(217,119,6,0.12)",  accent: "#d97706", gradFrom: "#fbbf24", gradTo: "#fb923c" },
    bad:     { bg: "#fff5f5", border: "rgba(225,29,72,0.25)",   glow: "rgba(225,29,72,0.12)",  accent: "#e11d48", gradFrom: "#fb7185", gradTo: "#f87171" },
    neutral: { bg: "#f5f7ff", border: "rgba(99,102,241,0.18)",  glow: "rgba(99,102,241,0.08)", accent: "#818cf8", gradFrom: "#a5b4fc", gradTo: "#93c5fd" },
  }[signal.tone];

  return (
    <div
      className="group relative rounded-xl"
      style={{
        background: palette.bg,
        boxShadow: selected
          ? `0 0 0 2px ${palette.border}, 0 8px 24px -6px ${palette.glow}`
          : `0 0 0 1.5px ${palette.border}, 0 4px 16px -4px ${palette.glow}`,
      }}
    >
      {/* Gradient top line */}
      <div
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{ background: `linear-gradient(90deg, ${palette.gradFrom}, ${palette.gradTo})` }}
      />
      {/* Ghost Trophy */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none select-none">
        <Trophy size={64} style={{ color: palette.accent, opacity: 0.07 }} />
      </div>

      <button onClick={onSelect} className="relative w-full text-left p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: palette.accent }}>Business Goal</span>
          <div className="flex items-center gap-2">
            <SignalChip signal={signal} />
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              className="flex items-center gap-0.5 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
            >
              {STATUS_OPTIONS.find((s) => s.value === objective.status)?.label}
              <ChevronDown size={10} />
            </span>
          </div>
        </div>

        <p className={`text-[15px] font-semibold leading-snug mb-1 tracking-tight ${isMissed ? "line-through text-gray-300" : "text-gray-900"}`}>
          {objective.title}
        </p>

        {objective.description && (
          <p className="text-xs text-gray-500 leading-relaxed mb-1 line-clamp-2">{objective.description}</p>
        )}

        <p className="text-xs text-gray-400 mb-3">
          {[objective.target, objective.timeframe].filter(Boolean).join(" · ") || "No target set"}
        </p>

        {pct === null ? (
          <p className="text-[11px] text-gray-400">
            {goalCount === 0
              ? `No ${labelPlural} linked yet.`
              : `${goalCount} ${goalCount !== 1 ? labelPlural : label} linked — none measurable yet.`}
          </p>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-gray-500">Rolled up from {labelPlural}</span>
              <span className={`text-[11px] font-semibold ${overshot ? "text-emerald-600" : "text-gray-700"}`}>
                {pct.toLocaleString()}%{overshot ? " — exceeded" : ""}
              </span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(0,0,0,0.06)" }}>
              <div
                className={`h-full rounded-full ${overshot ? "bg-emerald-500" : ""}`}
                style={{
                  width: `${Math.min(pct, 100)}%`,
                  background: overshot ? undefined : `linear-gradient(90deg, ${palette.gradFrom}, ${palette.gradTo})`,
                }}
              />
            </div>
          </div>
        )}
      </button>

      <div
        className="relative flex items-center justify-between px-4 py-2"
        style={{ borderTop: `1px solid ${palette.border}` }}
      >
        <span className="text-[11px] text-gray-400">
          {goalCount} {goalCount !== 1 ? labelPlural : label}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all"
          title="Delete business goal"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-4 top-9 z-20 w-36 rounded-lg border border-gray-200 bg-white shadow-md overflow-hidden">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { onStatusChange(opt.value); setMenuOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
              >
                {objective.status === opt.value
                  ? <Check size={11} className="text-indigo-500" />
                  : <span className="w-[11px]" />}
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Premium card for a single Business Goal. Rectangle with a soft pastel
// blue background, a 2px gradient line along the top, and a box-shadow
// glow whose colour drifts with progress — indigo when on-track, amber
// when at risk, rose when falling behind. A ghost Trophy icon adds
// texture without adding visual weight.
function ObjectiveStatement({
  objective, goals, goalProgress, labelPlural, onStatusChange, onDelete, onAddAnother,
}: {
  objective: CompanyObjective;
  goals: BusinessGoal[];
  goalProgress: Record<string, GoalProgress>;
  labelPlural: string;
  onStatusChange: (status: CompanyObjective["status"]) => void;
  onDelete: () => void;
  onAddAnother: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { goalCount, progressRatio } = objectiveProgress(objective.id, goals, goalProgress);
  const pct = progressRatio !== null ? Math.round(progressRatio * 100) : null;
  const overshot = pct !== null && pct > 100;
  const isMissed = objective.status === "missed";
  const signal = progressSignal(progressRatio, goalCount);

  // Colour palette keyed by signal — the glow and gradient shift with progress
  // so the card quietly communicates health without a separate status badge.
  const palette = {
    good:    { bg: "#f3f4ff", border: "rgba(99,102,241,0.28)",  glow: "rgba(99,102,241,0.14)", accent: "#6366f1", gradFrom: "#818cf8", gradTo: "#a78bfa" },
    warn:    { bg: "#fffbf0", border: "rgba(217,119,6,0.25)",   glow: "rgba(217,119,6,0.12)",  accent: "#d97706", gradFrom: "#fbbf24", gradTo: "#fb923c" },
    bad:     { bg: "#fff5f5", border: "rgba(225,29,72,0.25)",   glow: "rgba(225,29,72,0.12)",  accent: "#e11d48", gradFrom: "#fb7185", gradTo: "#f87171" },
    neutral: { bg: "#f5f7ff", border: "rgba(99,102,241,0.18)",  glow: "rgba(99,102,241,0.08)", accent: "#818cf8", gradFrom: "#a5b4fc", gradTo: "#93c5fd" },
  }[signal.tone];

  return (
    <div
      className="relative rounded-2xl max-w-2xl"
      style={{
        background: palette.bg,
        boxShadow: `0 0 0 1.5px ${palette.border}, 0 8px 32px -8px ${palette.glow}`,
      }}
    >
      {/* 2px gradient accent along the top — the "gradient line" the card needed */}
      <div
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{ background: `linear-gradient(90deg, ${palette.gradFrom}, ${palette.gradTo})` }}
      />

      {/* Ghost Trophy — large enough to add texture, faint enough to not compete */}
      <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none select-none">
        <Trophy size={96} style={{ color: palette.accent, opacity: 0.07 }} />
      </div>

      <div className="relative px-6 pt-5 pb-4">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1 min-w-0">
            <p
              className="text-[10px] font-semibold tracking-widest uppercase mb-1.5"
              style={{ color: palette.accent }}
            >
              Business Goal · {objective.timeframe || "This quarter / year"}
            </p>

            <p className={`text-lg font-bold tracking-tight mb-1 ${isMissed ? "line-through text-gray-300" : "text-gray-900"}`}>
              {objective.title}
            </p>

            {objective.description && (
              <p className="text-sm text-gray-500 leading-relaxed mb-1.5 max-w-2xl line-clamp-2">{objective.description}</p>
            )}

            {(objective.target || objective.timeframe) && (
              <p className="text-xs text-gray-400 mb-2">
                {[objective.target, objective.timeframe].filter(Boolean).join(" · ")}
              </p>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              <SignalChip signal={signal} />
              <span className="text-xs text-gray-400">
                {pct !== null
                  ? `${pct.toLocaleString()}% toward target${overshot ? " — exceeded" : ""}`
                  : goalCount === 0
                  ? `No ${labelPlural.toLowerCase()} linked yet`
                  : `${goalCount} ${labelPlural.toLowerCase()} linked — none measurable yet`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-shrink-0 pt-0.5">
            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-0.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                {STATUS_OPTIONS.find((s) => s.value === objective.status)?.label}
                <ChevronDown size={10} />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-6 z-20 w-36 rounded-lg border border-gray-200 bg-white shadow-md overflow-hidden">
                    {STATUS_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => { onStatusChange(opt.value); setMenuOpen(false); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        {objective.status === opt.value ? <Check size={11} className="text-indigo-500" /> : <span className="w-[11px]" />}
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button
              onClick={onAddAnother}
              className="text-xs font-medium text-gray-400 hover:text-gray-700 transition-colors whitespace-nowrap"
            >
              + Add another
            </button>
            <button
              onClick={onDelete}
              className="text-gray-300 hover:text-red-500 transition-colors"
              title="Delete business goal"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Setup Checklist (fixed bottom-right) ─────────────────────────────────────
// Subtle floating widget — visible on the Goals page whenever any setup step
// is incomplete. Collapsed by default (just shows X/5 dot), expands on click.
// Disappears entirely once everything is done.
function SetupChecklist({
  objectives,
  goals,
  goalProgress,
}: {
  objectives: CompanyObjective[];
  goals: BusinessGoal[];
  goalProgress: Record<string, GoalProgress>;
}) {
  const [open, setOpen] = useState(false);

  const hasBusinessGoal = objectives.length > 0;
  const hasTarget       = objectives.some(o => !!o.target?.trim());
  const hasProductGoal  = goals.length > 0;
  const hasMeasurable   = Object.values(goalProgress).some(gp => gp.progressRatio !== null);
  const hasFeature      = goals.some(g => (g as BusinessGoal & { feature_metrics?: unknown[] }).feature_metrics?.length);

  const items: { label: string; done: boolean }[] = [
    { label: "Business Goal defined",    done: hasBusinessGoal },
    { label: "Success target set",       done: hasTarget       },
    { label: "Product Goal added",       done: hasProductGoal  },
    { label: "KPI wired to measurement", done: hasMeasurable   },
    { label: "Feature linked",           done: hasFeature      },
  ];

  const doneCount = items.filter(i => i.done).length;
  if (doneCount === items.length) return null; // all done — hide

  return (
    <div className="fixed bottom-6 right-6 z-30 flex flex-col items-end gap-2">
      {/* Expanded panel */}
      {open && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-lg p-4 w-56 space-y-3">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest">Setup</p>
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                {item.done
                  ? <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
                  : <Circle      size={13} className="text-gray-300    flex-shrink-0" />}
                <span className={`text-xs ${item.done ? "line-through text-gray-300" : "text-gray-600"}`}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Collapsed pill / trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 bg-white border border-gray-200 rounded-full pl-2.5 pr-3 py-1.5 shadow-md hover:shadow-lg transition-shadow"
      >
        <div className="flex gap-0.5">
          {items.map((item, i) => (
            <div
              key={i}
              className={`h-1.5 w-3 rounded-full ${item.done ? "bg-indigo-500" : "bg-gray-200"}`}
            />
          ))}
        </div>
        <span className="text-[11px] font-medium text-gray-500">{doneCount}/{items.length}</span>
      </button>
    </div>
  );
}

function ObjectivesPanel({
  objectives,
  goals,
  goalProgress,
  filterObjective,
  onFilterChange,
  onSaved,
  label,
  labelPlural,
  isFirstRun,
  onCreateFirstGoal,
}: {
  objectives: CompanyObjective[];
  goals: BusinessGoal[];
  goalProgress: Record<string, GoalProgress>;
  filterObjective: string;
  onFilterChange: (id: string) => void;
  onSaved: () => void;
  label: string;
  labelPlural: string;
  // True page-level first run — no Business Goal AND no Product Goal exist
  // anywhere yet. The parent hides its own header/sync controls/filters
  // entirely in this state, so this panel needs to read as the WHOLE
  // page's starting point — one focused moment, not a small empty box
  // sitting above another, differently-styled empty box below it.
  isFirstRun: boolean;
  // Opens the Product Goal wizard up in the parent — passed straight
  // through to GuidedObjectiveWizard so finishing a Business Goal with no
  // Product Goal yet can offer to keep going instead of dropping you here.
  onCreateFirstGoal?: () => void;
  // Tells the parent whether this panel's own wizard is currently open,
  // so the parent can gate Stage 2 and avoid double-rendering both the
  // wizard's "done" step AND the Stage 2 block simultaneously.
  onOpenChange?: (open: boolean) => void;
}) {
  const [showForm, setShowFormInternal] = useState(false);
  function setShowForm(v: boolean) { setShowFormInternal(v); onOpenChange?.(v); }

  // The wizard takes over completely regardless of how many objectives
  // already exist — "add another" from the statement view below and the
  // very first "Start" button land in the exact same place, instead of two
  // different code paths that could drift apart.
  if (showForm) {
    return (
      <GuidedObjectiveWizard
        onSaved={() => { setShowForm(false); onSaved(); }}
        onCancel={() => setShowForm(false)}
        hasProductGoals={goals.length > 0}
        onCreateFirstGoal={onCreateFirstGoal}
        onObjectiveSaved={onSaved}
      />
    );
  }

  if (isFirstRun) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-20 text-center">
        <div className="w-11 h-11 rounded-2xl bg-indigo-50 flex items-center justify-center mb-5">
          <Trophy size={18} className="text-indigo-500" />
        </div>
        {/* Bigger, more confident headline — the modest text-sm version read
            as an afterthought rather than the one thing this page is asking
            you to do. One line of subtext, not two — say the single most
            useful thing and stop. */}
        <h3 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">Start with the one big thing.</h3>
        <p className="text-sm text-gray-400 max-w-sm mb-6">
          What&apos;s your company trying to achieve this quarter? We&apos;ll help you break it down from there.
        </p>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
        >
          <Plus size={14} /> Start
        </button>
      </div>
    );
  }

  // There's realistically only ever one or two of these — it's "the one
  // big thing," not a list to browse. Treating it as a bordered card with
  // its own header row and footer was borrowing list/grid furniture for
  // something that isn't a list yet. A single objective reads as a plain
  // statement; it only earns real card/grid treatment once there's more
  // than one to actually compare.
  if (objectives.length === 1) {
    const single = objectives[0];
    return (
      <ObjectiveStatement
        objective={single}
        goals={goals}
        goalProgress={goalProgress}
        labelPlural={labelPlural}
        onStatusChange={async (status) => { await updateCompanyObjectiveStatus(single.id, status); onSaved(); }}
        onDelete={async () => {
          if (!confirm(`Delete "${single.title}"? Linked ${labelPlural} stay — they'll just show as not linked.`)) return;
          await deleteCompanyObjective(single.id);
          onSaved();
        }}
        onAddAnother={() => setShowForm(true)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold tracking-widest uppercase text-indigo-500">This quarter / year</p>
          <p className="text-sm font-bold text-gray-900">Business Goals</p>
        </div>
        <div className="flex items-center gap-3">
          {filterObjective !== "all" && (
            <button onClick={() => onFilterChange("all")} className="text-xs text-indigo-500 hover:underline">
              Show all {labelPlural}
            </button>
          )}
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors"
          >
            <Plus size={12} /> Add business goal
          </button>
        </div>
      </div>

      {objectives.length === 0 ? (
        // Edge case, not the common path: a Business Goal existed (so this
        // isn't isFirstRun) but got deleted, leaving Product Goals orphaned
        // above a now-empty objectives list.
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-10 text-center">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center mb-3">
            <Trophy size={16} className="text-indigo-500" />
          </div>
          <p className="text-sm text-gray-400 max-w-sm">
            Nothing here yet — this is the one big thing (e.g. &quot;Grow activations &amp; retention this quarter&quot;)
            that all the {labelPlural.toLowerCase()} below should ladder up to.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {objectives.map((o) => (
            <ObjectiveCard
              key={o.id}
              objective={o}
              goals={goals}
              goalProgress={goalProgress}
              selected={filterObjective === o.id}
              onSelect={() => onFilterChange(filterObjective === o.id ? "all" : o.id)}
              onStatusChange={async (status) => { await updateCompanyObjectiveStatus(o.id, status); onSaved(); }}
              onDelete={async () => {
                if (!confirm(`Delete "${o.title}"? Linked ${labelPlural} stay — they'll just show as not linked.`)) return;
                await deleteCompanyObjective(o.id);
                onSaved();
              }}
              label={label}
              labelPlural={labelPlural}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Guided goal + KPI creation wizard ────────────────────────────────────────
//
// Replaces the old single blank-form "Add goal" experience end to end, per
// direct feedback: someone landing on this page for the first time doesn't
// already know what a "goal type" or "KPI" should look like, and shouldn't
// have to figure that out alone. This walks them through it one question at
// a time — describe the outcome in plain words, AI proposes the structured
// goal, confirm/edit, then the same pattern one level down for the KPI that
// proves it's moving. Advanced KPI options (reference-event matching, time
// windows, match keys, manual/sheet values) stay available afterward via the
// edit icon on the created KPI (KpiForm, above) — this wizard is meant to
// nail the common case quickly, not replace every capability up front.
// Each step is one decision, full stop — see the matching comment on
// ObjectiveWizardStep above for why this got split out of two dense
// "confirm" screens (one per layer) into a longer run of light ones, plus a
// visible dot trail (StepTrail) connecting them into one walk instead of a
// series of unrelated swaps. "goal_objective" only exists in the trail when
// there's a business goal to link to — see goalSteps below.
type GoalWizardStep =
  | "goal_describe" | "goal_title" | "goal_objective" | "goal_type" | "goal_target" | "goal_context"
  | "kpi_describe" | "kpi_name" | "kpi_event" | "kpi_target" | "done";

// Shared chrome around whichever wizard step is active. This MUST be a
// top-level component, not one defined inline inside GuidedGoalWizard's
// render body — a component defined inside another component's body gets a
// brand-new function identity on every render, which made React treat each
// re-render as a different component type and remount the whole subtree
// (including the live textarea) on every keystroke. Remounting a
// `autoFocus` textarea resets the cursor to position 0, so each new
// character got inserted at the start instead of where you were typing —
// the exact "text is writing backwards" bug. Hoisting this out fixes it at
// the root: a stable component identity means React only updates the DOM
// that actually changed, never tears down the input.
function WizardShell({
  label, onCancel, error, children, step, totalSteps,
}: {
  label: string; onCancel: () => void; error: string; children: React.ReactNode;
  // Optional — when set, renders the dot trail below the header so a step
  // visually reads as one continuous walk forward rather than the card's
  // content just swapping. Omitted on the final "done" screen.
  step?: number; totalSteps?: number;
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-8 sm:p-10 space-y-7">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-800">{label}</p>
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Cancel</button>
      </div>
      {typeof step === "number" && typeof totalSteps === "number" && (
        <StepTrail current={step} total={totalSteps} />
      )}
      <div className="space-y-7">{children}</div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// The "connecting the dots" piece that was missing — each step used to just
// swap content with a "step X of Y" text label and no visual thread tying
// them together. The current dot stretches into a short pill, completed
// ones stay filled, upcoming ones stay faint — same minimal dot vocabulary
// as SignalChip elsewhere on this page (a quiet status read, not a loud
// progress bar with numbers).
function StepTrail({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 rounded-full transition-all",
            i === current ? "w-5 bg-indigo-500" : i < current ? "w-1.5 bg-indigo-300" : "w-1.5 bg-gray-200"
          )}
        />
      ))}
    </div>
  );
}

// Clickable starting points sitting under a describe-step textarea — the
// FuseDash AI-chat empty state never opens on a truly blank box, it offers
// suggested prompts ("Identify key trends," "Create dashboard") so there's
// always somewhere to start from. Same idea here: clicking one fills the
// textarea with editable example text rather than submitting anything, so
// it's a starting point, not a shortcut that skips the wizard.
function SuggestionChips({ examples, onPick }: { examples: string[]; onPick: (text: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2.5">
      {examples.map((ex) => (
        <button
          key={ex}
          type="button"
          onClick={() => onPick(ex)}
          className="text-[11px] text-gray-500 border border-gray-200 rounded-full px-2.5 py-1 hover:text-indigo-600 hover:border-indigo-200 transition-colors"
        >
          {ex}
        </button>
      ))}
    </div>
  );
}

function GuidedGoalWizard({
  objectives, onSaved, onCancel, goalLabel = "Product Goal",
}: { objectives: CompanyObjective[]; onSaved: () => void; onCancel: () => void; goalLabel?: string }) {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? "";

  const [step, setStep] = useState<GoalWizardStep>("goal_describe");
  const [error, setError] = useState("");

  // ── Goal ──
  const [goalDescription, setGoalDescription] = useState("");
  const [proposingGoal, setProposingGoal] = useState(false);
  const [goalForm, setGoalForm] = useState({
    title: "", type: "growth", target: "", timeframe: "", description: "", company_objective_id: "",
  });
  const [savingGoal, setSavingGoal] = useState(false);
  const [createdGoal, setCreatedGoal] = useState<{ id: string; title: string } | null>(null);

  // ── KPI ──
  const [eventNames, setEventNames] = useState<string[]>([]);
  useEffect(() => { if (orgId) getDistinctEventNames(orgId).then(setEventNames); }, [orgId]);
  const [kpiDescription, setKpiDescription] = useState("");
  const [proposingKpi, setProposingKpi] = useState(false);
  const [kpiForm, setKpiForm] = useState({ name: "", target: "", target_value: "", event_name: "", aggregation: "unique_users" });
  const [savingKpi, setSavingKpi] = useState(false);
  const [kpisCreated, setKpisCreated] = useState<string[]>([]);

  // "goal_objective" only exists as a real step when there's a business
  // goal to link to — otherwise it'd be a step asking you to choose from an
  // empty list. Computed here so both the trail's total count and every
  // step's "what's next" target agree on the same sequence.
  const goalSteps: GoalWizardStep[] = [
    "goal_describe", "goal_title",
    ...(objectives.length > 0 ? (["goal_objective"] as GoalWizardStep[]) : []),
    "goal_type", "goal_target", "goal_context",
    "kpi_describe", "kpi_name", "kpi_event", "kpi_target",
  ];
  const stepIndex = goalSteps.indexOf(step);

  async function handleProposeGoal() {
    if (!goalDescription.trim()) { setError("Describe what you're trying to achieve first."); return; }
    setError("");
    setProposingGoal(true);
    const res = await proposeGoalFromDescription(
      goalDescription,
      objectives.map(o => ({ id: o.id, title: o.title, target: o.target, timeframe: o.timeframe }))
    );
    setProposingGoal(false);
    if (res.error || !res.title) {
      setGoalForm({ title: goalDescription.trim().slice(0, 80), type: "growth", target: "", timeframe: TIMEFRAMES[0], description: "", company_objective_id: "" });
      if (res.error) setError(res.error);
    } else {
      setGoalForm({
        title: res.title, type: res.type || "growth", target: res.target || "",
        timeframe: res.timeframe || TIMEFRAMES[0], description: res.description || "",
        // Auto-select the suggested Business Goal if the AI returned one and it exists
        company_objective_id: res.suggestedObjectiveId && objectives.some(o => o.id === res.suggestedObjectiveId)
          ? res.suggestedObjectiveId : "",
      });
    }
    setStep("goal_title");
  }

  async function handleSaveGoal() {
    if (!orgId || !goalForm.title.trim()) { setError("Goal title is required."); return; }
    setSavingGoal(true);
    setError("");
    const result = await createBusinessGoal(orgId, { ...goalForm, company_objective_id: goalForm.company_objective_id || null });
    setSavingGoal(false);
    if (result.error || !result.id) { setError(result.error || "Couldn't save the goal."); return; }
    setCreatedGoal({ id: result.id, title: goalForm.title });
    setStep("kpi_describe");
  }

  async function handleProposeKpi() {
    if (!kpiDescription.trim()) { setError("Describe what you'd measure first."); return; }
    setError("");
    setProposingKpi(true);
    const res = await proposeKpiFromDescription(createdGoal?.title ?? "", kpiDescription, eventNames);
    setProposingKpi(false);
    if (res.error || !res.name) {
      setKpiForm({ name: kpiDescription.trim().slice(0, 60), target: "", target_value: "", event_name: "", aggregation: "unique_users" });
      if (res.error) setError(res.error);
    } else {
      setKpiForm({
        name: res.name, target: res.target || "",
        target_value: res.target_value != null ? String(res.target_value) : "",
        event_name: res.matched_event_name || "", aggregation: res.aggregation || "unique_users",
      });
    }
    setStep("kpi_name");
  }

  async function handleSaveKpi() {
    if (!createdGoal || !kpiForm.name.trim()) { setError("KPI name is required."); return; }
    setSavingKpi(true);
    setError("");
    const result = await createGoalKpi(orgId, createdGoal.id, {
      name: kpiForm.name,
      description: "",
      event_name: kpiForm.event_name.trim() || null,
      aggregation: kpiForm.aggregation,
      target: kpiForm.target,
      target_value: kpiForm.target_value.trim() ? Number(kpiForm.target_value) : null,
    });
    setSavingKpi(false);
    if (result.error) { setError(result.error); return; }
    setKpisCreated((prev) => [...prev, kpiForm.name]);
    setStep("done");
  }

  function handleAddAnotherKpi() {
    setKpiDescription("");
    setKpiForm({ name: "", target: "", target_value: "", event_name: "", aggregation: "unique_users" });
    setError("");
    setStep("kpi_describe");
  }

  if (step === "goal_describe") return (
    <WizardShell label={`New ${goalLabel}`} onCancel={onCancel} error={error} step={stepIndex} totalSteps={goalSteps.length}>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5">
          What are you trying to achieve? Describe it in your own words.
        </label>
        <textarea
          autoFocus
          rows={3}
          placeholder="e.g. We want claims to get paid out faster this quarter — right now people wait too long and it's hurting renewals."
          value={goalDescription}
          onChange={(e) => setGoalDescription(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
        />
        <SuggestionChips
          examples={["Speed up claims processing", "Grow signups this quarter", "Reduce onboarding drop-off"]}
          onPick={setGoalDescription}
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleProposeGoal}
          disabled={proposingGoal}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50"
        >
          {proposingGoal ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {proposingGoal ? "Thinking…" : "Suggest a goal"}
        </button>
        <button
          onClick={() => { setGoalForm({ title: "", type: "growth", target: "", timeframe: TIMEFRAMES[0], description: "", company_objective_id: "" }); setStep("goal_title"); }}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Skip — I&apos;ll fill it in myself
        </button>
      </div>
    </WizardShell>
  );

  if (step === "goal_title") return (
    <WizardShell label="What's it called?" onCancel={onCancel} error={error} step={stepIndex} totalSteps={goalSteps.length}>
      <p className="text-xs text-gray-400">Here&apos;s what we put together — change it if it&apos;s not quite right.</p>
      <input
        autoFocus
        type="text"
        placeholder="Name this goal"
        value={goalForm.title}
        onChange={(e) => setGoalForm({ ...goalForm, title: e.target.value })}
        className="w-full border-0 border-b border-gray-200 px-0 py-1.5 text-lg font-semibold text-gray-900 placeholder:text-gray-300 placeholder:font-normal focus:outline-none focus:border-indigo-400 transition-colors"
      />
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => {
            if (!goalForm.title.trim()) { setError("Goal title is required."); return; }
            setError("");
            setStep(objectives.length > 0 ? "goal_objective" : "goal_type");
          }}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
        >
          Continue
        </button>
        <button onClick={() => setStep("goal_describe")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Back</button>
      </div>
    </WizardShell>
  );

  if (step === "goal_objective") return (
    <WizardShell label="Which business goal does this move?" onCancel={onCancel} error={error} step={stepIndex} totalSteps={goalSteps.length}>
      <select
        autoFocus
        value={goalForm.company_objective_id}
        onChange={(e) => setGoalForm({ ...goalForm, company_objective_id: e.target.value })}
        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
      >
        <option value="">Not linked yet</option>
        {objectives.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
      </select>
      <p className="text-xs text-gray-400">Optional — you can link this later from the goal card.</p>
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => setStep("goal_type")}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
        >
          Continue
        </button>
        <button onClick={() => setStep("goal_title")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Back</button>
      </div>
    </WizardShell>
  );

  if (step === "goal_type") return (
    <WizardShell label="What kind of goal is this?" onCancel={onCancel} error={error} step={stepIndex} totalSteps={goalSteps.length}>
      <div className="flex flex-wrap gap-2">
        {GOAL_TYPES.map((t) => {
          const Icon = t.icon;
          const selected = goalForm.type === t.value;
          return (
            <button
              key={t.value}
              onClick={() => setGoalForm({ ...goalForm, type: t.value })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all"
              style={selected ? { background: t.light, borderColor: t.border, color: t.accent } : { background: "white", borderColor: "#e5e7eb", color: "#6b7280" }}
            >
              <Icon size={11} />{t.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => setStep("goal_target")}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
        >
          Continue
        </button>
        <button onClick={() => setStep(objectives.length > 0 ? "goal_objective" : "goal_title")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Back</button>
      </div>
    </WizardShell>
  );

  if (step === "goal_target") return (
    <WizardShell label="What does success look like?" onCancel={onCancel} error={error} step={stepIndex} totalSteps={goalSteps.length}>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Target</label>
          <input
            autoFocus
            type="text"
            placeholder="e.g. 95% within 24h"
            value={goalForm.target}
            onChange={(e) => setGoalForm({ ...goalForm, target: e.target.value })}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Timeframe</label>
          <select
            value={goalForm.timeframe}
            onChange={(e) => setGoalForm({ ...goalForm, timeframe: e.target.value })}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
          >
            <option value="">Select…</option>
            {TIMEFRAMES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => setStep("goal_context")}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
        >
          Continue
        </button>
        <button onClick={() => setStep("goal_type")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Back</button>
      </div>
    </WizardShell>
  );

  if (step === "goal_context") return (
    <WizardShell label="Anything else worth noting?" onCancel={onCancel} error={error} step={stepIndex} totalSteps={goalSteps.length}>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5">Context <span className="text-gray-400 font-normal">(optional)</span></label>
        <textarea
          autoFocus
          rows={3}
          placeholder="Why this matters — totally optional."
          value={goalForm.description}
          onChange={(e) => setGoalForm({ ...goalForm, description: e.target.value })}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
        />
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSaveGoal}
          disabled={savingGoal}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50"
        >
          {savingGoal && <Loader2 size={13} className="animate-spin" />}
          Create goal — next, the KPI
        </button>
        <button onClick={() => setStep("goal_target")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Back</button>
      </div>
    </WizardShell>
  );

  if (step === "kpi_describe") return (
    <WizardShell label={`How will you measure "${createdGoal?.title}"?`} onCancel={onCancel} error={error} step={stepIndex} totalSteps={goalSteps.length}>
      {/* Explicit phase-transition beat — the user just saved their Product
          Goal and the wizard is now moving into KPI territory. Without this,
          the step swap felt like an abrupt context switch with no explanation. */}
      <div className="flex items-center gap-2 -mt-2">
        <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
        <p className="text-xs text-emerald-600 font-medium">Goal saved — now define how you&apos;ll track it.</p>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5">
          What&apos;s the one number you&apos;d look at to know this goal is moving?
        </label>
        <textarea
          autoFocus
          rows={3}
          placeholder="e.g. The percentage of claims that get paid within 24 hours of being lodged."
          value={kpiDescription}
          onChange={(e) => setKpiDescription(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
        />
        <SuggestionChips
          examples={["% of claims paid within 24h", "Weekly active users", "Signups completed within 5 minutes"]}
          onPick={setKpiDescription}
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleProposeKpi}
          disabled={proposingKpi}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50"
        >
          {proposingKpi ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {proposingKpi ? "Thinking…" : "Suggest a KPI"}
        </button>
        <button onClick={() => setStep("done")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
          Skip — I&apos;ll add this later
        </button>
      </div>
    </WizardShell>
  );

  if (step === "kpi_name") return (
    <WizardShell label="What's it called?" onCancel={onCancel} error={error} step={stepIndex} totalSteps={goalSteps.length}>
      <p className="text-xs text-gray-400">Here&apos;s the KPI we put together — change it if it&apos;s not quite right.</p>
      <input
        autoFocus
        type="text"
        placeholder="Name this KPI"
        value={kpiForm.name}
        onChange={(e) => setKpiForm({ ...kpiForm, name: e.target.value })}
        className="w-full border-0 border-b border-gray-200 px-0 py-1.5 text-lg font-semibold text-gray-900 placeholder:text-gray-300 placeholder:font-normal focus:outline-none focus:border-indigo-400 transition-colors"
      />
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => {
            if (!kpiForm.name.trim()) { setError("KPI name is required."); return; }
            setError("");
            setStep("kpi_event");
          }}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
        >
          Continue
        </button>
        <button onClick={() => setStep("kpi_describe")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Back</button>
      </div>
    </WizardShell>
  );

  if (step === "kpi_event") return (
    <WizardShell label="Which event tracks this?" onCancel={onCancel} error={error} step={stepIndex} totalSteps={goalSteps.length}>
      <p className="text-xs text-gray-400 -mt-2">Optional — you can wire this up later.</p>
      {kpiForm.event_name && (
        <p className="text-[11px] text-emerald-600">
          ✓ Matched to an event you already track: <span className="font-mono">{kpiForm.event_name}</span>
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <EventCombobox
          value={kpiForm.event_name}
          onChange={(v) => setKpiForm({ ...kpiForm, event_name: v })}
          options={eventNames}
          placeholder={eventNames.length > 0 ? "Search events…" : "event_name (optional)"}
          className="flex-1"
        />
        <select
          value={kpiForm.aggregation}
          onChange={(e) => setKpiForm({ ...kpiForm, aggregation: e.target.value })}
          className="border border-gray-200 rounded-xl px-2.5 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          <option value="unique_users">Unique users</option>
          <option value="count">Event count</option>
          <option value="unique_sessions">Unique sessions</option>
        </select>
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => setStep("kpi_target")}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
        >
          Continue
        </button>
        <button onClick={() => setStep("kpi_name")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Back</button>
      </div>
    </WizardShell>
  );

  if (step === "kpi_target") return (
    <WizardShell label="What's the target?" onCancel={onCancel} error={error} step={stepIndex} totalSteps={goalSteps.length}>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Target</label>
          <input
            autoFocus
            type="text"
            placeholder="e.g. 95%"
            value={kpiForm.target}
            onChange={(e) => setKpiForm({ ...kpiForm, target: e.target.value })}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Target number <span className="text-gray-400 font-normal">(optional)</span></label>
          <input
            type="number"
            value={kpiForm.target_value}
            onChange={(e) => setKpiForm({ ...kpiForm, target_value: e.target.value })}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
      </div>
      <p className="text-[11px] text-gray-400">
        Need something more specific — like comparing two events, or a time window? You can add that from the KPI&apos;s edit icon once it&apos;s created.
      </p>
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSaveKpi}
          disabled={savingKpi}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50"
        >
          {savingKpi && <Loader2 size={13} className="animate-spin" />}
          Save KPI
        </button>
        <button onClick={() => setStep("kpi_event")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Back</button>
      </div>
    </WizardShell>
  );

  // step === "done"
  return (
    <WizardShell label="All set" onCancel={onCancel} error={error}>
      <div className="flex items-center gap-2 text-emerald-600">
        <CheckCircle2 size={16} />
        <p className="text-sm font-medium">
          &quot;{createdGoal?.title}&quot; is created{kpisCreated.length > 0 ? ` with ${kpisCreated.length} KPI${kpisCreated.length > 1 ? "s" : ""}` : ""}.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleAddAnotherKpi}
          className="flex items-center gap-2 border border-gray-200 hover:border-indigo-300 text-gray-600 hover:text-indigo-600 text-sm font-medium px-4 py-2 rounded-xl transition-colors"
        >
          <Plus size={13} /> Add another KPI
        </button>
        <button
          onClick={onSaved}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
        >
          Done
        </button>
      </div>
    </WizardShell>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SYNC_WINDOWS = [
  { label: "7d",  days: 7  },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "60d", days: 60 },
  { label: "90d", days: 90 },
] as const;

// ─── Page ─────────────────────────────────────────────────────────────────────

// What this org calls the sub-goal layer under a Business Goal — defaults to
// "Product Goal" but is renamable per org (Settings → Terminology) for
// white-labeling. Naive pluralization (append "s") covers every label an org
// is realistically going to pick (Initiative, Workstream, OKR, Goal, etc.).
function pluralize(label: string): string {
  return label.toLowerCase().endsWith("s") ? label : `${label}s`;
}

// ─── Product Goal Drawer ───────────────────────────────────────────────────────
// 75% wide right slide-over with a dark backdrop. Keeps the page visible behind
// it so the user never loses context, and gives the wizard plenty of space.
function GoalDrawer({
  open,
  onClose,
  objectives,
  goalLabel,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  objectives: CompanyObjective[];
  goalLabel: string;
  onSaved: () => Promise<void>;
}) {
  const [visible, setVisible] = useState(false);

  // Animate in/out: mount immediately on open, then trigger transition
  useEffect(() => {
    if (open) {
      // tiny delay so the initial render is off-screen before we slide in
      const t = setTimeout(() => setVisible(true), 10);
      return () => clearTimeout(t);
    } else {
      setVisible(false);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open && !visible) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
        onClick={onClose}
      />

      {/* Drawer panel — slides in from the right */}
      <div
        className="fixed inset-y-0 right-0 z-50 flex flex-col bg-white shadow-2xl transition-transform duration-300 ease-out"
        style={{ width: "75%", transform: visible ? "translateX(0)" : "translateX(100%)" }}
      >
        {/* Drawer header */}
        <div className="flex items-start justify-between px-8 pt-7 pb-5 border-b border-gray-100">
          <div>
            <p className="text-[10px] font-semibold tracking-widest uppercase text-indigo-500 mb-1">
              New {goalLabel}
            </p>
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">
              Break your Business Goal into a team-owned outcome
            </h2>
            <p className="text-sm text-gray-400 mt-1 max-w-lg">
              A {goalLabel} is the specific result a team owns — like &quot;Reduce claims processing time&quot; or
              &quot;Improve signup completion.&quot; You&apos;ll measure it with a KPI and link the features driving it.
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-6 flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors mt-1"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Wizard body — scrollable */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <GuidedGoalWizard
            objectives={objectives}
            goalLabel={goalLabel}
            onSaved={onSaved}
            onCancel={onClose}
          />
        </div>
      </div>
    </>
  );
}

export default function BusinessGoalsPage() {
  const { currentOrg } = useOrg();
  const productGoalLabel = currentOrg?.product_goal_label?.trim() || "Product Goal";
  const productGoalLabelPlural = pluralize(productGoalLabel);
  const [goals, setGoals] = useState<BusinessGoal[]>([]);
  const [health, setHealth] = useState<GoalHealthData>({ featuresByGoal: {}, eventCounts: {} });
  const [impactByFeature, setImpactByFeature] = useState<Record<string, FeatureImpactResult>>({});
  const [kpisByGoal, setKpisByGoal] = useState<Record<string, MetricWithData[]>>({});
  const [goalProgress, setGoalProgress] = useState<Record<string, GoalProgress>>({});
  const [loading, setLoading] = useState(true);
  const [, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [mpConnected, setMpConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncDays, setSyncDays] = useState(30);
  // When this sync last actually ran — drives the "first time, pick a wide
  // window" vs. "synced recently, a short window is enough" hint below.
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  // The real, company-wide objectives — see ObjectivesPanel.
  const [objectives, setObjectives] = useState<CompanyObjective[]>([]);
  // Set to true while ObjectivesPanel's own wizard is open — gates Stage 2
  // so it never renders alongside the wizard's "done" step simultaneously.
  const [objectivePanelWizardOpen, setObjectivePanelWizardOpen] = useState(false);
  // Set true the moment the user clicks "Add my first Product Goal" from the
  // Business Goal wizard — keeps Stage 2 showing and prevents the first-run
  // state from flashing while objectives hasn't reloaded yet.
  const [pendingFirstGoal, setPendingFirstGoal] = useState(false);
  // Set true while the first Product Goal is saving / page is reloading —
  // prevents Stage 2 from briefly reappearing while load() is in-flight.
  const [productGoalJustCreated, setProductGoalJustCreated] = useState(false);

  // ── Filters
  const [filterType, setFilterType]     = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterObjective, setFilterObjective] = useState<string>("all");

  async function load() {
    if (!currentOrg) return;
    // getGoalProgress used to be called here independently, which meant it
    // internally re-ran getKpisByGoal (and everything that fans out from
    // it — a parallel trend query per KPI in the org) a second time, right
    // alongside the getKpisByGoal call directly below it. Same data, fetched
    // and recomputed twice on every single Goals page load. Awaiting
    // kpiData first and handing it straight to getGoalProgress means that
    // whole computation only happens once.
    const [goalsData, healthData, mpStatus, kpiData, objectivesData] = await Promise.all([
      getBusinessGoals(currentOrg.id),
      getGoalHealthData(currentOrg.id),
      getMixpanelSettings(currentOrg.id),
      getKpisByGoal(currentOrg.id),
      getCompanyObjectives(currentOrg.id),
    ]);
    const progressData = await getGoalProgress(currentOrg.id, kpiData);
    setGoals(goalsData);
    setObjectives(objectivesData);
    setPendingFirstGoal(false); // objectives are now fresh — safe to clear the transition flag
    setHealth(healthData);
    setMpConnected(mpStatus.connected);
    setLastSyncedAt(mpStatus.lastSyncedAt ?? null);
    setKpisByGoal(kpiData);
    setGoalProgress(progressData);
    setLoading(false);

    // Impact verdicts are heavier to compute (event-level queries) — load them
    // after the main view renders so the page doesn't wait on them.
    getFeatureImpactSummaries(currentOrg.id).then((summaries) => {
      const map: Record<string, FeatureImpactResult> = {};
      summaries.forEach((s) => { map[s.featureId] = s; });
      setImpactByFeature(map);
    });
  }

  async function syncMixpanel() {
    if (!currentOrg) return;
    setSyncing(true);
    setSyncMsg(null);

    const allEventNames = Object.values(health.featuresByGoal)
      .flat()
      .flatMap((f) => f.suggestions.map((s) => s.event_name).filter(Boolean) as string[]);

    const unique = [...new Set(allEventNames)];
    if (!unique.length) {
      setSyncMsg("No tracked events to pull yet — link a feature to this goal first, then come back to sync its Mixpanel data.");
      setSyncing(false);
      return;
    }

    const result = await fetchMixpanelEventCounts(currentOrg.id, unique, syncDays);
    if (result.error) {
      setSyncMsg(result.error);
      setSyncing(false);
      return;
    }

    setHealth((prev) => ({
      ...prev,
      eventCounts: { ...prev.eventCounts, ...result.counts },
    }));
    const total = Object.values(result.counts ?? {}).reduce((s, c) => s + c, 0);

    // Also pull real per-occurrence data (timestamp + user) for these same
    // event names, scoped and capped — this is what lets Feature Impact
    // compute trend-break and adopter/non-adopter comparisons for orgs whose
    // events live in Mixpanel rather than coming in via CSV/SDK directly.
    const rawResult = await syncMixpanelRawEvents(currentOrg.id, unique, syncDays);

    if (rawResult.error) {
      setSyncMsg(`Synced ${total.toLocaleString()} events across ${unique.length} signals (counts only — ${rawResult.error}).`);
    } else {
      setLastSyncedAt(new Date().toISOString());
      setSyncMsg(`Synced ${total.toLocaleString()} events across ${unique.length} signals in the last ${syncDays} days${rawResult.synced > 0 ? ` (+${rawResult.synced.toLocaleString()} raw events for impact analysis)` : ""}.`);
    }
    setSyncing(false);

    // Recompute impact verdicts now that fresh raw events may have landed.
    getFeatureImpactSummaries(currentOrg.id).then((summaries) => {
      const map: Record<string, FeatureImpactResult> = {};
      summaries.forEach((s) => { map[s.featureId] = s; });
      setImpactByFeature(map);
    });
  }

  useEffect(() => { load(); }, [currentOrg]); // eslint-disable-line

  function handleStatusChange(id: string, status: BusinessGoal["status"]) {
    startTransition(async () => { await updateGoalStatus(id, status); await load(); });
  }

  function handleDelete(id: string) {
    setGoals((prev) => prev.filter((g) => g.id !== id));
    // Re-sync with the DB after the delete attempt instead of trusting the
    // optimistic removal blindly — if the write actually failed, this both
    // surfaces it immediately and restores the goal right away, rather than
    // having it silently reappear later when something else triggers a load().
    startTransition(async () => {
      const { error } = await deleteBusinessGoal(id);
      if (error) alert(`Couldn't delete this goal, so it's back: ${error}`);
      await load();
    });
  }

  function handlePermanentDelete(id: string) {
    if (!confirm("Permanently delete this goal? It won't appear anywhere, including reports.")) return;
    setGoals((prev) => prev.filter((g) => g.id !== id));
    startTransition(async () => {
      const { error } = await permanentlyDeleteBusinessGoal(id);
      if (error) alert(`Couldn't delete this goal, so it's back: ${error}`);
      await load();
    });
  }

  // Apply filters
  const filtered = goals.filter((g) => {
    if (filterType      !== "all" && g.type !== filterType)                       return false;
    if (filterStatus    !== "all" && g.status !== filterStatus)                   return false;
    if (filterObjective !== "all" && g.company_objective_id !== filterObjective)  return false;
    return true;
  });

  const active   = filtered.filter((g) => g.status === "active");
  const achieved = filtered.filter((g) => g.status === "achieved");
  const missed   = filtered.filter((g) => g.status === "missed");
  const dropped  = filtered.filter((g) => g.status === "dropped");

  const totalFeatures = Object.values(health.featuresByGoal).flat().length;
  const firingEvents  = Object.values(health.eventCounts).filter((c) => c > 0).length;
  const totalEvents   = Object.keys(health.eventCounts).length;
  const filtersActive = filterType !== "all" || filterStatus !== "all" || filterObjective !== "all";

  // True page-level first run — nothing exists anywhere yet. Collapses the
  // whole page down to one focused onboarding moment instead of two
  // separately-empty sections plus controls (sync window, filters) that
  // don't mean anything before a goal exists. See ObjectivesPanel.
  const isFirstRun = objectives.length === 0 && goals.length === 0;

  // Drives the hint text next to the day-window picker — first-time syncs
  // need a wide window to get real history, recent ones don't.
  const daysSinceSync = lastSyncedAt
    ? Math.floor((Date.now() - new Date(lastSyncedAt).getTime()) / 864e5)
    : null;
  const syncHint =
    daysSinceSync === null
      ? "Never synced — pick 90d to pull as much history as Mixpanel allows."
      : daysSinceSync === 0
      ? "Synced today — 7d is enough to catch up."
      : `Last synced ${daysSinceSync} day${daysSinceSync === 1 ? "" : "s"} ago — ${
          daysSinceSync <= 14 ? "7d or 14d" : "30d+"
        } should cover the gap.`;

  if (loading) return <PageLoader />;

  // Progress badge — counts completed setup steps
  const setupSteps = [
    objectives.length > 0,
    objectives.some(o => !!o.target?.trim()),
    goals.length > 0,
    Object.values(goalProgress).some(gp => gp.progressRatio !== null),
    goals.some(g => (g as BusinessGoal & { feature_metrics?: unknown[] }).feature_metrics?.length),
  ];
  const setupDone = setupSteps.filter(Boolean).length;
  const setupTotal = setupSteps.length;
  const setupComplete = setupDone === setupTotal;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Business Goal panel — hidden during the transition from Business Goal
          wizard "done" step to Product Goal wizard (pendingFirstGoal=true,
          objectives still stale) to avoid flashing an orphaned empty state. */}
      {(!pendingFirstGoal || objectives.length > 0) && (
        <ObjectivesPanel
          objectives={objectives}
          goals={goals}
          goalProgress={goalProgress}
          filterObjective={filterObjective}
          onFilterChange={setFilterObjective}
          onSaved={load}
          label={productGoalLabel}
          labelPlural={productGoalLabelPlural}
          isFirstRun={isFirstRun}
          onCreateFirstGoal={() => { setPendingFirstGoal(true); setShowForm(true); }}
          onOpenChange={setObjectivePanelWizardOpen}
        />
      )}

      {/* Stage 2: Business Goal exists, no Product Goal yet — show a clean
          hero explaining what a Product Goal is. The wizard lives in the
          drawer, not inline, so the page context stays visible. */}
      {(objectives.length > 0 || pendingFirstGoal) && goals.length === 0 && !objectivePanelWizardOpen && !productGoalJustCreated && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-20 text-center px-8">
          <div className="w-11 h-11 rounded-2xl bg-indigo-50 flex items-center justify-center mb-5">
            <Target size={18} className="text-indigo-500" />
          </div>
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 size={14} className="text-emerald-500" />
            <p className="text-xs text-emerald-600 font-medium">Business Goal set</p>
          </div>
          <h3 className="text-2xl font-bold text-gray-900 tracking-tight mb-3">Now, break it down.</h3>
          <p className="text-sm text-gray-500 max-w-md mb-2">
            A <strong className="text-gray-700">{productGoalLabel}</strong> is the specific, team-owned outcome that moves your Business Goal forward —
            like &quot;Reduce claims processing time&quot; or &quot;Improve signup completion rate.&quot;
          </p>
          <p className="text-sm text-gray-400 max-w-sm mb-8">
            You&apos;ll define a KPI to measure it and link the features your team is building to move that number.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-10 py-3 rounded-xl transition-colors"
          >
            <Plus size={14} /> Add my first {productGoalLabel.toLowerCase()}
          </button>
        </div>
      )}

      {/* Drawer — used for both Stage 2 (first goal) and Stage 3 (add more) */}
      <GoalDrawer
        open={showForm && !objectivePanelWizardOpen}
        onClose={() => setShowForm(false)}
        objectives={objectives}
        goalLabel={productGoalLabel}
        onSaved={async () => {
          setProductGoalJustCreated(true);
          setShowForm(false);
          await load();
          setProductGoalJustCreated(false);
        }}
      />

      {/* Full management page — only once there's at least one real Product Goal.
          productGoalJustCreated keeps it visible during the brief load() gap
          so the wizard completion feels instant, not stutter-y. */}
      {(goals.length > 0 || productGoalJustCreated) && (
      <>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{productGoalLabelPlural}</h1>
          <p className="text-sm text-gray-400 mt-1">
            The narrower goals product owns to move the Business Goal(s) above — broken into KPIs (key results), then tracked against the features built to move them.
          </p>
        </div>
        <div className="flex items-start gap-2 flex-shrink-0">
          {/* Mixpanel sync block */}
          {mpConnected ? (
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1.5 border border-gray-200 rounded-xl overflow-hidden">
                {/* Time window pills */}
                <div className="flex items-center px-2 gap-0.5">
                  {SYNC_WINDOWS.map((w) => (
                    <button
                      key={w.days}
                      onClick={() => setSyncDays(w.days)}
                      title={`Pull the last ${w.days} days of Mixpanel data`}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                        syncDays === w.days
                          ? "bg-indigo-600 text-white"
                          : "text-gray-400 hover:text-gray-600"
                      }`}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
                <div className="w-px h-5 bg-gray-200" />
                <button
                  onClick={syncMixpanel}
                  disabled={syncing}
                  title="Pulls event counts and raw data from Mixpanel for features already linked to a goal — different from 'Sync Event Names' on the Sources page, which just imports event names."
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  Pull Mixpanel Data
                </button>
              </div>
              {/* Plain-language hint so the window picker is self-explanatory
                  instead of just showing bare day counts. */}
              <p className="text-[11px] text-gray-400 pr-1">{syncHint}</p>
            </div>
          ) : (
            <a
              href="/settings"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-gray-200 text-sm text-gray-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors"
            >
              <Zap size={14} /> Connect Mixpanel
            </a>
          )}
          {(
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
            >
              <Plus size={14} /> Add {productGoalLabel.toLowerCase()}
            </button>
          )}
        </div>
      </div>

      {/* Sync status */}
      {syncMsg && (
        <div className={`flex items-center gap-2 text-sm px-4 py-2.5 rounded-xl border ${
          syncMsg.startsWith("Synced")
            ? "bg-emerald-50 border-emerald-100 text-emerald-700"
            : "bg-red-50 border-red-100 text-red-600"
        }`}>
          {syncMsg.startsWith("Synced") ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          {syncMsg}
        </div>
      )}

      {/* Health summary + filters — combined into one bar, and only shown
          once there's enough on the page to actually need them. With one or
          two goals, three stat cards plus twelve filter pills above a single
          card was pure scaffolding — noise before you reach the one thing
          you came to look at. */}
      {goals.length > 3 && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-500">
              <strong className="text-gray-900">{goals.filter(g => g.status === "active").length}</strong> active
            </span>
            <span className="text-gray-300">·</span>
            <span className="text-gray-500">
              <strong className="text-gray-900">{totalFeatures}</strong> feature{totalFeatures !== 1 ? "s" : ""} aligned
            </span>
            <span className="text-gray-300">·</span>
            <span className="text-gray-500">
              <strong className={firingEvents === totalEvents && totalEvents > 0 ? "text-emerald-600" : "text-amber-600"}>{firingEvents}/{totalEvents}</strong> events firing
            </span>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300"
            >
              <option value="all">All types</option>
              {GOAL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300"
            >
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="achieved">Achieved</option>
              <option value="missed">Missed</option>
              <option value="dropped">Dropped</option>
            </select>
            {filtersActive && (
              <button
                onClick={() => { setFilterType("all"); setFilterStatus("all"); setFilterObjective("all"); }}
                className="text-xs text-indigo-500 hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <GuidedGoalWizard
          objectives={objectives}
          goalLabel={productGoalLabel}
          onSaved={async () => { setShowForm(false); await load(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Empty state — filters returned nothing (goals.length > 0 is
          already guaranteed by the wrapping block above) */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-100 py-12 text-center">
          <p className="text-sm text-gray-400 mb-2">No goals match the current filters.</p>
          <button
            onClick={() => { setFilterType("all"); setFilterStatus("all"); setFilterObjective("all"); }}
            className="text-xs text-indigo-500 hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}
      </>
      )}

      {/* Active */}
      {active.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Active · {active.length}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((g) => (
              <GoalCard
                key={g.id}
                goal={g}
                features={health.featuresByGoal[g.id] ?? []}
                eventCounts={health.eventCounts}
                impactByFeature={impactByFeature}
                kpis={kpisByGoal[g.id] ?? []}
                goalProgress={goalProgress[g.id]}
                objectives={objectives}
                orgId={currentOrg?.id}
                onStatusChange={handleStatusChange}
                onDelete={handleDelete}
                onDatesUpdated={load}
                onKpiAdded={load}
                onObjectiveChanged={load}
              />
            ))}
          </div>
        </section>
      )}

      {/* Achieved */}
      {achieved.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 size={14} className="text-yellow-500" />
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Achieved · {achieved.length}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {achieved.map((g) => (
              <GoalCard
                key={g.id}
                goal={g}
                features={health.featuresByGoal[g.id] ?? []}
                eventCounts={health.eventCounts}
                impactByFeature={impactByFeature}
                kpis={kpisByGoal[g.id] ?? []}
                goalProgress={goalProgress[g.id]}
                objectives={objectives}
                orgId={currentOrg?.id}
                onStatusChange={handleStatusChange}
                onDelete={handleDelete}
                onDatesUpdated={load}
                onKpiAdded={load}
                onObjectiveChanged={load}
              />
            ))}
          </div>
        </section>
      )}

      {/* Missed */}
      {missed.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <span className="h-2 w-2 rounded-full bg-red-400" />
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Missed · {missed.length}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {missed.map((g) => (
              <GoalCard
                key={g.id}
                goal={g}
                features={health.featuresByGoal[g.id] ?? []}
                eventCounts={health.eventCounts}
                impactByFeature={impactByFeature}
                kpis={kpisByGoal[g.id] ?? []}
                goalProgress={goalProgress[g.id]}
                objectives={objectives}
                orgId={currentOrg?.id}
                onStatusChange={handleStatusChange}
                onDelete={handleDelete}
                onDatesUpdated={load}
                onKpiAdded={load}
                onObjectiveChanged={load}
              />
            ))}
          </div>
        </section>
      )}

      {/* Dropped */}
      {dropped.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <span className="h-2 w-2 rounded-full bg-gray-300" />
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Dropped · {dropped.length}</p>
            <span className="text-[11px] text-gray-400 ml-1">· shown in reports · delete to remove entirely</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dropped.map((g) => (
              <div key={g.id} className="flex flex-col">
                <GoalCard
                  goal={g}
                  features={health.featuresByGoal[g.id] ?? []}
                  eventCounts={health.eventCounts}
                  impactByFeature={impactByFeature}
                  kpis={kpisByGoal[g.id] ?? []}
                  goalProgress={goalProgress[g.id]}
                  objectives={objectives}
                  orgId={currentOrg?.id}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                  onKpiAdded={load}
                  onObjectiveChanged={load}
                />
                <button
                  onClick={() => handlePermanentDelete(g.id)}
                  className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-red-400 hover:text-red-600 bg-white hover:bg-red-50 border border-t-0 border-dashed border-red-200 hover:border-red-300 rounded-b-lg py-2 transition-colors"
                >
                  <Trash2 size={11} /> Delete permanently
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Fixed bottom-right setup checklist — visible whenever any step is incomplete */}
      <SetupChecklist objectives={objectives} goals={goals} goalProgress={goalProgress} />

    </div>
  );
}
