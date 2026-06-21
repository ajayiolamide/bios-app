"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useOrg } from "@/contexts/org-context";
import {
  generateFeatureSuggestions,
  saveFeatureMetric,
  getFeatureMetrics,
  archiveFeatureMetric,
  updateFeatureLaunchDate,
  confirmFeatureLaunch,
  updateFeatureLaunchStatus,
} from "@/app/actions/feature-metrics";
import { getBusinessGoals } from "@/app/actions/business-goals";
import { getKpisByGoal, type MetricWithData } from "@/app/actions/metrics";
import { getDistinctEventNames } from "@/app/actions/events";
import { getMixpanelSettings, syncMixpanelEventNames } from "@/app/actions/mixpanel";
import type { FeatureInput, FeatureSuggestion, FeatureMetric, BusinessGoal } from "@/types/database";
import {
  Lightbulb, Loader2, Plus, Trash2, ChevronRight, ChevronLeft,
  CheckCircle2, BarChart3, TrendingUp, Shield, Zap, Clock,
  ExternalLink, Sparkles, ArrowRight, Trophy, Target, Link2,
  Calendar, AlertTriangle, Rocket, XCircle, RotateCcw,
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

function FreqBadge({ freq }: { freq: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-400 border border-gray-100 px-2 py-0.5 rounded-full">
      <Clock size={9} /> {freq}
    </span>
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
}: {
  s: FeatureSuggestion;
  index: number;
  existingEvents: string[];
  onChange: (updated: FeatureSuggestion) => void;
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
            <FreqBadge freq={s.frequency} />
          </div>
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

type EffectiveStatus = FeatureMetric["launch_status"] | "scheduled";

function LaunchStatusBadge({ status, scheduledDate }: { status: EffectiveStatus; scheduledDate?: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ComponentType<{ size: number }> }> = {
    not_launched: { label: "Not launched",  cls: "bg-gray-100 text-gray-500 border-gray-200",         icon: Clock },
    scheduled:    { label: scheduledDate ? `Scheduled ${scheduledDate}` : "Scheduled", cls: "bg-blue-100 text-blue-700 border-blue-200", icon: Calendar },
    launched:     { label: "Launched ✓",    cls: "bg-green-100 text-green-700 border-green-200",       icon: Rocket },
    delayed:      { label: "Delayed",       cls: "bg-amber-100 text-amber-700 border-amber-200",       icon: RotateCcw },
    cancelled:    { label: "Cancelled",     cls: "bg-red-100 text-red-600 border-red-200",             icon: XCircle },
  };
  const { label, cls, icon: Icon } = map[status] ?? map.not_launched;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${cls}`}>
      <Icon size={9} /> {label}
    </span>
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
}: {
  plan: FeatureMetric;
  onArchive: (id: string) => void;
  onUpdated: () => void;
  goals: BusinessGoal[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingDate, setEditingDate] = useState(false);
  const [dateInput, setDateInput] = useState(plan.planned_launch_date ?? "");
  const [saving, setSaving] = useState(false);

  function timeAgo(iso: string) {
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return d === 0 ? "today" : d === 1 ? "yesterday" : `${d}d ago`;
  }

  const linkedGoal = goals.find((g) => g.id === plan.business_goal_id);
  const today = new Date().toISOString().slice(0, 10);

  // Compute effective status — auto-launch when planned date has arrived
  const effectiveStatus = ((): EffectiveStatus => {
    if (plan.launch_status !== "not_launched") return plan.launch_status;
    if (!plan.planned_launch_date) return "not_launched";
    if (plan.planned_launch_date <= today) return "launched"; // date reached
    return "scheduled"; // future date set
  })();

  // Auto-confirm in DB when effective status flips to launched
  useEffect(() => {
    if (
      plan.launch_status === "not_launched" &&
      plan.planned_launch_date &&
      plan.planned_launch_date <= today
    ) {
      confirmFeatureLaunch(plan.id).then(() => onUpdated());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Alert states
  const isOverdue = effectiveStatus !== "launched" && effectiveStatus !== "scheduled" && plan.planned_launch_date && plan.planned_launch_date < today;
  const isToday   = plan.launch_status === "not_launched" && plan.planned_launch_date === today;
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

  async function handleDelay() {
    setSaving(true);
    await updateFeatureLaunchStatus(plan.id, "delayed");
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
            <button onClick={handleDelay} disabled={saving}
              className="text-[11px] font-medium text-amber-600 hover:text-amber-800 px-2 py-1 rounded-lg hover:bg-amber-100 transition-colors">
              Delay
            </button>
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

      {expanded && (
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

            {effectiveStatus === "launched" ? (
              <p className="text-sm text-green-700 font-medium">
                🚀 Launched on {plan.actual_launch_date ?? plan.planned_launch_date}
              </p>
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
                  {/* effectiveStatus is already guaranteed not to be "launched" here —
                      this whole block only renders in the else-branch of the
                      effectiveStatus === "launched" ternary above. */}
                  <button onClick={() => setEditingDate(true)}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 rounded hover:bg-indigo-50 transition-colors">
                    {plan.planned_launch_date ? "Reschedule" : "Set date"}
                  </button>
                  <button onClick={handleConfirmLaunch} disabled={saving}
                    className="text-xs bg-green-600 text-white px-2.5 py-1 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium">
                    {saving ? "…" : "✓ Launched"}
                  </button>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(plan.suggestions as FeatureSuggestion[]).map((s, i) => (
              <SuggestionCard key={i} s={s} index={i} existingEvents={[]} onChange={() => {}} />
            ))}
          </div>
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
            <p className="text-sm font-semibold text-gray-700 mb-1">No business goals set yet</p>
            <p className="text-xs text-gray-400 max-w-xs">
              Add company goals in Business Goals first, and this feature plan will automatically align to one.
            </p>
          </div>
          <a
            href="/goals"
            className="text-xs text-indigo-600 hover:underline font-medium"
          >
            Set up Business Goals →
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
};

type WizardStage = "goal" | "kpi" | "questions" | "generating" | "results";

function Wizard({ goals, kpisByGoal, onSaved, existingEventNames }: { goals: BusinessGoal[]; kpisByGoal: Record<string, MetricWithData[]>; onSaved: () => void; existingEventNames: string[] }) {
  const { currentOrg } = useOrg();
  const [stage, setStage] = useState<WizardStage>("goal");
  const [step, setStep] = useState(0);
  const [input, setInput] = useState<FeatureInput>(EMPTY_INPUT);
  const [selectedGoal, setSelectedGoal] = useState<BusinessGoal | null>(null);
  const [selectedKpi, setSelectedKpi] = useState<MetricWithData | null>(null);
  const [suggestions, setSuggestions] = useState<FeatureSuggestion[] | null>(null);
  const [goalAlignment, setGoalAlignment] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = QUESTIONS[step];
  const isLast = step === QUESTIONS.length - 1;
  const currentValue = input[current?.key] ?? "";
  const canNext = currentValue.toString().trim().length > 0;
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
              { tool: "This platform (BIOS)", tip: "Events you fire from your app appear in the Events tab. The trackable items above have been automatically added and show up under Business Goals." },
            ].map(({ tool, tip }) => (
              <div key={tool} className="bg-white/60 rounded-xl p-3">
                <p className="font-bold text-indigo-900 mb-1">{tool}</p>
                <p className="leading-relaxed text-indigo-700">{tip}</p>
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex items-center justify-between">
          <button onClick={() => setStage("questions")} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
            ← Regenerate
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Save to platform
          </button>
        </div>
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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true);

    // If Mixpanel is connected, sync event names into the events table first
    // so they appear in the autocomplete dropdown
    const { connected } = await getMixpanelSettings(currentOrg.id);
    if (connected) {
      await syncMixpanelEventNames(currentOrg.id).catch(() => {/* silent — don't block load */});
    }

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
          {!showWizard && (
            <button
              onClick={() => setShowWizard(true)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
            >
              <Plus size={14} /> Log a feature
            </button>
          )}
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

      {/* Wizard */}
      {showWizard && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <p className="text-sm font-bold text-gray-700">New feature tracking plan</p>
            <button onClick={() => setShowWizard(false)} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Cancel</button>
          </div>
          <Wizard goals={goals} kpisByGoal={kpisByGoal} existingEventNames={existingEventNames} onSaved={() => { setShowWizard(false); load(); }} />
        </div>
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
            <SavedPlanCard key={p.id} plan={p} onArchive={handleArchive} onUpdated={load} goals={goals} />
          ))}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} className="animate-spin text-gray-300" />
        </div>
      )}
    </div>
  );
}
