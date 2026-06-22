"use client";

import { useState, useEffect, useTransition } from "react";
import {
  Plus, Target, TrendingUp, Users, Settings, Package, Globe,
  Trash2, Loader2, Trophy, CheckCircle2, ChevronDown, Check,
  ChevronRight, Lightbulb, Zap, AlertCircle, Activity, RefreshCw,
  Calendar, ShieldAlert, Pencil, FileSpreadsheet,
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
} from "@/app/actions/company-objectives";
import { getReportSources, fetchSheetData } from "@/app/actions/reports";
import { getSheetRowOptions } from "@/app/actions/manual-kpi";
import type { BusinessGoal, FeatureSuggestion, Metric, CompanyObjective, ReportSource } from "@/types/database";

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
  onResult?: (trend: MetricDataPoint[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{ label: string; since: string; until: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ total: number; trend: MetricDataPoint[] } | null>(null);

  async function pick(opt: { label: string; since: string; until: string } | null) {
    setOpen(false);
    setPicked(opt);
    if (!opt) { setResult(null); onResult?.(defaultTrend); return; }
    setLoading(true);
    const res = await getKpiForRange(metricId, opt.since, opt.until);
    setLoading(false);
    if (!res.error) { setResult(res); onResult?.(res.trend); }
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

  // Shown on hover on every variant of this row — same actions regardless
  // of whether the KPI is wired, a rate, or a plain volume KPI. The trend
  // toggle only makes sense once there's an event actually producing data.
  const RowActions = (
    <span className="hidden group-hover:flex items-center gap-1.5 flex-shrink-0">
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
      <MetricsChart metrics={[kpi]} title={`${kpi.name} — 30-day trend`} />
    </div>
  ) : null;

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
    const caveat = hasWindow && asPercentage
      ? `% of individual ${kpi.denominator_event_name} occurrences whose own matching ${kpi.event_name} landed within ${kpi.within_hours}h — each occurrence checked on its own, so one fast match can't cover the rest of that same person's other claims.`
      : hasWindow && !asPercentage
      ? `Raw count of times the second event got a matching first event within ${kpi.within_hours}h — counted per occurrence, not per user.`
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
          />
          {RowActions}
          <span className="text-[10px] text-gray-400 flex-shrink-0 w-16 text-right">
            {featureCount} feature{featureCount !== 1 ? "s" : ""}
          </span>
        </div>
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
        />
        {RowActions}
        <span className="text-[10px] text-gray-400 flex-shrink-0 w-16 text-right">
          {featureCount} feature{featureCount !== 1 ? "s" : ""}
        </span>
      </div>
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
  }>(
    initial?.denominator_event_name
      ? {
          referenceEvent: initial.denominator_event_name,
          asPercentage: initial.rate_as_percentage !== false,
          withinHoursEnabled: typeof initial.within_hours === "number" && initial.within_hours > 0,
          withinHours: typeof initial.within_hours === "number" ? String(initial.within_hours) : "",
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
            onClick={() => setProperty({ referenceEvent: "", asPercentage: false, withinHoursEnabled: false, withinHours: "" })}
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
              <div className="pl-5">
                <input
                  type="number"
                  min={1}
                  placeholder="Hours, e.g. 24"
                  value={property.withinHours}
                  onChange={(e) => setProperty({ ...property, withinHours: e.target.value })}
                  className="w-32 border border-gray-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
                />
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
  const Icon = cfg.icon;
  const isMissed = goal.status === "missed";
  const health = goalHealthStatus(features, eventCounts);

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
        "group bg-white border border-gray-200 rounded-lg hover:bg-gray-50/60 transition-colors",
        // Collapsed cards sit in the 2/3-column grid like everything else.
        // Expanded ones carry a full KPI list + inline forms + features —
        // cramming that into a single grid column looks broken (cut-off
        // inputs, a tall lonely card next to empty columns). Span the full
        // row instead so there's room to breathe.
        expanded && "sm:col-span-2 lg:col-span-3"
      )}
    >
      <div className="p-4">
        {/* Type + status + delete row */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold tracking-widest uppercase text-gray-400">
            {cfg.label}
          </span>

          <div className="flex items-center gap-2">
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
        <p className={`text-[15px] font-semibold leading-snug mb-1 ${isMissed ? "line-through text-gray-300" : "text-gray-900"}`}>
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
// these via the picker in AddGoalForm/GoalCard.

function ObjectiveForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const { currentOrg } = useOrg();
  const [form, setForm] = useState({ title: "", description: "", target: "", timeframe: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!currentOrg || !form.title.trim()) { setError("Title is required."); return; }
    setSaving(true);
    setError("");
    const result = await createCompanyObjective(currentOrg.id, form);
    setSaving(false);
    if (result.error) { setError(result.error); return; }
    onSaved();
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
      <p className="text-sm font-bold text-gray-800">New business goal</p>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5">The one big thing — what is the company trying to achieve? *</label>
        <input
          autoFocus
          type="text"
          placeholder="e.g. Grow policy activations & retention this quarter"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Target</label>
          <input
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
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5">
          Context <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <textarea
          placeholder="Why this matters this quarter/year…"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={2}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
        />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 size={13} className="animate-spin" />}
          Save business goal
        </button>
        <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
          Cancel
        </button>
      </div>
    </div>
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

  return (
    <div
      className={cn(
        "group relative rounded-2xl overflow-hidden transition-all bg-gradient-to-br from-slate-900 via-[#161B33] to-slate-900 border border-white/[0.06] shadow-lg shadow-slate-950/30",
        selected ? "ring-2 ring-offset-2 ring-amber-400/60" : "hover:shadow-xl hover:shadow-slate-950/40"
      )}
    >
      <button onClick={onSelect} className="relative w-full text-left p-4">
        <div className="flex items-center justify-between mb-2.5">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest uppercase text-amber-300/80">
            <Trophy size={10} className="text-amber-300/80" /> Business Goal
          </span>
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            className="flex items-center gap-0.5 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
          >
            {STATUS_OPTIONS.find((s) => s.value === objective.status)?.label}
            <ChevronDown size={10} />
          </span>
        </div>

        <p className={`text-base font-semibold leading-snug mb-1 tracking-tight ${isMissed ? "line-through text-white/40" : "text-white"}`}>
          {objective.title}
        </p>

        {objective.description && (
          <p className="text-xs text-slate-400 leading-relaxed mb-1">{objective.description}</p>
        )}

        <p className="text-xs text-slate-400 mb-3">
          {[objective.target, objective.timeframe].filter(Boolean).join(" · ") || "No target set"}
        </p>

        {pct === null ? (
          <p className="text-[11px] text-slate-500">
            {goalCount === 0
              ? `No ${labelPlural} linked yet.`
              : `${goalCount} ${goalCount !== 1 ? labelPlural : label} linked — none measurable yet.`}
          </p>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-slate-400">Rolled up from {labelPlural}</span>
              <span className={`text-[11px] font-semibold ${overshot ? "text-emerald-400" : "text-amber-200"}`}>
                {pct.toLocaleString()}%{overshot ? " — exceeded" : ""}
              </span>
            </div>
            <div className="h-[3px] rounded-full bg-white/[0.08] overflow-hidden">
              <div
                className={`h-full rounded-full ${overshot ? "bg-emerald-400" : "bg-gradient-to-r from-amber-300 to-amber-100"}`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
          </div>
        )}
      </button>

      <div className="relative flex items-center justify-between px-4 py-2.5 border-t border-white/[0.06]">
        <span className="text-[11px] text-slate-500">
          {goalCount} {goalCount !== 1 ? labelPlural : label}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all"
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

function ObjectivesPanel({
  objectives,
  goals,
  goalProgress,
  filterObjective,
  onFilterChange,
  onSaved,
  label,
  labelPlural,
}: {
  objectives: CompanyObjective[];
  goals: BusinessGoal[];
  goalProgress: Record<string, GoalProgress>;
  filterObjective: string;
  onFilterChange: (id: string) => void;
  onSaved: () => void;
  label: string;
  labelPlural: string;
}) {
  const [showForm, setShowForm] = useState(false);

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
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors"
            >
              <Plus size={12} /> Add business goal
            </button>
          )}
        </div>
      </div>

      {showForm ? (
        <ObjectiveForm onSaved={() => { setShowForm(false); onSaved(); }} onCancel={() => setShowForm(false)} />
      ) : objectives.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-10 text-center">
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

// ─── Add Goal Form ────────────────────────────────────────────────────────────

function AddGoalForm({ objectives, onSaved, onCancel }: { objectives: CompanyObjective[]; onSaved: () => void; onCancel: () => void }) {
  const { currentOrg } = useOrg();
  const [form, setForm] = useState({ title: "", description: "", type: "growth", target: "", timeframe: "", company_objective_id: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!currentOrg || !form.title.trim()) { setError("Goal title is required."); return; }
    setSaving(true);
    setError("");
    const result = await createBusinessGoal(currentOrg.id, {
      ...form,
      company_objective_id: form.company_objective_id || null,
    });
    setSaving(false);
    if (result.error) { setError(result.error); return; }
    onSaved();
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6 space-y-5">
      <p className="text-sm font-bold text-gray-800">New product goal</p>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5">What&apos;s the goal? *</label>
        <input
          autoFocus
          type="text"
          placeholder="e.g. Improve onboarding CSAT to 4.5"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>

      {objectives.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">
            Which business goal does this move? <span className="text-gray-400 font-normal">(optional, can set later)</span>
          </label>
          <select
            value={form.company_objective_id}
            onChange={(e) => setForm({ ...form, company_objective_id: e.target.value })}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
          >
            <option value="">Not linked yet</option>
            {objectives.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-2">Type</label>
        <div className="flex flex-wrap gap-2">
          {GOAL_TYPES.map((t) => {
            const Icon = t.icon;
            const selected = form.type === t.value;
            return (
              <button
                key={t.value}
                onClick={() => setForm({ ...form, type: t.value })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all"
                style={selected
                  ? { background: t.light, borderColor: t.border, color: t.accent }
                  : { background: "white", borderColor: "#e5e7eb", color: "#6b7280" }}
              >
                <Icon size={11} />{t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Target</label>
          <input
            type="text"
            placeholder="e.g. £2M ARR"
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

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5">
          Context <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <textarea
          placeholder="Why this goal matters, what achieving it unlocks…"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={2}
          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
        />
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 size={13} className="animate-spin" />}
          Save goal
        </button>
        <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
          Cancel
        </button>
      </div>
    </div>
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

  if (loading) {
    // Same reasoning as the Dashboard's skeleton: a lone spinner on an
    // otherwise blank page gives no sense that anything is actually
    // progressing during a multi-second load. This shapes itself like the
    // real page below (header text is real — it only depends on the org's
    // own label setting, not the data fetch — plus placeholder cards in
    // roughly the shape goal cards actually render in).
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-6 animate-pulse">
        <div className="bg-white border border-gray-100 rounded-2xl p-6 h-28" />

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{productGoalLabelPlural}</h1>
            <p className="text-sm text-gray-400 mt-1">
              The narrower goals product owns to move the Business Goal(s) above — broken into KPIs (key results), then tracked against the features built to move them.
            </p>
          </div>
          <div className="h-9 w-40 bg-gray-100 rounded-xl flex-shrink-0" />
        </div>

        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white border border-gray-100 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="h-3.5 w-1/4 bg-gray-100 rounded" />
                <div className="h-5 w-16 bg-gray-100 rounded-full" />
              </div>
              <div className="h-2 w-2/3 bg-gray-50 rounded" />
              <div className="h-2 w-1/2 bg-gray-50 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* The real, company-wide Business Goals — separate from the Product
          Goals below, which ladder up to one of these. */}
      <ObjectivesPanel
        objectives={objectives}
        goals={goals}
        goalProgress={goalProgress}
        filterObjective={filterObjective}
        onFilterChange={setFilterObjective}
        onSaved={load}
        label={productGoalLabel}
        labelPlural={productGoalLabelPlural}
      />

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
          {!showForm && (
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
        <AddGoalForm
          objectives={objectives}
          onSaved={async () => { setShowForm(false); await load(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Empty state — no goals at all */}
      {goals.length === 0 && !showForm && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-16 text-center">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
            <Target size={20} className="text-indigo-500" />
          </div>
          <h3 className="text-sm font-semibold text-gray-700 mb-1">No goals yet</h3>
          <p className="text-sm text-gray-400 max-w-sm mb-5">
            Log what your company is trying to achieve. Every feature you build will be measured against these goals.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
          >
            <Plus size={14} /> Add your first goal
          </button>
        </div>
      )}

      {/* Empty state — filters returned nothing */}
      {goals.length > 0 && filtered.length === 0 && (
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

    </div>
  );
}
