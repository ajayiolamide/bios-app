"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getAlertRules, createAlertRule, updateAlertRule, deleteAlertRule,
  evaluateRule, getAlertEventNames, getOrgKpis, runAllChecksNow,
  type AlertRulePayload, type EvalResult, type KpiOption,
} from "@/app/actions/alert-rules";
import type { AlertRule, AlertRuleType } from "@/types/database";
import {
  BellRing, Plus, Trash2, Play, Pencil,
  CheckCircle2, AlertTriangle, Clock, Loader2, ToggleLeft, ToggleRight,
  X, RefreshCw, Target,
} from "lucide-react";
import { PageLoader } from "@/components/ui/page-loader";

// ─── Rule type metadata ───────────────────────────────────────────────────────

const RULE_TYPE_OPTIONS: {
  value: AlertRuleType; label: string; group: string;
  needsRatio: boolean; needsPct: boolean; isKpi: boolean;
}[] = [
  // Event-based rules
  { value: "event_ratio_drop",  label: "Conversion rate drops by %",    group: "Event", needsRatio: true,  needsPct: true,  isKpi: false },
  { value: "event_ratio_rise",  label: "Conversion rate rises by %",    group: "Event", needsRatio: true,  needsPct: true,  isKpi: false },
  { value: "event_count_drop",  label: "Event count drops by %",        group: "Event", needsRatio: false, needsPct: true,  isKpi: false },
  { value: "event_count_rise",  label: "Event count rises by %",        group: "Event", needsRatio: false, needsPct: true,  isKpi: false },
  { value: "event_count_below", label: "Event count falls below #",     group: "Event", needsRatio: false, needsPct: false, isKpi: false },
  { value: "event_count_above", label: "Event count rises above #",     group: "Event", needsRatio: false, needsPct: false, isKpi: false },
  { value: "event_ratio_below", label: "Conversion rate falls below %", group: "Event", needsRatio: true,  needsPct: false, isKpi: false },
  { value: "event_ratio_above", label: "Conversion rate rises above %", group: "Event", needsRatio: true,  needsPct: false, isKpi: false },
  // KPI-based rules
  { value: "kpi_below_target",  label: "KPI falls below % of target",  group: "KPI",   needsRatio: false, needsPct: true,  isKpi: true  },
];

function ruleTypeMeta(t: AlertRuleType) {
  return RULE_TYPE_OPTIONS.find(o => o.value === t) ?? RULE_TYPE_OPTIONS[0];
}

// ─── Form state ───────────────────────────────────────────────────────────────

type FormState = {
  name: string;
  description: string;
  rule_type: AlertRuleType;
  numerator_event: string;
  denominator_event: string;
  threshold_pct: string;
  threshold_abs: string;
  lookback_days: string;
  kpi_id: string;
  count_method: "total" | "unique";
  slack_webhook_override: string;
  enabled: boolean;
};

function blankForm(): FormState {
  return {
    name: "", description: "",
    rule_type: "event_ratio_drop",
    numerator_event: "", denominator_event: "",
    threshold_pct: "20", threshold_abs: "",
    lookback_days: "7", kpi_id: "",
    count_method: "total",
    slack_webhook_override: "", enabled: true,
  };
}

function formToPayload(f: FormState): AlertRulePayload {
  const meta = ruleTypeMeta(f.rule_type);
  if (meta.isKpi) {
    const kpi = f.kpi_id; // UUID
    return {
      name: f.name.trim(),
      description: f.description.trim() || null,
      rule_type: f.rule_type,
      numerator_event: f.name.trim() || "kpi", // display placeholder
      denominator_event: null,
      threshold_pct: Number(f.threshold_pct) || 70,
      threshold_abs: null,
      lookback_days: Number(f.lookback_days) || 7,
      kpi_id: kpi || null,
      slack_webhook_override: f.slack_webhook_override.trim() || null,
      enabled: f.enabled,
    };
  }
  return {
    name: f.name.trim(),
    description: f.description.trim() || null,
    rule_type: f.rule_type,
    numerator_event: f.numerator_event.trim(),
    denominator_event: meta.needsRatio ? (f.denominator_event.trim() || null) : null,
    threshold_pct: meta.needsPct ? (Number(f.threshold_pct) || null) : null,
    threshold_abs: !meta.needsPct ? (Number(f.threshold_abs) || null) : null,
    lookback_days: Number(f.lookback_days) || 7,
    kpi_id: null,
    count_method: f.count_method,
    slack_webhook_override: f.slack_webhook_override.trim() || null,
    enabled: f.enabled,
  };
}

// ─── Rule form ────────────────────────────────────────────────────────────────

function RuleForm({
  initial, onSave, onCancel, eventNames, kpiOptions,
}: {
  initial?: AlertRule;
  onSave: (payload: AlertRulePayload) => Promise<void>;
  onCancel: () => void;
  eventNames: string[];
  kpiOptions: KpiOption[];
}) {
  const [form, setForm] = useState<FormState>(() => {
    if (!initial) return blankForm();
    return {
      name: initial.name,
      description: initial.description ?? "",
      rule_type: initial.rule_type,
      numerator_event: initial.numerator_event,
      denominator_event: initial.denominator_event ?? "",
      threshold_pct: initial.threshold_pct?.toString() ?? "20",
      threshold_abs: initial.threshold_abs?.toString() ?? "",
      lookback_days: initial.lookback_days.toString(),
      kpi_id: initial.kpi_id ?? "",
      count_method: (initial.count_method as "total" | "unique") ?? "total",
      slack_webhook_override: initial.slack_webhook_override ?? "",
      enabled: initial.enabled,
    };
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const meta = ruleTypeMeta(form.rule_type);
  const set = (key: keyof FormState, val: string | boolean) =>
    setForm(prev => ({ ...prev, [key]: val }));

  // Auto-fill name when a KPI is selected
  const handleKpiChange = (kpiId: string) => {
    set("kpi_id", kpiId);
    if (kpiId && !form.name) {
      const kpi = kpiOptions.find(k => k.id === kpiId);
      if (kpi) set("name", `${kpi.name} below target`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!form.name.trim()) { setErr("Name is required"); return; }
    if (meta.isKpi) {
      if (!form.kpi_id) { setErr("Select a KPI to monitor"); return; }
      if (!Number(form.threshold_pct)) { setErr("Threshold % is required"); return; }
    } else {
      if (!form.numerator_event.trim()) { setErr("Primary event is required"); return; }
      if (meta.needsRatio && !form.denominator_event.trim()) { setErr("Denominator event is required for ratio rules"); return; }
      if (meta.needsPct && !Number(form.threshold_pct)) { setErr("Threshold % is required"); return; }
      if (!meta.needsPct && !Number(form.threshold_abs)) { setErr("Threshold value is required"); return; }
    }
    setSaving(true);
    try {
      await onSave(formToPayload(form));
    } catch (e2) {
      setErr((e2 as Error).message);
      setSaving(false);
    }
  };

  const fieldCls = "w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white";
  const labelCls = "block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1";

  const selectedKpi = kpiOptions.find(k => k.id === form.kpi_id);

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 border border-indigo-200 rounded-xl bg-indigo-50/40">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-semibold text-gray-800">{initial ? "Edit alert rule" : "New alert rule"}</p>
        <button type="button" onClick={onCancel} className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Rule type — grouped */}
      <div>
        <label className={labelCls}>Rule type</label>
        <select value={form.rule_type} onChange={e => set("rule_type", e.target.value as AlertRuleType)} className={fieldCls}>
          <optgroup label="── KPI Rules">
            {RULE_TYPE_OPTIONS.filter(o => o.isKpi).map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </optgroup>
          <optgroup label="── Event Rules">
            {RULE_TYPE_OPTIONS.filter(o => !o.isKpi).map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </optgroup>
        </select>
      </div>

      {/* KPI picker (only for kpi_below_target) */}
      {meta.isKpi && (
        <div>
          <label className={labelCls}>KPI to monitor</label>
          {kpiOptions.length === 0 ? (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No KPIs with events set up yet. Add a KPI with an event name in Goals &amp; KPIs first.
            </p>
          ) : (
            <>
              <select value={form.kpi_id} onChange={e => handleKpiChange(e.target.value)} className={fieldCls}>
                <option value="">Select a KPI…</option>
                {(() => {
                  const byGoal: Record<string, typeof kpiOptions> = {};
                  const noGoal: typeof kpiOptions = [];
                  for (const k of kpiOptions) {
                    if (k.goal_name) { (byGoal[k.goal_name] ??= []).push(k); }
                    else { noGoal.push(k); }
                  }
                  const aggLabel = (k: typeof kpiOptions[0]) =>
                    k.aggregation === "unique_users" ? "unique users" : k.aggregation === "unique_sessions" ? "unique sessions" : "total events";
                  const renderOpt = (k: typeof kpiOptions[0]) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                      {k.target_value != null ? ` · target ${k.target_value}${k.rate_as_percentage ? "%" : ""}` : " · no target"}
                      {` · ${aggLabel(k)}`}
                    </option>
                  );
                  return (
                    <>
                      {Object.entries(byGoal).sort(([a], [b]) => a.localeCompare(b)).map(([goalName, ks]) => (
                        <optgroup key={goalName} label={`📌 ${goalName}`}>{ks.map(renderOpt)}</optgroup>
                      ))}
                      {noGoal.length > 0 && (
                        <optgroup label="── Other KPIs">{noGoal.map(renderOpt)}</optgroup>
                      )}
                    </>
                  );
                })()}
              </select>
              {selectedKpi && selectedKpi.target_value == null && (
                <p className="text-[11px] text-amber-600 mt-1">⚠️ This KPI has no target value — set one in Goals &amp; KPIs for this alert to work.</p>
              )}
              {selectedKpi && selectedKpi.target_value != null && (
                <p className="text-[11px] text-indigo-600 mt-1">
                  Target: <strong>{selectedKpi.target_value}{selectedKpi.rate_as_percentage ? "%" : ""}</strong>
                  {selectedKpi.denominator_event_name
                    ? ` — computed as ${selectedKpi.event_name} ÷ ${selectedKpi.denominator_event_name}`
                    : selectedKpi.event_name ? ` — event: ${selectedKpi.event_name}` : ""}
                  {` · counting ${selectedKpi.aggregation === "unique_users" ? "unique users" : selectedKpi.aggregation === "unique_sessions" ? "unique sessions" : "total events"}`}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Name */}
      <div>
        <label className={labelCls}>Rule name</label>
        <input value={form.name} onChange={e => set("name", e.target.value)}
          placeholder={meta.isKpi ? "e.g. Activation rate below target" : "e.g. Payment conversion drops"}
          className={fieldCls} />
      </div>

      {/* Description */}
      <div>
        <label className={labelCls}>Description <span className="text-gray-400 normal-case font-normal">(plain English — shows in Slack)</span></label>
        <textarea value={form.description} onChange={e => set("description", e.target.value)}
          placeholder={meta.isKpi
            ? "e.g. Alert when our activation rate KPI falls below 70% of the monthly target"
            : "e.g. Alert when less than 60% of users who start payment actually complete it"}
          rows={2} className={`${fieldCls} resize-none`} />
      </div>

      {/* Event pickers (only for non-KPI rules) */}
      {!meta.isKpi && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{meta.needsRatio ? "Numerator event" : "Event name"}</label>
              <input list="alert-events" value={form.numerator_event}
                onChange={e => set("numerator_event", e.target.value)}
                placeholder="e.g. payment_completed" className={fieldCls} />
            </div>
            {meta.needsRatio && (
              <div>
                <label className={labelCls}>Denominator event</label>
                <input list="alert-events" value={form.denominator_event}
                  onChange={e => set("denominator_event", e.target.value)}
                  placeholder="e.g. payment_clicked" className={fieldCls} />
              </div>
            )}
          </div>
          <datalist id="alert-events">
            {eventNames.map(n => <option key={n} value={n} />)}
          </datalist>
        </>
      )}

      {/* Threshold row */}
      <div className="grid grid-cols-2 gap-3">
        {meta.needsPct || meta.isKpi ? (
          <div>
            <label className={labelCls}>
              {meta.isKpi ? "Alert when KPI is below (% of target)" : "Threshold (%)"}
            </label>
            <input type="number" min={1} max={100} value={form.threshold_pct}
              onChange={e => set("threshold_pct", e.target.value)}
              placeholder={meta.isKpi ? "70" : "20"} className={fieldCls} />
            <p className="text-[10px] text-gray-400 mt-1">
              {meta.isKpi
                ? "E.g. 70 = fire when actual is below 70% of target"
                : "Alert fires if change exceeds this %"}
            </p>
          </div>
        ) : (
          <div>
            <label className={labelCls}>{meta.needsRatio ? "Threshold (%)" : "Threshold (count)"}</label>
            <input type="number" min={0} max={meta.needsRatio ? 100 : undefined} value={form.threshold_abs}
              onChange={e => set("threshold_abs", e.target.value)}
              placeholder={meta.needsRatio ? "60" : "100"} className={fieldCls} />
          </div>
        )}
        {!meta.isKpi && (
          <div>
            <label className={labelCls}>Lookback window (days)</label>
            <input type="number" min={1} max={90} value={form.lookback_days}
              onChange={e => set("lookback_days", e.target.value)}
              placeholder="7" className={fieldCls} />
            <p className="text-[10px] text-gray-400 mt-1">Compare last N days vs prior N days</p>
          </div>
        )}
      </div>

      {/* Count method (event-based rules only) */}
      {!meta.isKpi && (
        <div>
          <label className={labelCls}>Count method</label>
          <div className="flex gap-2">
            {([
              { value: "total" as const,  label: "Total events",  desc: "Count every event occurrence (default)" },
              { value: "unique" as const, label: "Unique users",   desc: "Count distinct user_ids — matches Mixpanel's default" },
            ]).map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => set("count_method", opt.value)}
                title={opt.desc}
                className={`flex-1 text-xs font-medium px-3 py-2 rounded-lg border transition-all ${
                  form.count_method === opt.value
                    ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                    : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-1">
            Use <strong>Unique users</strong> to match Mixpanel — counts each user once per window regardless of how many times they fired the event.
          </p>
        </div>
      )}

      {/* Slack override */}
      <div>
        <label className={labelCls}>Slack webhook <span className="text-gray-400 normal-case font-normal">(optional — leave blank to use org default)</span></label>
        <input value={form.slack_webhook_override} onChange={e => set("slack_webhook_override", e.target.value)}
          placeholder="https://hooks.slack.com/services/..." className={fieldCls} />
      </div>

      {err && <p className="text-xs text-red-500">{err}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving}
          className="flex items-center gap-1.5 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 px-4 py-2 rounded-lg disabled:opacity-50 transition-colors">
          {saving && <Loader2 size={13} className="animate-spin" />}
          {initial ? "Save changes" : "Create rule"}
        </button>
        <button type="button" onClick={onCancel}
          className="text-sm font-medium text-gray-500 hover:text-gray-800 px-4 py-2 rounded-lg transition-colors">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Rule card ────────────────────────────────────────────────────────────────

function RuleCard({
  rule, onToggle, onEdit, onDelete, onTest, kpiOptions,
}: {
  rule: AlertRule;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  kpiOptions: KpiOption[];
}) {
  const meta = ruleTypeMeta(rule.rule_type);
  const lastResult = rule.last_result;
  const isKpi = meta.isKpi;
  const kpi = isKpi ? kpiOptions.find(k => k.id === rule.kpi_id) : null;

  // For KPI rules: current = actual, prior = target, pct_change = % of target − 100
  const pctOfTarget = isKpi && lastResult ? lastResult.prior > 0 ? (lastResult.current / lastResult.prior) * 100 : 0 : null;

  return (
    <div className={`border rounded-xl p-4 transition-colors ${rule.enabled ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50"}`}>
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
          isKpi ? (rule.enabled ? "bg-purple-50" : "bg-gray-100") : (rule.enabled ? "bg-indigo-50" : "bg-gray-100")
        }`}>
          {isKpi
            ? <Target size={15} className={rule.enabled ? "text-purple-600" : "text-gray-400"} />
            : <BellRing size={15} className={rule.enabled ? "text-indigo-600" : "text-gray-400"} />}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`text-sm font-semibold ${rule.enabled ? "text-gray-900" : "text-gray-400"}`}>{rule.name}</p>
            {isKpi && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">KPI</span>}
            {!rule.enabled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 font-medium">Paused</span>}
          </div>

          {rule.description && (
            <p className="text-xs text-gray-500 mt-0.5 italic">{rule.description}</p>
          )}

          {/* Rule summary line */}
          <p className="text-xs text-gray-500 mt-0.5">
            {isKpi ? (
              kpi
                ? <>Alert when <span className="font-medium text-gray-700">{kpi.name}</span> is below <strong>{rule.threshold_pct ?? 70}%</strong> of target ({kpi.target_value != null ? `target: ${kpi.target_value}${kpi.rate_as_percentage ? "%" : ""}` : "no target set"})</>
                : <>{meta.label} — KPI id: {rule.kpi_id}</>
            ) : (
              <>
                {meta.label} — <span className="font-mono text-gray-700">{rule.numerator_event}</span>
                {rule.denominator_event && <> ÷ <span className="font-mono text-gray-700">{rule.denominator_event}</span></>}
                {meta.needsPct && <> &gt; <strong>{rule.threshold_pct}%</strong> change</>}
                {!meta.needsPct && <> threshold: <strong>{rule.threshold_abs}</strong></>}
                {" "}over <strong>{rule.lookback_days}d</strong>
              </>
            )}
          </p>

          {/* Last result */}
          {lastResult && (
            <div className={`mt-2 flex items-center gap-2 text-xs rounded-lg px-2.5 py-1.5 w-fit ${lastResult.fired ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
              {lastResult.fired ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
              {isKpi && pctOfTarget != null
                ? `${lastResult.current.toFixed(1)} actual vs ${lastResult.prior} target (${pctOfTarget.toFixed(0)}% of target)${lastResult.fired ? " 🚨" : ""}`
                : `${lastResult.current.toFixed(rule.denominator_event ? 1 : 0)}${rule.denominator_event ? "%" : " events"} → ${lastResult.pct_change >= 0 ? "+" : ""}${lastResult.pct_change.toFixed(1)}% vs prior${lastResult.fired ? " 🚨" : ""}`}
            </div>
          )}

          {/* Timestamps */}
          <div className="flex items-center gap-3 mt-2">
            {rule.last_checked_at && (
              <p className="text-[10px] text-gray-400 flex items-center gap-1">
                <Clock size={9} />
                Checked {new Date(rule.last_checked_at).toLocaleString()}
              </p>
            )}
            {rule.last_fired_at && (
              <p className="text-[10px] text-orange-500 flex items-center gap-1">
                <AlertTriangle size={9} />
                Last fired {new Date(rule.last_fired_at).toLocaleString()}
              </p>
            )}
            {!rule.last_checked_at && (
              <p className="text-[10px] text-gray-300">Never checked</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onTest} title="Evaluate now"
            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
            <Play size={13} />
          </button>
          <button onClick={onEdit} title="Edit"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <Pencil size={13} />
          </button>
          <button onClick={onToggle} title={rule.enabled ? "Pause" : "Resume"}
            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
            {rule.enabled ? <ToggleRight size={15} className="text-indigo-600" /> : <ToggleLeft size={15} />}
          </button>
          <button onClick={onDelete} title="Delete"
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [eventNames, setEventNames] = useState<string[]>([]);
  const [kpiOptions, setKpiOptions] = useState<KpiOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; result: EvalResult } | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [runAllResult, setRunAllResult] = useState<{ name: string; fired: boolean }[] | null>(null);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const [{ rules: r, error: rulesErr }, e, kpis] = await Promise.all([
        getAlertRules(),
        getAlertEventNames(),
        getOrgKpis(),
      ]);
      if (rulesErr) setLoadErr(rulesErr);
      else setRules(r);
      setEventNames(e);
      setKpiOptions(kpis);
    } catch (err) {
      setLoadErr((err as Error).message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (payload: AlertRulePayload) => {
    await createAlertRule(payload);
    setShowForm(false);
    await load();
  };

  const handleUpdate = async (payload: AlertRulePayload) => {
    if (!editingRule) return;
    await updateAlertRule(editingRule.id, payload);
    setEditingRule(null);
    await load();
  };

  const handleToggle = async (rule: AlertRule) => {
    await updateAlertRule(rule.id, { enabled: !rule.enabled });
    await load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this alert rule?")) return;
    await deleteAlertRule(id);
    await load();
  };

  const handleTest = async (rule: AlertRule) => {
    setTestingId(rule.id);
    setTestResult(null);
    try {
      const result = await evaluateRule(rule.id);
      setTestResult({ id: rule.id, result });
      await load();
    } finally {
      setTestingId(null);
    }
  };

  const handleRunAll = async () => {
    setRunningAll(true);
    setRunAllResult(null);
    try {
      const { results } = await runAllChecksNow();
      setRunAllResult(results.map(r => ({ name: r.name, fired: r.fired })));
      await load();
    } finally {
      setRunningAll(false);
    }
  };

  if (loading) return <PageLoader />;

  const enabledCount = rules.filter(r => r.enabled).length;
  const firedCount = rules.filter(r => r.last_result?.fired).length;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl font-black text-gray-900 tracking-tight">Alert rules</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Watch KPIs and events — get a Slack ping the moment something needs attention.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Run all checks */}
          {rules.length > 0 && (
            <button onClick={handleRunAll} disabled={runningAll}
              className="flex items-center gap-1.5 text-sm font-medium border border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-700 bg-white px-3 py-2 rounded-lg transition-colors disabled:opacity-50">
              {runningAll ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {runningAll ? "Checking…" : "Run all now"}
            </button>
          )}
          {!showForm && !editingRule && (
            <button onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 px-3.5 py-2 rounded-lg transition-colors">
              <Plus size={14} /> New rule
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      {rules.length > 0 && (
        <div className="flex items-center gap-4 mb-5 text-xs text-gray-500">
          <span><strong className="text-gray-800">{enabledCount}</strong> active {enabledCount === 1 ? "rule" : "rules"}</span>
          {firedCount > 0 && (
            <span className="flex items-center gap-1 text-red-600 font-medium">
              <AlertTriangle size={11} /> {firedCount} currently firing
            </span>
          )}
          {firedCount === 0 && enabledCount > 0 && (
            <span className="flex items-center gap-1 text-green-600">
              <CheckCircle2 size={11} /> All clear
            </span>
          )}
        </div>
      )}

      {/* Run all result */}
      {runAllResult && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50">
            <p className="text-xs font-semibold text-gray-700">Check results — {new Date().toLocaleTimeString()}</p>
            <button onClick={() => setRunAllResult(null)} className="p-1 rounded text-gray-400 hover:text-gray-700"><X size={12} /></button>
          </div>
          <div className="divide-y divide-gray-100">
            {runAllResult.map((r, i) => (
              <div key={i} className="flex items-center gap-2 px-4 py-2.5 text-xs">
                {r.fired
                  ? <AlertTriangle size={12} className="text-red-500 flex-shrink-0" />
                  : <CheckCircle2 size={12} className="text-green-500 flex-shrink-0" />}
                <span className="font-medium text-gray-800">{r.name}</span>
                <span className={r.fired ? "text-red-600" : "text-green-600"}>
                  {r.fired ? "🚨 Fired — Slack sent" : "✓ OK"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Setup error */}
      {loadErr && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
          <p className="text-xs font-semibold text-amber-800 mb-1.5">⚠️ One-time Supabase setup required</p>
          <p className="text-xs text-amber-700 mb-2">
            Run this SQL in Supabase → SQL Editor, then refresh:
          </p>
          <pre className="text-[10px] bg-amber-100 rounded-lg p-3 overflow-x-auto text-amber-900 leading-relaxed">{`create table if not exists alert_rules (
  id uuid default gen_random_uuid() primary key,
  organization_id uuid references organizations(id) on delete cascade not null,
  name text not null,
  enabled boolean not null default true,
  rule_type text not null,
  numerator_event text not null default '',
  denominator_event text,
  threshold_pct integer,
  threshold_abs integer,
  lookback_days integer not null default 7,
  kpi_id uuid references metrics(id) on delete set null,
  slack_webhook_override text,
  last_fired_at timestamptz,
  last_checked_at timestamptz,
  last_result jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);
alter table alert_rules enable row level security;
create policy "org members manage alert_rules" on alert_rules
  using (organization_id in (
    select organization_id from organization_members where user_id = auth.uid()
  ))
  with check (organization_id in (
    select organization_id from organization_members where user_id = auth.uid()
  ));`}</pre>
          <p className="text-[10px] text-amber-500 mt-2">Error: {loadErr}</p>
        </div>
      )}

      {/* New rule form */}
      {showForm && (
        <div className="mb-4">
          <RuleForm eventNames={eventNames} kpiOptions={kpiOptions} onSave={handleCreate} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {/* Single test result */}
      {testResult && (
        <div className={`mb-4 rounded-xl p-4 border text-sm ${testResult.result.fired ? "bg-red-50 border-red-200 text-red-800" : "bg-green-50 border-green-200 text-green-800"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              {testResult.result.fired ? <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /> : <CheckCircle2 size={15} className="flex-shrink-0 mt-0.5" />}
              <p className="text-xs leading-relaxed whitespace-pre-wrap">{testResult.result.message}</p>
            </div>
            <button onClick={() => setTestResult(null)} className="p-1 rounded text-current opacity-50 hover:opacity-100 flex-shrink-0"><X size={12} /></button>
          </div>
        </div>
      )}

      {/* Rules list / empty state */}
      {loadErr ? null : rules.length === 0 && !showForm ? (
        <div className="text-center py-16 text-gray-400">
          <BellRing size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium text-gray-500">No alert rules yet</p>
          <p className="text-xs mt-1 max-w-xs mx-auto">Watch a KPI against its target, or track when an event count drops — get a Slack ping the moment it matters.</p>
          <button onClick={() => setShowForm(true)}
            className="mt-4 flex items-center gap-1.5 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 px-4 py-2 rounded-lg transition-colors mx-auto">
            <Plus size={13} /> Create first rule
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map(rule => (
            editingRule?.id === rule.id ? (
              <RuleForm
                key={rule.id}
                initial={rule}
                eventNames={eventNames}
                kpiOptions={kpiOptions}
                onSave={handleUpdate}
                onCancel={() => setEditingRule(null)}
              />
            ) : (
              <div key={rule.id} className="relative">
                {testingId === rule.id && (
                  <div className="absolute inset-0 bg-white/70 rounded-xl flex items-center justify-center z-10">
                    <div className="flex items-center gap-2 text-sm text-indigo-600 font-medium">
                      <Loader2 size={14} className="animate-spin" /> Evaluating…
                    </div>
                  </div>
                )}
                <RuleCard
                  rule={rule}
                  kpiOptions={kpiOptions}
                  onToggle={() => handleToggle(rule)}
                  onEdit={() => { setShowForm(false); setEditingRule(rule); }}
                  onDelete={() => handleDelete(rule.id)}
                  onTest={() => handleTest(rule)}
                />
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}
