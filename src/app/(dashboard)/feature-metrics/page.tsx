"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useOrg } from "@/contexts/org-context";
import {
  generateFeatureSuggestions,
  saveFeatureMetric,
  getFeatureMetrics,
  archiveFeatureMetric,
  updateFeatureLaunchDate,
  confirmFeatureLaunch,
  updateFeatureLaunchStatus,
  updateFeatureSuggestionFrequency,
  deleteFeatureSuggestion,
  addFeatureSuggestion,
  updateFeaturePmSlackHandle,
  notifySlackFeatureStatusChange,
  previewSheetFeatures,
  importSelectedFeatures,
  type FeatureLaunchStatus,
  type SheetImportResult,
  type PreviewFeature,
} from "@/app/actions/feature-metrics";
// PreviewFeature now only has { name, exists } — no extra data fields
import { getBusinessGoals } from "@/app/actions/business-goals";
import { getKpisByGoal, type MetricWithData } from "@/app/actions/metrics";
import { getDistinctEventNames } from "@/app/actions/events";
import type { FeatureInput, FeatureSuggestion, FeatureMetric, BusinessGoal } from "@/types/database";
import {
  Lightbulb, Loader2, Plus, Trash2, ChevronRight, ChevronLeft,
  CheckCircle2, BarChart3, TrendingUp, Shield, Zap, Clock,
  ExternalLink, Sparkles, ArrowRight, Trophy, Target, Link2,
  Calendar, AlertTriangle, Rocket, XCircle, RotateCcw, ChevronDown,
  Download, User, X, Upload,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const SECTORS = ["Product", "Growth", "Retention", "Engagement", "Monetization", "Onboarding", "Infrastructure", "Other"];
const TARGET_USERS = ["All users", "New users (< 7 days)", "Power users", "Paying users", "Churned users", "Specific segment"];
const FREQUENCIES = ["Multiple times per day", "Daily", "Weekly", "Monthly", "One-time action"];
const TIMELINES = ["< 1 week", "1–2 weeks", "This month", "This quarter", "No fixed date"];

const QUESTIONS: {
  key: keyof FeatureInput;
  label: string;
  placeholder: string;
  type: "text" | "textarea" | "select";
  options?: string[];
}[] = [
  { key: "feature_name",          label: "What is the feature called?",                       type: "text",     placeholder: "e.g. In-app notifications, Referral programme, Dark mode…" },
  { key: "feature_description",   label: "Describe what it does and the problem it solves",   type: "textarea", placeholder: "e.g. Lets users invite teammates directly from the dashboard without leaving the product, reducing friction in the onboarding flow." },
  { key: "sector",                label: "What area of the business does this serve?",         type: "select",   options: SECTORS, placeholder: "" },
  { key: "target_users",          label: "Who is the primary audience for this feature?",      type: "select",   options: TARGET_USERS, placeholder: "" },
  { key: "success_definition",    label: "What does success look like in 30 days?",           type: "textarea", placeholder: "e.g. 30% of new users send at least one invite within their first week, and conversion from trial to paid increases by 5 points." },
  { key: "failure_definition",    label: "What would failure look like?",                     type: "textarea", placeholder: "e.g. Less than 10% of users try the feature, or support tickets about the flow increase." },
  { key: "interaction_frequency", label: "How often will users interact with this feature?",  type: "select",   options: FREQUENCIES, placeholder: "" },
  { key: "launch_timeline",       label: "When are you launching?",                           type: "select",   options: TIMELINES, placeholder: "" },
  { key: "pm_slack_handle",       label: "Who owns this feature? (Slack handle, optional)",    type: "text",     placeholder: "e.g. @jane or jane.smith — we'll tag them in Slack updates" },
];

// ─── Goal type colours ────────────────────────────────────────────────────────

const GOAL_TYPE_COLOUR: Record<string, string> = {
  revenue:     "bg-emerald-100 text-emerald-700 border-emerald-200",
  growth:      "bg-blue-100 text-blue-700 border-blue-200",
  retention:   "bg-violet-100 text-violet-700 border-violet-200",
  product:     "bg-pink-100 text-pink-700 border-pink-200",
  operational: "bg-amber-100 text-amber-700 border-amber-200",
  market:      "bg-cyan-100 text-cyan-700 border-cyan-200",
};

// ─── Type badge ───────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: FeatureSuggestion["type"] }) {
  const map = {
    metric:    { label: "Metric",    icon: BarChart3,  cls: "bg-blue-50 text-blue-700 border-blue-200" },
    kpi:       { label: "KPI",       icon: TrendingUp, cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
    guardrail: { label: "Guardrail", icon: Shield,     cls: "bg-amber-50 text-amber-700 border-amber-200" },
  };
  const { label, icon: Icon, cls } = map[type];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border ${cls}`}>
      <Icon size={10} /> {label}
    </span>
  );
}

// ─── Frequency badge ──────────────────────────────────────────────────────────
// Read-only by default. Pass onSelect to make it clickable — used both in the
// wizard (before saving) and on a saved plan (persists immediately), so the
// AI's first guess at "how often does this fire" can always be corrected.

function FreqBadge({
  freq, onSelect,
}: { freq: string; onSelect?: (freq: FeatureSuggestion["frequency"]) => void }) {
  const [open, setOpen] = useState(false);

  if (!onSelect) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-400 border border-gray-100 px-2 py-0.5 rounded-full">
        <Clock size={9} /> {freq}
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs text-gray-400 border border-gray-100 px-2 py-0.5 rounded-full hover:border-indigo-200 hover:text-indigo-500 transition-colors"
        title="Click to change how often this is tracked"
      >
        <Clock size={9} /> {freq} <ChevronDown size={9} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden w-28">
            {(["daily", "weekly", "monthly"] as const).map((f) => (
              <button
                key={f}
                onClick={() => { onSelect(f); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 transition-colors ${f === freq ? "text-indigo-600 font-semibold" : "text-gray-600"}`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Editable event name with autocomplete ────────────────────────────────────

function EventNameEditor({
  value,
  existingEvents,
  onChange,
  addLabel = "+ add event name",
}: {
  value: string | null;
  existingEvents: string[];
  onChange: (name: string | null) => void;
  addLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [showDropdown, setShowDropdown] = useState(false);

  const filtered = draft.trim()
    ? existingEvents.filter((e) => e.toLowerCase().includes(draft.toLowerCase()))
    : existingEvents.slice(0, 8);

  function commit(val: string) {
    const trimmed = val.trim();
    onChange(trimmed || null);
    setDraft(trimmed);
    setEditing(false);
    setShowDropdown(false);
  }

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(value ?? ""); setEditing(true); setShowDropdown(true); }}
        className="group flex items-center gap-1.5 mt-2"
        title="Click to edit event name"
      >
        <Zap size={10} className="text-indigo-400 flex-shrink-0" />
        {value ? (
          <>
            <code className="text-xs text-indigo-600 font-mono bg-indigo-50 px-1.5 py-0.5 rounded group-hover:bg-indigo-100 transition-colors">{value}</code>
            <span className="text-[10px] text-gray-300 group-hover:text-indigo-400 transition-colors">edit</span>
          </>
        ) : (
          <span className="text-xs text-gray-400 border border-dashed border-gray-200 px-2 py-0.5 rounded group-hover:border-indigo-300 group-hover:text-indigo-500 transition-colors">
            {addLabel}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="relative mt-2">
      <div className="flex items-center gap-1.5">
        <Zap size={10} className="text-indigo-400 flex-shrink-0" />
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setShowDropdown(true); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(draft);
            if (e.key === "Escape") { setEditing(false); setShowDropdown(false); }
          }}
          onBlur={() => setTimeout(() => commit(draft), 150)}
          placeholder="e.g. insurance_link_clicked"
          className="text-xs font-mono text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400 w-56"
        />
      </div>
      {showDropdown && filtered.length > 0 && (
        <div className="absolute left-5 top-8 z-20 w-64 bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden">
          <p className="text-[10px] text-gray-400 px-3 pt-2 pb-1 font-semibold uppercase tracking-wider">Your events</p>
          <div className="max-h-48 overflow-y-auto">
            {filtered.map((e) => (
              <button
                key={e}
                onMouseDown={() => commit(e)}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left hover:bg-indigo-50 transition-colors"
              >
                <Zap size={10} className="text-indigo-400 flex-shrink-0" />
                <code className="text-indigo-600 font-mono">{e}</code>
              </button>
            ))}
          </div>
          {draft.trim() && !existingEvents.includes(draft.trim()) && (
            <button
              onMouseDown={() => commit(draft)}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left hover:bg-gray-50 border-t border-gray-100 transition-colors"
            >
              <Plus size={10} className="text-gray-400" />
              <span className="text-gray-500">Use "<code className="text-indigo-600">{draft}</code>" as new event</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Single suggestion card ───────────────────────────────────────────────────

function SuggestionCard({
  s,
  index,
  existingEvents,
  onChange,
  onDelete,
}: {
  s: FeatureSuggestion;
  index: number;
  existingEvents: string[];
  onChange: (updated: FeatureSuggestion) => void;
  onDelete?: () => void;
}) {
  const accent = s.type === "kpi" ? "#6366f1" : s.type === "guardrail" ? "#D97706" : "#3B82F6";
  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
      <div className="h-1" style={{ background: accent }} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-gray-400">#{index + 1}</span>
            <TypeBadge type={s.type} />
            <FreqBadge freq={s.frequency} onSelect={(f) => onChange({ ...s, frequency: f })} />
          </div>
          {onDelete && (
            <button
              onClick={onDelete}
              title="Remove this metric"
              className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <h3 className="font-bold text-gray-900 text-sm mb-1">{s.name}</h3>
        <p className="text-xs text-gray-500 leading-relaxed mb-4">{s.description}</p>

        <div className="space-y-3">
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">How to track</p>
            <p className="text-xs text-gray-700 leading-relaxed">{s.how_to_track}</p>
            <EventNameEditor
              value={s.event_name}
              existingEvents={existingEvents}
              onChange={(name) => onChange({ ...s, event_name: name })}
            />
            {/* Some metrics/guardrails are inherently a ratio (e.g.
                abandonment rate), not a standalone count — this second slot
                is what that count is measured against. Saving the plan
                turns this into a real computed ratio, same engine as a
                goal-level KPI's property panel. */}
            <div className="mt-2 pt-2 border-t border-gray-100">
              <p className="text-[10px] text-gray-400 mb-0.5">
                Out of / compared against <span className="text-gray-300">(optional — only if this is a ratio, not a standalone count)</span>
              </p>
              <EventNameEditor
                value={s.compared_event_name}
                existingEvents={existingEvents}
                onChange={(name) => onChange({ ...s, compared_event_name: name })}
                addLabel="+ compare against another event"
              />
            </div>
          </div>

          {s.target && (
            <div className="flex items-start gap-2 border border-green-100 bg-green-50 rounded-xl p-3">
              <CheckCircle2 size={13} className="text-green-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Target</p>
                <p className="text-xs text-gray-700 font-medium">{s.target}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Launch status badge ──────────────────────────────────────────────────────

type EffectiveStatus = FeatureLaunchStatus | "scheduled";

// Full lifecycle: Ideation → Design → Dev → UAT → Ready → Deployed → Launched → Post-launch
// Exception states: Rolled back, Paused
// Legacy DB values kept for backwards compat: not_launched, delayed, cancelled
const STATUS_MAP: Record<string, { label: string; cls: string; icon: React.ComponentType<{ size: number }> }> = {
  ideation:         { label: "Ideation",         cls: "bg-purple-50 text-purple-600 border-purple-200",  icon: Lightbulb },
  design:           { label: "Design",            cls: "bg-blue-50 text-blue-600 border-blue-200",        icon: Zap },
  dev:              { label: "Dev",               cls: "bg-yellow-50 text-yellow-700 border-yellow-200",  icon: Zap },
  uat:              { label: "UAT",               cls: "bg-orange-50 text-orange-600 border-orange-200",  icon: CheckCircle2 },
  ready_for_launch: { label: "Ready to launch",  cls: "bg-teal-50 text-teal-700 border-teal-200",        icon: Rocket },
  deployed:         { label: "Deployed",          cls: "bg-indigo-50 text-indigo-700 border-indigo-200",  icon: Rocket },
  launched:         { label: "Launched ✓",        cls: "bg-green-100 text-green-700 border-green-200",    icon: Rocket },
  post_launch:      { label: "Post-launch",       cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: TrendingUp },
  rolled_back:      { label: "Rolled back",       cls: "bg-red-100 text-red-600 border-red-200",          icon: XCircle },
  paused:           { label: "Paused",            cls: "bg-amber-100 text-amber-700 border-amber-200",    icon: RotateCcw },
  // legacy
  not_launched:     { label: "Not launched",      cls: "bg-gray-100 text-gray-500 border-gray-200",       icon: Clock },
  delayed:          { label: "Delayed",           cls: "bg-amber-100 text-amber-700 border-amber-200",    icon: RotateCcw },
  cancelled:        { label: "Cancelled",         cls: "bg-red-100 text-red-600 border-red-200",          icon: XCircle },
  scheduled:        { label: "Scheduled",         cls: "bg-blue-100 text-blue-700 border-blue-200",       icon: Calendar },
};

// Ordered lifecycle pipeline (for the status picker)
const STATUS_PIPELINE: { value: FeatureLaunchStatus; label: string }[] = [
  { value: "ideation",         label: "Ideation" },
  { value: "design",           label: "Design" },
  { value: "dev",              label: "Dev" },
  { value: "uat",              label: "UAT" },
  { value: "ready_for_launch", label: "Ready to launch" },
  { value: "deployed",         label: "Deployed" },
  { value: "launched",         label: "Launched" },
  { value: "post_launch",      label: "Post-launch" },
  { value: "rolled_back",      label: "Rolled back" },
  { value: "paused",           label: "Paused" },
];

function LaunchStatusBadge({ status, scheduledDate }: { status: EffectiveStatus; scheduledDate?: string }) {
  const entry = STATUS_MAP[status] ?? STATUS_MAP.not_launched;
  const label = status === "scheduled" && scheduledDate ? `Scheduled ${scheduledDate}` : entry.label;
  const Icon = entry.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${entry.cls}`}>
      <Icon size={9} /> {label}
    </span>
  );
}

// Inline status picker — replaces the old confirm/delay buttons
function StatusPicker({ current, onSelect, saving }: {
  current: EffectiveStatus;
  onSelect: (s: FeatureLaunchStatus) => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={saving}
        className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 border border-indigo-200 hover:border-indigo-400 bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
      >
        {saving ? <Loader2 size={11} className="animate-spin" /> : null}
        Change status <ChevronDown size={11} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-100 rounded-xl shadow-xl overflow-hidden w-44">
            {STATUS_PIPELINE.map(opt => {
              const entry = STATUS_MAP[opt.value];
              const Icon = entry.icon;
              const isCurrent = opt.value === current;
              return (
                <button
                  key={opt.value}
                  onClick={() => { onSelect(opt.value); setOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
                    isCurrent ? "bg-indigo-50 text-indigo-700 font-semibold" : "hover:bg-gray-50 text-gray-700"
                  }`}
                >
                  <Icon size={11} className={isCurrent ? "text-indigo-500" : "text-gray-400"} />
                  {opt.label}
                  {isCurrent && <CheckCircle2 size={10} className="ml-auto text-indigo-500 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Goal window alignment check ─────────────────────────────────────────────

function goalWindowCheck(
  plannedDate: string | null,
  goal: BusinessGoal | undefined
): "inside" | "outside" | "no_window" | "no_date" {
  if (!plannedDate) return "no_date";
  if (!goal?.start_date || !goal?.end_date) return "no_window";
  const d = plannedDate;
  if (d >= goal.start_date && d <= goal.end_date) return "inside";
  return "outside";
}

// ─── Saved plan card ──────────────────────────────────────────────────────────

function SavedPlanCard({
  plan,
  onArchive,
  onUpdated,
  goals,
  orgId,
  onSetupWithAI,
}: {
  plan: FeatureMetric;
  onArchive: (id: string) => void;
  onUpdated: () => void;
  goals: BusinessGoal[];
  orgId: string;
  onSetupWithAI?: (id: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingDate, setEditingDate] = useState(false);
  const [dateInput, setDateInput] = useState(plan.planned_launch_date ?? "");
  const [saving, setSaving] = useState(false);

  // PM Slack handle
  const [editingPm, setEditingPm] = useState(false);
  const [pmHandle, setPmHandle] = useState(plan.pm_slack_handle ?? "");

  // Add metric inline form
  const [addingMetric, setAddingMetric] = useState(false);
  const [newMetricType, setNewMetricType] = useState<FeatureSuggestion["type"]>("metric");
  const [newMetricName, setNewMetricName] = useState("");
  const [newMetricDesc, setNewMetricDesc] = useState("");
  const [newMetricTarget, setNewMetricTarget] = useState("");
  const [savingMetric, setSavingMetric] = useState(false);

  function timeAgo(iso: string) {
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return d === 0 ? "today" : d === 1 ? "yesterday" : `${d}d ago`;
  }

  const linkedGoal = goals.find((g) => g.id === plan.business_goal_id);
  const today = new Date().toISOString().slice(0, 10);

  // Derive display status — "scheduled" is a UI-only overlay for a future date on a pre-launch status
  const prelaunchStatuses: FeatureLaunchStatus[] = ["ideation", "design", "dev", "uat", "ready_for_launch", "not_launched"];
  const effectiveStatus = ((): EffectiveStatus => {
    const s = plan.launch_status as FeatureLaunchStatus;
    if (!prelaunchStatuses.includes(s)) return s; // already an explicit status — show it
    if (!plan.planned_launch_date) return s;
    if (plan.planned_launch_date <= today) return "launched"; // date arrived, auto-flip
    return "scheduled"; // future date set on a pre-launch item
  })();

  // Auto-confirm in DB when a pre-launch feature's planned date arrives
  useEffect(() => {
    const s = plan.launch_status as FeatureLaunchStatus;
    if (
      prelaunchStatuses.includes(s) &&
      plan.planned_launch_date &&
      plan.planned_launch_date <= today
    ) {
      confirmFeatureLaunch(plan.id).then(() => onUpdated());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLaunched = effectiveStatus === "launched" || effectiveStatus === "post_launch" || effectiveStatus === "deployed";
  const isOverdue  = !isLaunched && effectiveStatus !== "scheduled" && plan.planned_launch_date && plan.planned_launch_date < today;
  const isToday    = prelaunchStatuses.includes(plan.launch_status as FeatureLaunchStatus) && plan.planned_launch_date === today;
  const windowCheck = goalWindowCheck(plan.planned_launch_date, linkedGoal);

  async function handleSaveDate() {
    setSaving(true);
    await updateFeatureLaunchDate(plan.id, dateInput || null);
    setSaving(false);
    setEditingDate(false);
    onUpdated();
  }

  async function handleConfirmLaunch() {
    setSaving(true);
    await confirmFeatureLaunch(plan.id);
    setSaving(false);
    onUpdated();
  }

  async function handleStatusChange(newStatus: FeatureLaunchStatus) {
    await handleStatusChangeWithSlack(newStatus);
  }

  async function handleFrequencyChange(index: number, frequency: FeatureSuggestion["frequency"]) {
    await updateFeatureSuggestionFrequency(plan.id, index, frequency);
    onUpdated();
  }

  async function handlePmSave() {
    await updateFeaturePmSlackHandle(plan.id, pmHandle.trim() || null);
    setEditingPm(false);
    onUpdated();
  }

  async function handleDeleteSuggestion(index: number) {
    await deleteFeatureSuggestion(plan.id, index);
    onUpdated();
  }

  async function handleAddMetric() {
    if (!newMetricName.trim()) return;
    setSavingMetric(true);
    const suggestion: FeatureSuggestion = {
      type: newMetricType,
      name: newMetricName.trim(),
      description: newMetricDesc.trim(),
      how_to_track: "Track manually or via a Mixpanel event",
      target: newMetricTarget.trim() || null,
      event_name: null,
      compared_event_name: null,
      frequency: "weekly",
    };
    await addFeatureSuggestion(plan.id, suggestion);
    setSavingMetric(false);
    setAddingMetric(false);
    setNewMetricName("");
    setNewMetricDesc("");
    setNewMetricTarget("");
    setNewMetricType("metric");
    onUpdated();
  }

  async function handleStatusChangeWithSlack(newStatus: FeatureLaunchStatus) {
    setSaving(true);
    if (newStatus === "launched") {
      await confirmFeatureLaunch(plan.id);
    } else {
      await updateFeatureLaunchStatus(plan.id, newStatus);
    }
    // Fire-and-forget Slack notification
    notifySlackFeatureStatusChange(orgId, plan.feature_name, newStatus, plan.pm_slack_handle ?? null);
    setSaving(false);
    onUpdated();
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
      {/* Overdue / today alert banner */}
      {(isOverdue || isToday) && (
        <div className={`flex items-center justify-between px-5 py-2.5 ${isToday ? "bg-indigo-50 border-b border-indigo-100" : "bg-amber-50 border-b border-amber-100"}`}>
          <div className="flex items-center gap-2">
            {isToday
              ? <Rocket size={13} className="text-indigo-500" />
              : <AlertTriangle size={13} className="text-amber-500" />}
            <p className={`text-xs font-medium ${isToday ? "text-indigo-700" : "text-amber-700"}`}>
              {isToday
                ? `🚀 ${plan.feature_name} is scheduled to launch today`
                : `⚠️ ${plan.feature_name} was due ${plan.planned_launch_date} — confirm or reschedule`}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={handleConfirmLaunch} disabled={saving}
              className="text-[11px] font-semibold bg-green-600 text-white px-2.5 py-1 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
              ✓ Confirm launch
            </button>
            <StatusPicker current={effectiveStatus} onSelect={handleStatusChange} saving={saving} />
          </div>
        </div>
      )}

      {/* Goal window mismatch warning */}
      {windowCheck === "outside" && (
        <div className="flex items-center gap-2 px-5 py-2 bg-red-50 border-b border-red-100">
          <AlertTriangle size={12} className="text-red-500 flex-shrink-0" />
          <p className="text-xs text-red-600">
            Planned launch <strong>{plan.planned_launch_date}</strong> is outside the goal window for
            &ldquo;{linkedGoal?.title}&rdquo; ({linkedGoal?.start_date} → {linkedGoal?.end_date}).
            This feature may not count toward the goal.
          </p>
        </div>
      )}

      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
            <Lightbulb size={14} className="text-indigo-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-800 truncate">{plan.feature_name}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs text-gray-400">{plan.sector}</span>
              <span className="text-xs text-gray-300">·</span>
              <span className="text-xs text-gray-400">{timeAgo(plan.created_at)}</span>
              {plan.planned_launch_date && (
                <>
                  <span className="text-xs text-gray-300">·</span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                    <Calendar size={9} /> {plan.planned_launch_date}
                  </span>
                </>
              )}
              {linkedGoal && (
                <>
                  <span className="text-xs text-gray-300">·</span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-full">
                    <Link2 size={9} /> {linkedGoal.title}
                  </span>
                </>
              )}
              <>
                <span className="text-xs text-gray-300">·</span>
                <span className="inline-flex items-center gap-1 text-[11px]">
                  <User size={9} className="text-gray-400" />
                  {plan.pm_slack_handle
                    ? <span className="text-indigo-600 font-medium">{plan.pm_slack_handle}</span>
                    : <span className="text-gray-400 italic">No PM set</span>}
                </span>
              </>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          <LaunchStatusBadge status={effectiveStatus} scheduledDate={effectiveStatus === "scheduled" ? plan.planned_launch_date ?? undefined : undefined} />
          <div className="hidden sm:flex items-center gap-1">
            {(plan.suggestions as FeatureSuggestion[]).map((s, i) => (
              <TypeBadge key={i} type={s.type} />
            ))}
          </div>
          {expanded ? <ChevronLeft size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        </div>
      </button>

      {/* No-metrics CTA — shown for blank imported features */}
      {(plan.suggestions as FeatureSuggestion[]).length === 0 && onSetupWithAI && (
        <div className="border-t border-indigo-50 px-5 py-4 bg-indigo-50/40 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <Sparkles size={13} className="text-indigo-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">No metrics set up yet</p>
              <p className="text-xs text-gray-400">Let AI analyse this feature and suggest what to track</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => onArchive(plan.id)}
              title="Delete this feature"
              className="p-1.5 rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors"
            >
              <Trash2 size={13} />
            </button>
            <button
              onClick={() => onSetupWithAI(plan.id, plan.feature_name)}
              className="flex items-center gap-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl transition-colors"
            >
              Set up with AI <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {expanded && (plan.suggestions as FeatureSuggestion[]).length > 0 && (
        <div className="border-t border-gray-100 px-5 pb-5 pt-4 space-y-4">
          {plan.goal_alignment && (
            <div className="flex items-start gap-2 bg-indigo-50 border border-indigo-100 rounded-xl p-3">
              <Link2 size={12} className="text-indigo-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-indigo-700 leading-relaxed">{plan.goal_alignment}</p>
            </div>
          )}

          {/* Launch date section */}
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
                <Calendar size={12} className="text-indigo-400" /> Launch date
              </p>
              <LaunchStatusBadge status={effectiveStatus} scheduledDate={effectiveStatus === "scheduled" ? plan.planned_launch_date ?? undefined : undefined} />
            </div>

            {isLaunched ? (
              <div className="flex items-center justify-between">
                <p className="text-sm text-green-700 font-medium">
                  🚀 {effectiveStatus === "post_launch" ? "Post-launch" : "Launched"} on {plan.actual_launch_date ?? plan.planned_launch_date ?? "—"}
                </p>
                <StatusPicker current={effectiveStatus} onSelect={handleStatusChange} saving={saving} />
              </div>
            ) : editingDate ? (
              <div className="flex items-center gap-2">
                <input type="date" value={dateInput} onChange={e => setDateInput(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white" />
                <button onClick={handleSaveDate} disabled={saving}
                  className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium">
                  {saving ? "Saving…" : "Save"}
                </button>
                <button onClick={() => { setEditingDate(false); setDateInput(plan.planned_launch_date ?? ""); }}
                  className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5">
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">
                  {plan.planned_launch_date
                    ? <>Planned: <strong>{plan.planned_launch_date}</strong>
                        {plan.planned_launch_date < today && plan.launch_status !== "launched" && (
                          <span className="ml-2 text-amber-600 font-medium text-xs">(overdue)</span>
                        )}
                      </>
                    : <span className="text-gray-400 italic text-xs">No date set</span>}
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setEditingDate(true)}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 rounded hover:bg-indigo-50 transition-colors">
                    {plan.planned_launch_date ? "Reschedule" : "Set date"}
                  </button>
                  <StatusPicker current={effectiveStatus} onSelect={handleStatusChange} saving={saving} />
                </div>
              </div>
            )}

            {windowCheck === "inside" && (
              <p className="text-[11px] text-green-600 flex items-center gap-1">
                <CheckCircle2 size={10} /> Within goal window ({linkedGoal?.start_date} → {linkedGoal?.end_date})
              </p>
            )}
          </div>

          {plan.success_definition && (
            <div className="text-xs text-gray-500">
              <span className="font-semibold text-gray-600">Success: </span>{plan.success_definition}
            </div>
          )}
          {/* PM Slack handle */}
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <User size={10} /> Owner / PM Slack handle
            </p>
            {editingPm ? (
              <div className="flex items-center gap-2">
                <input
                  value={pmHandle}
                  onChange={e => setPmHandle(e.target.value)}
                  placeholder="e.g. @jane or jane.smith"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
                  autoFocus
                  onKeyDown={e => { if (e.key === "Enter") handlePmSave(); if (e.key === "Escape") { setEditingPm(false); setPmHandle(plan.pm_slack_handle ?? ""); }}}
                />
                <button onClick={handlePmSave} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 font-medium transition-colors">Save</button>
                <button onClick={() => { setEditingPm(false); setPmHandle(plan.pm_slack_handle ?? ""); }} className="text-xs text-gray-400 hover:text-gray-600 px-2">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setEditingPm(true)}
                className="flex items-center gap-2 w-full text-left group"
              >
                {plan.pm_slack_handle
                  ? <span className="text-sm font-semibold text-indigo-600">{plan.pm_slack_handle}</span>
                  : <span className="text-sm text-gray-400 italic">+ Add Slack handle to receive notifications</span>}
                <span className="text-[10px] text-gray-300 group-hover:text-indigo-400 transition-colors ml-auto">Edit</span>
              </button>
            )}
          </div>

          {/* Status history trail */}
          {(() => {
            const log = (plan.status_log ?? []) as { status: string; timestamp: string }[];
            if (log.length === 0) return null;
            const reversed = [...log].reverse();
            return (
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Status history</p>
                <ol className="space-y-2">
                  {reversed.map((entry, i) => {
                    const d = new Date(entry.timestamp);
                    const label = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
                    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
                    const isLatest = i === 0;
                    return (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${isLatest ? "bg-indigo-500" : "bg-gray-300"}`} />
                        <span className={`text-xs ${isLatest ? "text-gray-800 font-semibold" : "text-gray-500"}`}>
                          {entry.status.replace(/_/g, " ")}
                          <span className="ml-2 font-normal text-gray-400">{label} · {time}</span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })()}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(plan.suggestions as FeatureSuggestion[]).map((s, i) => (
              <SuggestionCard
                key={i} s={s} index={i} existingEvents={[]}
                onChange={(updated) => {
                  if (updated.frequency !== s.frequency) handleFrequencyChange(i, updated.frequency);
                }}
                onDelete={() => handleDeleteSuggestion(i)}
              />
            ))}
          </div>

          {/* Add metric form */}
          {addingMetric ? (
            <div className="border border-gray-100 rounded-xl p-4 space-y-3 bg-gray-50">
              <p className="text-xs font-semibold text-gray-600">Add a metric manually</p>
              <div className="flex gap-2">
                {(["metric", "kpi", "guardrail"] as FeatureSuggestion["type"][]).map(t => (
                  <button
                    key={t}
                    onClick={() => setNewMetricType(t)}
                    className={`px-3 py-1 text-xs rounded-full border font-medium transition-colors ${newMetricType === t ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"}`}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              <input
                value={newMetricName}
                onChange={e => setNewMetricName(e.target.value)}
                placeholder="Metric name *"
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
              />
              <input
                value={newMetricDesc}
                onChange={e => setNewMetricDesc(e.target.value)}
                placeholder="Description (optional)"
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
              />
              <input
                value={newMetricTarget}
                onChange={e => setNewMetricTarget(e.target.value)}
                placeholder="Target (optional, e.g. > 30%)"
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAddMetric}
                  disabled={!newMetricName.trim() || savingMetric}
                  className="flex items-center gap-1.5 text-xs bg-indigo-600 text-white px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium transition-colors"
                >
                  {savingMetric ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                  Add metric
                </button>
                <button onClick={() => setAddingMetric(false)} className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1.5">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingMetric(true)}
              className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 border border-dashed border-indigo-200 hover:border-indigo-400 rounded-xl px-4 py-2.5 transition-colors w-full justify-center"
            >
              <Plus size={12} /> Add metric manually
            </button>
          )}

          <div className="flex justify-end">
            <button
              onClick={() => onArchive(plan.id)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-500 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-50"
            >
              <Trash2 size={11} /> Archive
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Goal selector step ───────────────────────────────────────────────────────

function GoalSelector({
  goals,
  selected,
  onSelect,
  onSkip,
  onNext,
}: {
  goals: BusinessGoal[];
  selected: BusinessGoal | null;
  onSelect: (g: BusinessGoal | null) => void;
  onSkip: () => void;
  onNext: () => void;
}) {
  if (goals.length === 0) {
    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center py-8 text-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
            <Trophy size={18} className="text-gray-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">No goals set yet</p>
            <p className="text-xs text-gray-400 max-w-xs">
              Add a goal on the Goals page first, and this feature plan will automatically align to one.
            </p>
          </div>
          <a
            href="/goals"
            className="text-xs text-indigo-600 hover:underline font-medium"
          >
            Go to Goals →
          </a>
        </div>
        <div className="flex justify-end">
          <button
            onClick={onSkip}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
          >
            Continue anyway <ArrowRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-bold text-gray-800 mb-1">Which business goal does this feature serve?</p>
        <p className="text-xs text-gray-400">Linking a goal makes AI tracking suggestions more relevant and aligned to what matters.</p>
      </div>

      <div className="space-y-2">
        {goals.filter((g) => g.status === "active").map((g) => {
          const colourCls = GOAL_TYPE_COLOUR[g.type] ?? "bg-gray-100 text-gray-700 border-gray-200";
          const isSelected = selected?.id === g.id;
          return (
            <button
              key={g.id}
              onClick={() => onSelect(isSelected ? null : g)}
              className={`w-full flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                isSelected
                  ? "border-indigo-400 bg-indigo-50"
                  : "border-gray-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/30"
              }`}
            >
              <div className={`mt-0.5 flex-shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${colourCls}`}>
                {g.type}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-800">{g.title}</p>
                {(g.target || g.timeframe) && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {[g.target, g.timeframe].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              {isSelected && <CheckCircle2 size={16} className="text-indigo-500 flex-shrink-0 mt-0.5" />}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-1">
        <button
          onClick={onSkip}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Skip — no goal
        </button>
        <button
          onClick={onNext}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
        >
          {selected ? "Continue with goal" : "Continue"} <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── KPI selector step ────────────────────────────────────────────────────────
// Shown only when a goal is picked. A KPI belongs to the goal, not to
// whichever feature gets built first — if the goal already has one defined,
// this feature should target it instead of inventing a private duplicate.

function KpiSelector({
  goalTitle,
  kpis,
  selected,
  onSelect,
  onSkip,
  onNext,
}: {
  goalTitle: string;
  kpis: MetricWithData[];
  selected: MetricWithData | null;
  onSelect: (k: MetricWithData | null) => void;
  onSkip: () => void;
  onNext: () => void;
}) {
  if (kpis.length === 0) {
    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center py-8 text-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
            <TrendingUp size={18} className="text-gray-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">No KPI defined for &quot;{goalTitle}&quot; yet</p>
            <p className="text-xs text-gray-400 max-w-xs">
              AI will propose one based on this feature. Confirming it creates a KPI on the goal that future features can target too, instead of each one getting its own.
            </p>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            onClick={onNext}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
          >
            Continue <ArrowRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-bold text-gray-800 mb-1">Which KPI is this feature meant to move?</p>
        <p className="text-xs text-gray-400">&quot;{goalTitle}&quot; already has KPI(s) — pick the one this feature targets instead of creating a new one.</p>
      </div>

      <div className="space-y-2">
        {kpis.map((k) => {
          const isSelected = selected?.id === k.id;
          return (
            <button
              key={k.id}
              onClick={() => onSelect(isSelected ? null : k)}
              className={`w-full flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                isSelected
                  ? "border-indigo-400 bg-indigo-50"
                  : "border-gray-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/30"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-800">{k.name}</p>
                {k.target && <p className="text-xs text-gray-400 mt-0.5">Target: {k.target}</p>}
              </div>
              {isSelected && <CheckCircle2 size={16} className="text-indigo-500 flex-shrink-0 mt-0.5" />}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-1">
        <button onClick={onSkip} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
          None of these — let AI propose a new one
        </button>
        <button
          onClick={onNext}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
        >
          {selected ? "Continue with this KPI" : "Continue"} <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

const EMPTY_INPUT: FeatureInput = {
  feature_name: "", feature_description: "", sector: "", target_users: "",
  success_definition: "", failure_definition: "", interaction_frequency: "", launch_timeline: "",
  pm_slack_handle: "",
};

type WizardStage = "goal" | "kpi" | "questions" | "generating" | "results";

function Wizard({ goals, kpisByGoal, onSaved, existingEventNames, footerEl, initialFeatureName }: { goals: BusinessGoal[]; kpisByGoal: Record<string, MetricWithData[]>; onSaved: () => void; existingEventNames: string[]; footerEl: HTMLElement | null; initialFeatureName?: string }) {
  const { currentOrg } = useOrg();
  const [stage, setStage] = useState<WizardStage>("goal");
  // If opened from an imported feature, start at step 1 (skip name question)
  const [step, setStep] = useState(initialFeatureName ? 1 : 0);
  const [input, setInput] = useState<FeatureInput>(
    initialFeatureName ? { ...EMPTY_INPUT, feature_name: initialFeatureName } : EMPTY_INPUT
  );
  const [selectedGoal, setSelectedGoal] = useState<BusinessGoal | null>(null);
  const [selectedKpi, setSelectedKpi] = useState<MetricWithData | null>(null);
  const [suggestions, setSuggestions] = useState<FeatureSuggestion[] | null>(null);
  const [goalAlignment, setGoalAlignment] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = QUESTIONS[step];
  const isLast = step === QUESTIONS.length - 1;
  const currentValue = input[current?.key] ?? "";
  // pm_slack_handle is optional — always allow advancing on that step
  const canNext = current?.key === "pm_slack_handle" || currentValue.toString().trim().length > 0;
  const goalKpis = selectedGoal ? (kpisByGoal[selectedGoal.id] ?? []) : [];

  async function handleGenerate() {
    setStage("generating");
    setError(null);
    const res = await generateFeatureSuggestions(
      input,
      selectedGoal ?? undefined,
      existingEventNames,
      selectedKpi ? { name: selectedKpi.name, target: selectedKpi.target, event_name: selectedKpi.event_name } : null
    );
    if (res.error) {
      setError(res.error);
      setStage("questions");
      return;
    }
    setSuggestions(res.suggestions!);
    setGoalAlignment(res.goalAlignment ?? null);
    setStage("results");
  }

  async function handleSave() {
    if (!currentOrg || !suggestions) return;
    setSaving(true);
    const res = await saveFeatureMetric(
      currentOrg.id,
      input,
      suggestions,
      {
        businessGoalId: selectedGoal?.id,
        goalAlignment: goalAlignment ?? undefined,
        targetKpiId: selectedKpi?.id,
      }
    );
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved();
    // Reset
    setStage("goal");
    setStep(0);
    setInput(EMPTY_INPUT);
    setSuggestions(null);
    setSelectedGoal(null);
    setSelectedKpi(null);
    setGoalAlignment(null);
  }

  // ── Generating ──────────────────────────────────────────────────────────────
  if (stage === "generating") {
    return (
      <div className="flex flex-col items-center py-16 gap-4">
        <div className="w-12 h-12 rounded-2xl bg-indigo-100 flex items-center justify-center">
          <Loader2 size={22} className="text-indigo-600 animate-spin" />
        </div>
        <p className="text-sm font-semibold text-gray-700">Analysing your feature…</p>
        <p className="text-xs text-gray-400 text-center max-w-xs">
          AI is deciding the right mix of metrics, KPIs, and guardrails based on what this feature actually needs
          {selectedGoal && ` — aligned to "${selectedGoal.title}"`}
        </p>
      </div>
    );
  }

  // ── Results ─────────────────────────────────────────────────────────────────
  if (stage === "results" && suggestions) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-green-100 flex items-center justify-center">
            <Sparkles size={15} className="text-green-600" />
          </div>
          <div>
            <p className="font-bold text-gray-900 text-sm">
              {suggestions.length} tracking items for &quot;{input.feature_name}&quot;
            </p>
            <p className="text-xs text-gray-400">Review, then save to your platform</p>
          </div>
        </div>

        {/* Goal alignment pill */}
        {selectedGoal && goalAlignment && (
          <div className="flex items-start gap-2 bg-indigo-50 border border-indigo-100 rounded-xl p-3">
            <Link2 size={12} className="text-indigo-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider mb-0.5">
                Aligned to: {selectedGoal.title}
              </p>
              <p className="text-xs text-indigo-700 leading-relaxed">{goalAlignment}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {suggestions.map((s, i) => (
            <SuggestionCard
              key={i}
              s={s}
              index={i}
              existingEvents={existingEventNames}
              onChange={(updated) =>
                setSuggestions((prev) => prev ? prev.map((x, j) => j === i ? updated : x) : prev)
              }
            />
          ))}
        </div>

        {/* Tracking tool guidance */}
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5">
          <p className="text-xs font-bold text-indigo-800 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <ExternalLink size={11} /> How to track these in your existing tools
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-indigo-700">
            {[
              { tool: "Mixpanel", tip: `Fire the suggested event names above. Create a ${input.sector?.toLowerCase()} report filtering on these events to monitor adoption and frequency.` },
              { tool: "Amplitude", tip: "Use the event names to build a Chart. Set up a Compass signal so you get alerted when targets are hit or missed." },
              { tool: "Google Analytics 4", tip: "Log as custom events using the suggested event names. Use Explorations to build a funnel or segment report." },
              { tool: "This platform (Metrik)", tip: "Events you fire from your app appear in the Events tab. The trackable items above have been automatically added and show up under Goals." },
            ].map(({ tool, tip }) => (
              <div key={tool} className="bg-white/60 rounded-xl p-3">
                <p className="font-bold text-indigo-900 mb-1">{tool}</p>
                <p className="leading-relaxed text-indigo-700">{tip}</p>
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        {/* Footer rendered via portal into the drawer's flex-shrink-0 footer slot */}
        {footerEl && createPortal(
          <div className="border-t border-gray-100 px-7 py-4 bg-white flex items-center justify-between flex-shrink-0">
            <button onClick={() => setStage("questions")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              ← Regenerate
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-6 py-2.5 rounded-xl shadow-sm transition-colors disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Save to platform
            </button>
          </div>,
          footerEl
        )}
      </div>
    );
  }

  // ── Goal selection stage ────────────────────────────────────────────────────
  if (stage === "goal") {
    return (
      <GoalSelector
        goals={goals}
        selected={selectedGoal}
        onSelect={setSelectedGoal}
        onSkip={() => { setSelectedGoal(null); setStage("questions"); }}
        onNext={() => setStage(selectedGoal ? "kpi" : "questions")}
      />
    );
  }

  // ── KPI selection stage — only when a goal is picked ────────────────────────
  if (stage === "kpi" && selectedGoal) {
    return (
      <KpiSelector
        goalTitle={selectedGoal.title}
        kpis={goalKpis}
        selected={selectedKpi}
        onSelect={setSelectedKpi}
        onSkip={() => { setSelectedKpi(null); setStage("questions"); }}
        onNext={() => setStage("questions")}
      />
    );
  }

  // ── Questions ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="space-y-1">
        {selectedGoal && (
          <div className="flex items-center gap-1.5 mb-1">
            <Link2 size={10} className="text-indigo-400" />
            <span className="text-[11px] text-indigo-500 font-medium truncate">
              Aligned to: {selectedGoal.title}
            </span>
            <button onClick={() => { setSelectedKpi(null); setStage("goal"); }} className="text-[11px] text-gray-400 hover:text-gray-600 ml-1">change</button>
          </div>
        )}
        {selectedGoal && (
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp size={10} className="text-indigo-400" />
            <span className="text-[11px] text-indigo-500 font-medium truncate">
              {selectedKpi ? `Targets KPI: ${selectedKpi.name}` : "No existing KPI selected — AI will propose one"}
            </span>
            <button onClick={() => setStage("kpi")} className="text-[11px] text-gray-400 hover:text-gray-600 ml-1">change</button>
          </div>
        )}
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {QUESTIONS.map((_, i) => (
              <div key={i} className={`h-1 rounded-full transition-all ${i <= step ? "bg-indigo-500 w-6" : "bg-gray-200 w-3"}`} />
            ))}
          </div>
          <span className="text-xs text-gray-400">{step + 1} / {QUESTIONS.length}</span>
        </div>
      </div>

      {/* Question */}
      <div>
        <label className="block text-sm font-bold text-gray-800 mb-3">{current.label}</label>
        {current.type === "select" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {current.options!.map(opt => (
              <button key={opt}
                onClick={() => setInput(p => ({ ...p, [current.key]: opt }))}
                className={`text-sm px-4 py-2.5 rounded-xl border transition-all text-left ${
                  input[current.key] === opt
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold"
                    : "border-gray-200 bg-white text-gray-600 hover:border-indigo-300 hover:bg-indigo-50/50"
                }`}>
                {opt}
              </button>
            ))}
          </div>
        ) : current.type === "textarea" ? (
          <textarea
            rows={3}
            autoFocus
            value={input[current.key] as string}
            onChange={e => setInput(p => ({ ...p, [current.key]: e.target.value }))}
            placeholder={current.placeholder}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
          />
        ) : (
          <input
            type="text"
            autoFocus
            value={input[current.key] as string}
            onChange={e => setInput(p => ({ ...p, [current.key]: e.target.value }))}
            placeholder={current.placeholder}
            onKeyDown={e => { if (e.key === "Enter" && canNext) isLast ? handleGenerate() : setStep(s => s + 1); }}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        )}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => step > 0 ? setStep(s => s - 1) : setStage("goal")}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ChevronLeft size={15} /> Back
        </button>
        <button
          onClick={() => isLast ? handleGenerate() : setStep(s => s + 1)}
          disabled={!canNext}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors disabled:opacity-40"
        >
          {isLast ? (
            <><Sparkles size={14} /> Generate tracking plan</>
          ) : (
            <>Next <ArrowRight size={14} /></>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function FeatureMetricsPage() {
  const { currentOrg } = useOrg();
  const [plans, setPlans] = useState<FeatureMetric[]>([]);
  const [goals, setGoals] = useState<BusinessGoal[]>([]);
  const [kpisByGoal, setKpisByGoal] = useState<Record<string, MetricWithData[]>>({});
  const [existingEventNames, setExistingEventNames] = useState<string[]>([]);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardVisible, setWizardVisible] = useState(false);
  const [drawerFooterEl, setDrawerFooterEl] = useState<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [importStage, setImportStage] = useState<"idle" | "parsing" | "selecting" | "importing" | "done">("idle");
  const [importPreview, setImportPreview] = useState<PreviewFeature[]>([]);
  const [importSelected, setImportSelected] = useState<Set<string>>(new Set());
  const [importResult, setImportResult] = useState<SheetImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  // Wizard pre-fill: when opened from an imported blank feature
  const [wizardInitialName, setWizardInitialName] = useState<string | undefined>(undefined);
  const [wizardReplaceId, setWizardReplaceId] = useState<string | null>(null);

  // Smooth slide-in / slide-out for the wizard drawer
  useEffect(() => {
    if (showWizard) {
      const t = setTimeout(() => setWizardVisible(true), 10);
      return () => clearTimeout(t);
    } else {
      setWizardVisible(false);
    }
  }, [showWizard]);

  function openWizard(initialName?: string, replaceId?: string) {
    setWizardInitialName(initialName);
    setWizardReplaceId(replaceId ?? null);
    setShowWizard(true);
  }
  function closeWizard() {
    setWizardVisible(false);
    setTimeout(() => {
      setShowWizard(false);
      setWizardInitialName(undefined);
      setWizardReplaceId(null);
    }, 300);
  }
  async function handleWizardSaved() {
    // If opened from a blank imported feature, archive the placeholder then reload
    if (wizardReplaceId) {
      await archiveFeatureMetric(wizardReplaceId);
    }
    closeWizard();
    await load();
  }

  const load = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true);

    // This used to await a Mixpanel event-names sync — a live network call —
    // before even starting to load the page's own data, on every single
    // visit. Despite the "don't block load" comment, the `await` in front of
    // it did exactly that: serialize a Mixpanel round-trip ahead of
    // everything else. Same anti-pattern the Events page had and already
    // dropped (see events/page.tsx) — event names synced via the Sources
    // page or Events page's own manual "Sync Event Names" button are already
    // sitting in the `events` table by the time getDistinctEventNames below
    // reads it, so this redundant auto-sync just added latency for no gain.
    const [data, goalData, eventNames, kpiData] = await Promise.all([
      getFeatureMetrics(currentOrg.id),
      getBusinessGoals(currentOrg.id),
      getDistinctEventNames(currentOrg.id),
      getKpisByGoal(currentOrg.id),
    ]);
    setPlans(data);
    setGoals(goalData);
    setExistingEventNames(eventNames);
    setKpisByGoal(kpiData);
    setLoading(false);
  }, [currentOrg]);

  useEffect(() => { load(); }, [load]);

  async function handleArchive(id: string) {
    await archiveFeatureMetric(id);
    setPlans(p => p.filter(x => x.id !== id));
  }

  async function handleSheetImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !currentOrg) return;
    e.target.value = "";
    setImportError(null);
    setImportStage("parsing");
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      const base64 = btoa(binary);
      const result = await previewSheetFeatures(currentOrg.id, base64, file.name);
      if (result.error) { setImportError(result.error); setImportStage("idle"); return; }
      const newOnes = result.features.filter(f => !f.exists).map(f => f.name);
      setImportPreview(result.features);
      setImportSelected(new Set(newOnes)); // pre-check new ones only
      setImportStage("selecting");
    } catch (err) {
      setImportError(String(err));
      setImportStage("idle");
    }
  }

  async function handleConfirmImport() {
    if (!currentOrg || importSelected.size === 0) return;
    setImportStage("importing");
    try {
      const selectedNames = importPreview
        .filter(f => importSelected.has(f.name))
        .map(f => f.name);
      const result = await importSelectedFeatures(currentOrg.id, selectedNames);
      setImportResult(result);
      setImportStage("done");
      if (result.added.length > 0) await load();
    } catch (err) {
      setImportResult({ added: [], skipped: [], error: String(err) });
      setImportStage("done");
    }
  }

  function resetImport() {
    setImportStage("idle");
    setImportPreview([]);
    setImportSelected(new Set());
    setImportResult(null);
    setImportError(null);
  }

  function handleCsvExport() {
    const rows: string[][] = [
      ["Feature", "Sector", "Status", "Planned Launch", "PM Slack", "Metric Type", "Metric Name", "Description", "Event", "Target"],
    ];
    for (const plan of plans) {
      const sugg = (plan.suggestions as FeatureSuggestion[]) ?? [];
      if (sugg.length === 0) {
        rows.push([plan.feature_name, plan.sector ?? "", plan.launch_status ?? "", plan.planned_launch_date ?? "", plan.pm_slack_handle ?? "", "", "", "", "", ""]);
      } else {
        for (const s of sugg) {
          rows.push([plan.feature_name, plan.sector ?? "", plan.launch_status ?? "", plan.planned_launch_date ?? "", plan.pm_slack_handle ?? "", s.type, s.name, s.description, s.event_name ?? "", s.target ?? ""]);
        }
      }
    }
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "metrik-features.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!currentOrg) return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Select an organisation first.</div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Lightbulb size={22} className="text-indigo-500" /> Feature Metrics
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Log a feature → align to a business goal → AI suggests the right things to track
          </p>
        </div>
        <div className="flex items-center gap-3">
          {goals.filter(g => g.status === "active").length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-full px-3 py-1.5">
              <Target size={11} className="text-indigo-400" />
              {goals.filter(g => g.status === "active").length} active goal{goals.filter(g => g.status === "active").length !== 1 ? "s" : ""}
            </div>
          )}
          {plans.length > 0 && (
            <button
              onClick={handleCsvExport}
              title="Download all features as CSV"
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-400 bg-white px-3 py-2 rounded-xl transition-colors"
            >
              <Download size={13} /> Export CSV
            </button>
          )}
          {/* Hidden file input for sheet import */}
          <input
            ref={importFileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleSheetImport}
          />
          <button
            onClick={() => importFileRef.current?.click()}
            disabled={importStage === "parsing" || importStage === "importing"}
            title="Import features from a spreadsheet"
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-400 bg-white px-3 py-2 rounded-xl transition-colors disabled:opacity-50"
          >
            {(importStage === "parsing" || importStage === "importing") ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {importStage === "parsing" ? "Reading…" : importStage === "importing" ? "Importing…" : "Import sheet"}
          </button>
          <button
            onClick={() => openWizard()}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
          >
            <Plus size={14} /> Log a feature
          </button>
        </div>
      </div>

      {/* How it works (shown when no plans yet) */}
      {!loading && plans.length === 0 && !showWizard && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          {[
            { step: "1", label: "Set business goals",    desc: "Log what your company is trying to achieve this year" },
            { step: "2", label: "Log your feature",      desc: "Name it and describe what it does in 8 quick questions" },
            { step: "3", label: "AI analyses context",   desc: "Picks the right mix — metric, KPI, or guardrail — aligned to your goal" },
            { step: "4", label: "Track with confidence", desc: "Auto-added to Business Goals and linked to your goal" },
          ].map(s => (
            <div key={s.step} className="bg-white border border-gray-100 rounded-2xl p-5 text-center">
              <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 font-black text-sm flex items-center justify-center mx-auto mb-3">{s.step}</div>
              <p className="text-sm font-semibold text-gray-800 mb-1">{s.label}</p>
              <p className="text-xs text-gray-400 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      )}

      {/* Wizard drawer */}
      {showWizard && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300"
            style={{ opacity: wizardVisible ? 1 : 0 }}
            onClick={closeWizard}
          />
          {/* Panel */}
          <div
            className="fixed inset-y-0 right-0 z-50 bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-out"
            style={{ width: "75%", transform: wizardVisible ? "translateX(0)" : "translateX(100%)" }}
          >
            {/* Drawer header */}
            <div className="flex items-center justify-between px-7 py-5 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <Sparkles size={14} className="text-indigo-600" />
                </div>
                <p className="text-sm font-bold text-gray-800">New feature tracking plan</p>
              </div>
              <button
                onClick={closeWizard}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                ✕
              </button>
            </div>
            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-7 py-6">
              <Wizard goals={goals} kpisByGoal={kpisByGoal} existingEventNames={existingEventNames} onSaved={handleWizardSaved} footerEl={drawerFooterEl} initialFeatureName={wizardInitialName} />
            </div>
            {/* Footer portal target — rendered outside scroll so it's always flush at bottom */}
            <div ref={setDrawerFooterEl} className="flex-shrink-0" />
          </div>
        </>
      )}

      {/* Launch alerts summary */}
      {(() => {
        const today = new Date().toISOString().slice(0, 10);
        const overdue  = plans.filter(p => p.launch_status === "not_launched" && p.planned_launch_date && p.planned_launch_date < today);
        const launching = plans.filter(p => p.launch_status === "not_launched" && p.planned_launch_date === today);
        if (overdue.length === 0 && launching.length === 0) return null;
        return (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              {launching.length > 0 && (
                <p className="text-sm font-semibold text-indigo-700">
                  🚀 {launching.map(p => p.feature_name).join(", ")} {launching.length === 1 ? "is" : "are"} scheduled to launch today
                </p>
              )}
              {overdue.length > 0 && (
                <p className="text-sm font-medium text-amber-700">
                  {overdue.length} feature{overdue.length !== 1 ? "s" : ""} past planned launch date:&nbsp;
                  {overdue.map(p => p.feature_name).join(", ")}
                </p>
              )}
              <p className="text-xs text-amber-600 mt-0.5">Open each feature below to confirm launch or reschedule.</p>
            </div>
          </div>
        );
      })()}

      {/* Saved plans */}
      {plans.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {plans.length} feature{plans.length !== 1 ? "s" : ""} logged
          </p>
          {plans.map(p => (
            <SavedPlanCard
              key={p.id}
              plan={p}
              onArchive={handleArchive}
              onUpdated={load}
              goals={goals}
              orgId={currentOrg.id}
              onSetupWithAI={(id, name) => openWizard(name, id)}
            />
          ))}
        </div>
      )}

      {/* A bare spinner here left this whole region blank for several
          seconds with nothing to suggest progress. These mirror the shape
          SavedPlanCard actually renders in, so the page looks like it's
          assembling the real list rather than stuck. */}
      {loading && (
        <div className="space-y-3 animate-pulse">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white border border-gray-100 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="h-3.5 w-1/3 bg-gray-100 rounded" />
                <div className="h-5 w-20 bg-gray-100 rounded-full" />
              </div>
              <div className="h-2 w-2/3 bg-gray-50 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Sheet import error (parse failed before modal opens) */}
      {importError && importStage === "idle" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-base font-bold text-gray-900 mb-3">Could not read sheet</h3>
            <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{importError}</p>
            <button onClick={resetImport} className="mt-4 w-full bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium py-2.5 rounded-xl transition-colors">
              Close
            </button>
          </div>
        </div>
      )}

      {/* Sheet import — feature selection modal */}
      {(importStage === "selecting" || importStage === "importing") && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <div>
                <h3 className="text-base font-bold text-gray-900">Select features to import</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {importPreview.length} features · {importSelected.size} selected · use × to remove before importing
                </p>
              </div>
              <button onClick={resetImport} disabled={importStage === "importing"} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-40">
                <X size={14} />
              </button>
            </div>

            {/* Select all / none */}
            <div className="px-6 py-2.5 border-b border-gray-50 flex items-center gap-3">
              <button
                onClick={() => setImportSelected(new Set(importPreview.filter(f => !f.exists).map(f => f.name)))}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Select new
              </button>
              <span className="text-gray-200">|</span>
              <button
                onClick={() => setImportSelected(new Set(importPreview.map(f => f.name)))}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Select all
              </button>
              <span className="text-gray-200">|</span>
              <button
                onClick={() => setImportSelected(new Set())}
                className="text-xs text-gray-400 hover:text-gray-600 font-medium"
              >
                Deselect all
              </button>
            </div>

            {/* Feature list — grouped by product, name + checkbox + remove */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {(() => {
                // Group features by their category (MCA, MCG, etc.)
                const grouped: Record<string, PreviewFeature[]> = {};
                for (const f of importPreview) {
                  const g = f.group ?? "Features";
                  if (!grouped[g]) grouped[g] = [];
                  grouped[g].push(f);
                }
                const groupKeys = Object.keys(grouped);
                const hasGroups = groupKeys.length > 1 || (groupKeys.length === 1 && groupKeys[0] !== "Features");

                return groupKeys.map(g => (
                  <div key={g} className="mb-4">
                    {hasGroups && (
                      <div className="flex items-center justify-between mb-1.5 px-1">
                        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">{g}</span>
                        <div className="flex gap-3">
                          <button
                            onClick={() => setImportSelected(prev => {
                              const next = new Set(prev);
                              grouped[g].filter(f => !f.exists).forEach(f => next.add(f.name));
                              return next;
                            })}
                            className="text-[11px] text-indigo-500 hover:text-indigo-700 font-medium"
                          >
                            Select all
                          </button>
                          <button
                            onClick={() => setImportSelected(prev => {
                              const next = new Set(prev);
                              grouped[g].forEach(f => next.delete(f.name));
                              return next;
                            })}
                            className="text-[11px] text-gray-400 hover:text-gray-600 font-medium"
                          >
                            None
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="space-y-0.5">
                      {grouped[g].map(f => (
                        <div key={f.name} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors group ${
                          f.exists ? "opacity-40" : importSelected.has(f.name) ? "bg-indigo-50" : "hover:bg-gray-50"
                        }`}>
                          <input
                            type="checkbox"
                            checked={importSelected.has(f.name)}
                            disabled={importStage === "importing" || f.exists}
                            onChange={() => {
                              if (f.exists) return;
                              setImportSelected(prev => {
                                const next = new Set(prev);
                                next.has(f.name) ? next.delete(f.name) : next.add(f.name);
                                return next;
                              });
                            }}
                            className="accent-indigo-600 w-4 h-4 shrink-0 cursor-pointer"
                          />
                          <span className="text-sm text-gray-800 flex-1 leading-tight">{f.name}</span>
                          {f.exists ? (
                            <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full shrink-0">Already exists</span>
                          ) : (
                            <button
                              onClick={() => {
                                setImportPreview(prev => prev.filter(p => p.name !== f.name));
                                setImportSelected(prev => { const next = new Set(prev); next.delete(f.name); return next; });
                              }}
                              disabled={importStage === "importing"}
                              title="Remove from list"
                              className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-300 hover:text-red-400 transition-all shrink-0"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
              <button onClick={resetImport} disabled={importStage === "importing"} className="text-sm text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-40">
                Cancel
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={importSelected.size === 0 || importStage === "importing"}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors disabled:opacity-40"
              >
                {importStage === "importing" ? (
                  <><Loader2 size={13} className="animate-spin" /> Importing…</>
                ) : (
                  <><CheckCircle2 size={13} /> Import {importSelected.size} feature{importSelected.size !== 1 ? "s" : ""}</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sheet import — result modal */}
      {importStage === "done" && importResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  {importResult.error ? "Import failed" : "Done!"}
                </h3>
                {!importResult.error && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {importResult.added.length} feature{importResult.added.length !== 1 ? "s" : ""} added
                  </p>
                )}
              </div>
            </div>

            {importResult.error ? (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{importResult.error}</p>
            ) : (
              <div className="space-y-1">
                {importResult.added.map(name => (
                  <div key={name} className="flex items-center gap-2 text-sm text-gray-700">
                    <CheckCircle2 size={13} className="text-green-500 shrink-0" /> {name}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={resetImport}
              className="mt-5 w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
